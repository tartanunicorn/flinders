<?php

namespace Flinders\Laravel;

use Closure;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use stdClass;

/**
 * The server: `createFlinders` (server-flinders.ts), the repository (repository.ts) and recording
 * links (recording-link.ts), on MySQL. One public method per route. Comments name the function each
 * decision mirrors, so the two stay in step; the conformance kit proves they do.
 */
class Flinders
{
    private const PURPOSE = 'walkthrough-recording';

    private const LINK_TTL_MS = 30 * 60 * 1000;

    private const LINK_REFUSED = [
        'invalid' => 'This recording link isn’t valid.',
        'expired' => 'This recording link has expired.',
        'not_allowed' => 'This recording link only works for the person who made it.',
    ];

    private string $versions;

    private string $progress;

    private string $owner;

    public function __construct(private Connectors $connectors)
    {
        $this->versions = config('flinders.tables.versions');
        $this->progress = config('flinders.tables.progress');
        $this->owner = config('flinders.owner_column');
    }

    // ── what a person gets ───────────────────────────────────────────────────

    /** `served`: each walkthrough's newest non-draft row, if that row is live. */
    public function list(Person $person): array
    {
        $ranked = $this->visible($this->db()->table($this->versions), $person->owner)
            ->select(['walkthrough_id', 'number', 'version', 'definition', "{$this->owner} as owner"])
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY walkthrough_id ORDER BY version DESC) AS newest')
            ->where('definition->status', '<>', 'draft');
        $rows = $this->db()->query()->fromSub($ranked, 'current')
            ->where('newest', 1)->where('definition->status', 'live')
            ->orderBy('owner')->orderBy('number')->get();

        $served = [];
        foreach ($rows as $row) {
            $d = json_decode($row->definition);
            // A row that no longer matches the step schema is left out rather than breaking every page.
            [$fits, $steps] = Schema::parse(Schema::steps(), $d->steps);
            if ($fits) {
                $served[] = [
                    'walkthrough_id' => $row->walkthrough_id,
                    'number' => (int) $row->number,
                    'handle' => "{$row->number}-{$d->slug}",
                    'version' => (int) $row->version,
                    'slug' => $d->slug,
                    'title' => $d->title,
                    'mode' => $d->mode ?? 'show',
                    'permission' => $d->permission,
                    'offer_on' => $d->offer_on,
                    'reoffer_from' => $d->reoffer_from,
                    'article_slug' => $d->article ?? null,
                    'articles' => $d->articles ?? [],
                    'steps' => $steps,
                ];
            }
        }

        return $served;
    }

    /** `mine`: on unless they turned it off. */
    public function mine(Person $person): array
    {
        $progress = new stdClass;
        foreach ($this->db()->table($this->progress)->where('user_id', $person->id)->get() as $r) {
            $progress->{$r->walkthrough_id} = ['v' => (int) $r->seen_version, 'status' => $r->status, 'step' => (int) $r->last_step, 'at' => $this->iso($r->updated_at)];
        }

        return ['offer_walkthroughs' => $this->connectors->offers($person) ?? true, 'progress' => $progress];
    }

    public function setOffers(Person $person, mixed $body): array
    {
        $on = $this->read(Schema::offersBody(), $body)->offer_walkthroughs;
        if (! $this->connectors->setOffers($person, $on)) {
            throw FlindersError::featureOff('The offers switch');
        }

        return $this->mine($person);
    }

    /** `record`: the id is checked before the body is read. */
    public function record(Person $person, string $walkthroughId, Closure $body): array
    {
        $ref = $this->parseRef($walkthroughId);
        if (! isset($ref['id'])) {
            throw FlindersError::notFound();
        }
        $event = $this->read(Schema::event(), $body());
        $last = $this->visible($this->db()->table($this->versions), $person->owner)->where('walkthrough_id', $ref['id'])->max('version');
        if (! $last) {
            throw FlindersError::notFound();
        }
        if ($event->version > $last) {
            throw FlindersError::invalid('That version of the walkthrough doesn’t exist.');
        }
        if ($event->event === 'step') {
            $this->saveStep($person->id, $ref['id'], $event);
        } else {
            $this->saveProgress($person->id, $ref['id'], $event);
        }

        return $this->mine($person);
    }

    /**
     * `saveProgress`: Not now never takes back a finish. MySQL applies these left to right, reading
     * earlier ones' new values, so last_step comes before status.
     */
    private function saveProgress(string $userId, string $id, object $e): void
    {
        $keep = "status = 'completed' AND ? = 'dismissed'";
        $this->upsertProgress(
            [$userId, $id, $e->version, $e->event, $e->step, $e->step, 0],
            "seen_version = ?, last_step = CASE WHEN $keep THEN last_step ELSE ? END, status = CASE WHEN $keep THEN status ELSE ? END, furthest_step = GREATEST(furthest_step, ?)",
            [$e->version, $e->event, $e->step, $e->event, $e->event, $e->step],
        );
    }

    /** `saveStep`: moves the place and leaves the status alone. */
    private function saveStep(string $userId, string $id, object $e): void
    {
        $did = ($e->how ?? 'next') === 'done' ? 1 : 0;
        $this->upsertProgress(
            [$userId, $id, $e->version, 'started', $e->step, $e->step, $did],
            'seen_version = ?, last_step = ?, furthest_step = GREATEST(furthest_step, ?), actions_done = actions_done + ?',
            [$e->version, $e->step, $e->step, $did],
        );
    }

    /** The person's one row: `insert` if it's new, else `update`. */
    private function upsertProgress(array $insert, string $update, array $bindings): void
    {
        $table = $this->db()->getQueryGrammar()->wrapTable($this->progress);
        $now = $this->now();
        $this->db()->statement(
            "INSERT INTO $table (id, user_id, walkthrough_id, seen_version, status, last_step, furthest_step, actions_done, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE $update, updated_at = ?",
            [(string) Str::uuid(), ...$insert, $now, ...$bindings, $now],
        );
    }

    // ── admin ────────────────────────────────────────────────────────────────

    /** `adminList`: every walkthrough of the person's owner, its newest version and the live one. */
    public function adminList(Person $person): array
    {
        $rows = $this->owned($this->db()->table($this->versions), $person->owner)->orderByDesc('version')->get()->groupBy('walkthrough_id');

        return $rows->map(function ($versions) {
            $newest = $versions->first();
            $d = json_decode($newest->definition);
            $servedRow = $versions->first(fn ($v) => json_decode($v->definition)->status !== 'draft');
            $served = $servedRow ? json_decode($servedRow->definition) : null;
            $live = $served?->status === 'live';

            return [
                'walkthrough_id' => $newest->walkthrough_id,
                'number' => (int) $newest->number,
                'handle' => "{$newest->number}-{$d->slug}",
                'slug' => $d->slug,
                'title' => $d->title,
                'mode' => $d->mode ?? 'show',
                'latest_version' => (int) $newest->version,
                'latest_status' => $d->status,
                'live_version' => $live ? (int) $servedRow->version : null,
                'article_slug' => $d->article ?? null,
                'article_title' => null,
                'permission' => $d->permission,
                'offer_on' => $d->offer_on,
                'reoffer_from' => $d->reoffer_from,
                'steps_count' => is_array($d->steps) ? count($d->steps) : 0,
                'updated_at' => $this->iso($newest->created_at),
                'updated_by' => $newest->created_by,
                // Only what people get can need an update.
                'problems' => $live ? $this->problemsOf($served->steps) : [],
            ];
        })->sortBy('number')->values()->all();
    }

    /** `adminDetail`, by handle, number or original id. */
    public function adminDetail(Person $person, string $ref): array
    {
        $id = $this->resolve($person, $ref);
        $rows = $this->owned($this->db()->table($this->versions), $person->owner)->where('walkthrough_id', $id)->orderByDesc('version')->get();
        $newest = json_decode($rows[0]->definition);

        return [
            'walkthrough_id' => $id,
            'number' => (int) $rows[0]->number,
            'handle' => "{$rows[0]->number}-{$newest->slug}",
            'stats' => $this->stats($id, is_array($newest->steps) ? count($newest->steps) : 0),
            'versions' => $rows->map(function ($r) {
                $d = json_decode($r->definition);

                return [
                    'version' => (int) $r->version,
                    'status' => $d->status,
                    'slug' => $d->slug,
                    'title' => $d->title,
                    'mode' => $d->mode ?? 'show',
                    'article_slug' => $d->article ?? null,
                    'articles' => $d->articles ?? [],
                    'permission' => $d->permission,
                    'offer_on' => $d->offer_on,
                    'reoffer_from' => $d->reoffer_from,
                    'steps' => $d->steps,
                    'created_at' => $this->iso($r->created_at),
                    'created_by' => $r->created_by,
                    'problems' => $this->problemsOf($d->steps),
                ];
            })->all(),
        ];
    }

    /** `stats`: how far people got, from their progress rows. */
    private function stats(string $id, int $steps): array
    {
        $rows = $this->db()->table($this->progress)->where('walkthrough_id', $id)->get(['status', 'furthest_step', 'actions_done']);
        $reached = [];
        for ($i = 0; $i < $steps; $i++) {
            $reached[] = $rows->where('furthest_step', '>=', $i)->count();
        }

        return [
            'people' => $rows->count(),
            'finished' => $rows->where('status', 'completed')->count(),
            'reached' => $reached,
            'actions_done' => (int) $rows->sum('actions_done'),
        ];
    }

    /** An upload is always saved as a draft. */
    public function adminUpload(Person $person, mixed $file): array
    {
        return $this->saveFile($file, $person->id, $person->owner);
    }

    /** `copyVersion`: Make live, Make inactive, Restore. Copies a version into the next, with this status. */
    public function adminSaveVersion(Person $person, string $ref, mixed $body): array
    {
        $asked = $this->read(Schema::versionBody(), $body);
        $id = $this->resolve($person, $ref);

        return $this->holdingNumbers($person->owner, function () use ($person, $id, $asked) {
            $from = $this->owned($this->db()->table($this->versions), $person->owner)->useWritePdo()
                ->where('walkthrough_id', $id)->where('version', $asked->from_version)->first();
            if (! $from) {
                throw FlindersError::notFound('That version of the walkthrough doesn’t exist.');
            }
            $definition = json_decode($from->definition);
            $unwritten = $asked->status === 'live' && is_array($definition->steps) ? Schema::unwrittenSteps($definition->steps) : [];
            if ($unwritten) {
                $which = count($unwritten) === 1 ? "step {$unwritten[0]} still has" : 'steps '.implode(', ', $unwritten).' still have';
                throw FlindersError::invalid("This can’t go live yet: $which the placeholder words from recording. Write them first.");
            }
            $definition->status = $asked->status;
            $version = $this->db()->table($this->versions)->useWritePdo()->where('walkthrough_id', $id)->max('version') + 1;
            $this->insertVersion((string) Str::uuid(), $id, $person->owner, (int) $from->number, $version, $definition, $person->id);

            return $this->saved($id, (int) $from->number, $definition->slug, $version, $asked->status);
        });
    }

    /** `saveFile`: a known number adds a version, an unused one starts a walkthrough with it, none takes the next. */
    private function saveFile(mixed $input, ?string $createdBy, ?string $owner): array
    {
        $file = $this->read(Schema::file(), $input);
        $problems = Schema::stepProblems($file->steps, $this->connectors);
        if ($problems) {
            $more = count($problems) > 5 ? ' (and '.(count($problems) - 5).' more)' : '';
            throw FlindersError::invalid(implode('; ', array_slice($problems, 0, 5)).$more);
        }
        $offerOn = $file->offer_on ?? null;
        if ($offerOn && ! $this->connectors->routeExists($offerOn)) {
            throw FlindersError::invalid("offer_on: no page “{$offerOn}” in the app");
        }

        return $this->holdingNumbers($owner, function () use ($file, $offerOn, $createdBy, $owner) {
            $latest = isset($file->number)
                ? $this->owned($this->db()->table($this->versions), $owner)->useWritePdo()->where('number', $file->number)->orderByDesc('version')->first()
                : null;
            $last = $latest ? json_decode($latest->definition) : null;
            $mode = $file->mode ?? $last->mode ?? null;
            $definition = (object) array_filter([
                'slug' => $file->slug,
                'title' => $file->title,
                'status' => 'draft',
                // Stored only for a guide walkthrough, as older versions have none.
                'mode' => $mode,
                'permission' => $file->permission ?? null,
                'offer_on' => $offerOn,
                // A file that doesn't say keeps the last version's: only raising it offers again.
                'reoffer_from' => $file->reoffer_from ?? $last->reoffer_from ?? 1,
                'article' => $file->article ?? null,
                // Stored only when there are any, as older versions have none.
                'articles' => $file->articles ?? null,
                'steps' => $file->steps,
            ], fn ($value, $key) => ($key !== 'mode' && $key !== 'articles') || ! empty($value), ARRAY_FILTER_USE_BOTH);

            $id = (string) Str::uuid();
            $walkthroughId = $latest->walkthrough_id ?? $id;
            $number = (int) ($latest->number ?? $file->number ?? $this->owned($this->db()->table($this->versions), $owner)->useWritePdo()->whereColumn('id', 'walkthrough_id')->max('number') + 1);
            $version = (int) ($latest->version ?? 0) + 1;
            $this->insertVersion($id, $walkthroughId, $owner, $number, $version, $definition, $createdBy);

            return $this->saved($walkthroughId, $number, $file->slug, $version, 'draft');
        });
    }

    private function insertVersion(string $id, string $walkthroughId, ?string $owner, int $number, int $version, object $definition, ?string $createdBy): void
    {
        $this->db()->table($this->versions)->insert([
            'id' => $id,
            'walkthrough_id' => $walkthroughId,
            $this->owner => $owner,
            'number' => $number,
            'version' => $version,
            'definition' => json_encode($definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'created_by' => $createdBy,
            'created_at' => $this->now(),
        ]);
    }

    private function saved(string $id, int $number, string $slug, int $version, string $status): array
    {
        return ['walkthrough_id' => $id, 'number' => $number, 'handle' => "$number-$slug", 'version' => $version, 'status' => $status, 'saved' => true];
    }

    /** The trigger's `pg_advisory_xact_lock`: one save at a time per owner, so two can't take the same number or version. */
    private function holdingNumbers(?string $owner, Closure $run): mixed
    {
        $name = 'flinders.'.md5($this->versions.'|'.($owner ?? ''));
        if (! $this->db()->selectOne('SELECT GET_LOCK(?, 10) AS got', [$name], false)->got) {
            throw new RuntimeException('Could not take the walkthrough numbering lock.');
        }
        try {
            return $run();
        } finally {
            $this->db()->select('SELECT RELEASE_LOCK(?)', [$name], false);
        }
    }

    // ── recording links ──────────────────────────────────────────────────────

    public function createRecordingLink(Person $person): array
    {
        $setup = $this->recording();
        $made = $this->makeLink($person->id, $setup['secret']);
        // recordingLinkUrl: the link after the #, where browsers never send it.
        $base = preg_replace('~^([a-z][a-z0-9+.-]*://[^/?#]+)(?=$|\?)~i', '$1/', explode('#', $setup['web_url'])[0]);

        return [...$made, 'url' => "$base#flinders_record={$made['link']}"];
    }

    /** `checkAndRenewRecordingLink`: a good link comes back fresh, so the clock runs from when it's used. */
    public function checkRecordingLink(Person $person, Closure $body): array
    {
        $setup = $this->recording();
        $check = $this->checkLinkFor($this->read(Schema::linkBody(), $body())->link, $person, $setup['secret']);

        return $check['valid'] ? [...$check, ...$this->makeLink($check['created_by'], $setup['secret'])] : $check;
    }

    /** `saveRecording`: a new draft by the link's creator, never a version of an existing walkthrough. */
    public function saveRecording(Person $person, Closure $body): array
    {
        $setup = $this->recording();
        $given = $this->read(Schema::recordingBody(), $body());
        $check = $this->checkLinkFor($given->link, $person, $setup['secret']);
        if (! $check['valid']) {
            throw new FlindersError(403, 'forbidden', self::LINK_REFUSED[$check['reason']]);
        }

        return $this->saveFile(Schema::recordingFile($given->steps), $check['created_by'], $person->owner);
    }

    private function recording(): array
    {
        $setup = config('flinders.recording');
        if (empty($setup['secret']) || empty($setup['web_url'])) {
            throw FlindersError::featureOff('Recording');
        }

        return $setup;
    }

    private function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    private function sign(string $payload, string $secret): string
    {
        return hash_hmac('sha256', self::PURPOSE.".$payload", $secret, true);
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    private function msToIso(int $ms): string
    {
        return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)).sprintf('.%03dZ', $ms % 1000);
    }

    /** `createRecordingLink`: the same format as Node's, so a link made by one checks on the other. */
    private function makeLink(string $by, string $secret): array
    {
        $expires = $this->nowMs() + self::LINK_TTL_MS;
        $payload = $this->base64url(json_encode(['by' => $by, 'exp' => $expires, 'purpose' => self::PURPOSE], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return ['link' => $payload.'.'.$this->base64url($this->sign($payload, $secret)), 'expires_at' => $this->msToIso($expires)];
    }

    /** `checkRecordingLink`, then `checkRecordingLinkFor`: only its creator, while they may still record. */
    private function checkLinkFor(string $link, Person $person, string $secret): array
    {
        $invalid = ['valid' => false, 'reason' => 'invalid'];
        $parts = explode('.', $link);
        if (strlen($link) > 1024 || count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return $invalid;
        }
        [$payload, $signature] = $parts;
        if (! hash_equals($this->sign($payload, $secret), (string) base64_decode(strtr($signature, '-_', '+/')))) {
            return $invalid;
        }
        $claims = json_decode((string) base64_decode(strtr($payload, '-_', '+/')), true);
        if (! is_array($claims) || ($claims['purpose'] ?? null) !== self::PURPOSE || ! is_string($claims['by'] ?? null) || ! is_numeric($claims['exp'] ?? null)) {
            return $invalid;
        }
        if ($this->nowMs() >= $claims['exp']) {
            return ['valid' => false, 'reason' => 'expired'];
        }
        if ($claims['by'] !== $person->id || ! $this->connectors->mayRecord($person)) {
            return ['valid' => false, 'reason' => 'not_allowed'];
        }

        return ['valid' => true, 'created_by' => $claims['by'], 'expires_at' => $this->msToIso((int) $claims['exp'])];
    }

    // ── shared ───────────────────────────────────────────────────────────────

    private function db(): Connection
    {
        return DB::connection(config('flinders.connection'));
    }

    /** The product's own and this owner's: `served` and `latestVersion`. */
    private function visible(Builder $query, ?string $owner): Builder
    {
        return $query->where(fn (Builder $q) => $q->whereNull($this->owner)->when($owner !== null, fn (Builder $q) => $q->orWhere($this->owner, $owner)));
    }

    /** Exactly this owner's: `IS NOT DISTINCT FROM`. */
    private function owned(Builder $query, ?string $owner): Builder
    {
        return $owner === null ? $query->whereNull($this->owner) : $query->where($this->owner, $owner);
    }

    /** `parseWalkthroughRef`: a handle (the slug part is ignored), a number or an original id. */
    private function parseRef(string $ref): ?array
    {
        $text = Schema::trim($ref);
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD', $text)) {
            return ['id' => strtolower($text)];
        }
        $number = preg_match('/^(\d{1,9})(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/D', $text, $m) ? (int) $m[1] : 0;

        return $number >= 1 ? ['number' => $number] : null;
    }

    /** `resolve`: a reference to one of this owner's walkthroughs, or a 404. */
    private function resolve(Person $person, string $ref): string
    {
        $parsed = $this->parseRef($ref);
        $id = $parsed ? $this->owned($this->db()->table($this->versions), $person->owner)->where(array_key_first($parsed) === 'number' ? 'number' : 'walkthrough_id', reset($parsed))->value('walkthrough_id') : null;

        return $id ?? throw FlindersError::notFound();
    }

    private function problemsOf(mixed $steps): array
    {
        [$fits, $parsed] = Schema::parse(Schema::steps(), $steps);

        return $fits ? Schema::stepProblems($parsed, $this->connectors) : ['its steps no longer match the walkthrough format'];
    }

    private function read(Closure $schema, mixed $body): object
    {
        [$fits, $parsed] = Schema::parse($schema, $body);

        return $fits ? $parsed : throw FlindersError::invalid($parsed);
    }

    /** UTC always, whatever the app's or the session's time zone. */
    private function now(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
    }

    private function iso(string $stored): string
    {
        return (new DateTimeImmutable($stored, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }
}

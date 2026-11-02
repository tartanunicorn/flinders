<?php

namespace Flinders\Laravel;

use Closure;
use stdClass;

/**
 * The file format and request bodies: repository.ts's zod schemas and `stepProblems`, in PHP. The
 * few lines at the top are the parts of zod they use, so each schema below reads like its original
 * and a refusal says the same words: the first issue, where it is and what's wrong. Values arrive
 * from json_decode as objects, so `{}` stays apart from `[]`.
 *
 * A parser takes (value, path, &issues) and returns [status, value]. As in zod, a wrong type aborts
 * and a failed check only dirties, which decides what a union reports.
 */
final class Schema
{
    private const OK = 0;

    private const DIRTY = 1;

    private const ABORTED = 2;

    public const FORMAT_VERSION = 1;

    public const UNWRITTEN_TITLE = 'Untitled step';

    public const UNWRITTEN_BODY = 'Say what to do here.';

    private const SLUG = '/^[a-z0-9]+(-[a-z0-9]+)*$/D';

    /** Mouse-only actions: copy a touch screen shows says "tap" instead. */
    private const MOUSE_WORDS = '/\b(hover(s|ing)?|(right-)?click(s|ed|ing)?)\b/i';

    /** What JavaScript's trim() removes. */
    private const SPACE = '[\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';

    /** A value that isn't there, as against null. */
    public static function missing(): object
    {
        static $missing = new stdClass;

        return $missing;
    }

    public static function trim(string $text): string
    {
        return preg_replace('/^'.self::SPACE.'+|'.self::SPACE.'+$/uD', '', $text);
    }

    /** @return array{0: bool, 1: mixed} [true, the value] or [false, the first problem in plain words]. */
    public static function parse(Closure $schema, mixed $value): array
    {
        $issues = [];
        [$status, $parsed] = $schema($value, [], $issues);
        if ($status === self::OK) {
            return [true, $parsed];
        }
        [$path, $message] = $issues[0];

        return [false, ($path ? implode(' ▸ ', $path) : 'the file').": $message"];
    }

    // ── the parts of zod ─────────────────────────────────────────────────────

    private static function received(mixed $value): string
    {
        return match (true) {
            is_string($value) => 'string',
            is_int($value), is_float($value) => 'number',
            is_bool($value) => 'boolean',
            $value === null => 'null',
            is_array($value) => 'array',
            default => 'object',
        };
    }

    /** A wrong type. */
    private static function wrong(string $expected, mixed $value, array $path, array &$issues): array
    {
        $issues[] = [$path, $value === self::missing() ? 'Required' : "Expected $expected, received ".self::received($value)];

        return [self::ABORTED, null];
    }

    /** string: JavaScript counts UTF-16 units, so lengths do too. `checks` run in order. */
    private static function string(array ...$checks): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($checks) {
            if (! is_string($value)) {
                return self::wrong('string', $value, $path, $issues);
            }
            $status = self::OK;
            foreach ($checks as [$check, $arg]) {
                $length = fn () => strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')) / 2;
                $problem = match ($check) {
                    'trim' => null,
                    'min' => $length() < $arg ? "String must contain at least $arg character(s)" : null,
                    'max' => $length() > $arg ? "String must contain at most $arg character(s)" : null,
                    'regex' => preg_match($arg, $value) ? null : 'Invalid',
                    'starts' => str_starts_with($value, $arg) ? null : "Invalid input: must start with \"$arg\"",
                };
                if ($check === 'trim') {
                    $value = self::trim($value);
                }
                if ($problem) {
                    $issues[] = [$path, $problem];
                    $status = self::DIRTY;
                }
            }

            return [$status, $value];
        };
    }

    /** number().int().min().max(). JSON's 1.0 is the integer 1, as in JavaScript. */
    private static function integer(?int $min = null, ?int $max = null, ?Closure $refine = null): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($min, $max, $refine) {
            if (! is_int($value) && ! is_float($value)) {
                return self::wrong('number', $value, $path, $issues);
            }
            $status = self::OK;
            $problem = function (string $message) use (&$issues, &$status, $path) {
                $issues[] = [$path, $message];
                $status = self::DIRTY;
            };
            if (is_float($value)) {
                if (is_finite($value) && floor($value) === $value) {
                    $value = abs($value) < 2 ** 53 ? (int) $value : $value;
                } else {
                    $problem('Expected integer, received float');
                }
            }
            if ($min !== null && $value < $min) {
                $problem("Number must be greater than or equal to $min");
            }
            if ($max !== null && $value > $max) {
                $problem("Number must be less than or equal to $max");
            }
            if ($refine && ($message = $refine($value))) {
                $problem($message);
            }

            return [$status, $value];
        };
    }

    private static function boolean(): Closure
    {
        return fn (mixed $value, array $path, array &$issues) => is_bool($value) ? [self::OK, $value] : self::wrong('boolean', $value, $path, $issues);
    }

    private static function enum(string ...$options): Closure
    {
        $expected = "'".implode("' | '", $options)."'";

        return function (mixed $value, array $path, array &$issues) use ($options, $expected) {
            if (! is_string($value)) {
                return self::wrong($expected, $value, $path, $issues);
            }
            if (in_array($value, $options, true)) {
                return [self::OK, $value];
            }
            $issues[] = [$path, "Invalid enum value. Expected $expected, received '$value'"];

            return [self::ABORTED, null];
        };
    }

    private static function nullable(Closure $inner): Closure
    {
        return fn (mixed $value, array $path, array &$issues) => $value === null ? [self::OK, null] : $inner($value, $path, $issues);
    }

    private static function optional(Closure $inner): Closure
    {
        return fn (mixed $value, array $path, array &$issues) => $value === self::missing() ? [self::OK, $value] : $inner($value, $path, $issues);
    }

    private static function array(Closure $item, int $min = 0, ?int $max = null): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($item, $min, $max) {
            if (! is_array($value)) {
                return self::wrong('array', $value, $path, $issues);
            }
            $status = self::OK;
            if (count($value) < $min) {
                $issues[] = [$path, "Array must contain at least $min element(s)"];
                $status = self::DIRTY;
            }
            if ($max !== null && count($value) > $max) {
                $issues[] = [$path, "Array must contain at most $max element(s)"];
                $status = self::DIRTY;
            }
            $out = [];
            foreach ($value as $i => $each) {
                [$one, $out[]] = $item($each, [...$path, $i], $issues);
                $status = max($status, $one);
            }

            return [$status, $out];
        };
    }

    /** A strict object: every key of `shape`, in order, then a complaint about any others. */
    private static function object(array $shape): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($shape) {
            if (! is_object($value) || $value === self::missing()) {
                return self::wrong('object', $value, $path, $issues);
            }
            $status = self::OK;
            $out = new stdClass;
            foreach ($shape as $key => $schema) {
                $given = property_exists($value, $key) ? $value->{$key} : self::missing();
                [$one, $parsed] = $schema($given, [...$path, $key], $issues);
                $status = max($status, $one);
                if ($parsed !== self::missing()) {
                    $out->{$key} = $parsed;
                }
            }
            $unknown = array_diff(array_map('strval', array_keys(get_object_vars($value))), array_map('strval', array_keys($shape)));
            if ($unknown) {
                $issues[] = [$path, "Unrecognized key(s) in object: '".implode("', '", $unknown)."'"];
                $status = max($status, self::DIRTY);
            }

            return [$status, $out];
        };
    }

    /** The first option that fits; else the first that only failed a check; else "Invalid input". */
    private static function union(Closure ...$options): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($options) {
            $dirty = null;
            foreach ($options as $option) {
                $own = [];
                [$status, $parsed] = $option($value, $path, $own);
                if ($status === self::OK) {
                    return [self::OK, $parsed];
                }
                if ($status === self::DIRTY && ! $dirty) {
                    $dirty = [$own, $parsed];
                }
            }
            if ($dirty) {
                array_push($issues, ...$dirty[0]);

                return [self::DIRTY, $dirty[1]];
            }
            $issues[] = [$path, 'Invalid input'];

            return [self::ABORTED, null];
        };
    }

    /** One value exactly, inside a union. */
    private static function literal(string $expected): Closure
    {
        return function (mixed $value, array $path, array &$issues) use ($expected) {
            if ($value === $expected) {
                return [self::OK, $value];
            }
            $issues[] = [$path, "Invalid literal value, expected \"$expected\""];

            return [self::ABORTED, null];
        };
    }

    // ── the file format ──────────────────────────────────────────────────────

    private static function anchor(): Closure
    {
        return self::string(['regex', self::SLUG], ['max', 80]);
    }

    private static function route(): Closure
    {
        return self::string(['starts', '/'], ['max', 200]);
    }

    /** The articles most relevant to a walkthrough or step. Opaque: never fetched or checked. */
    private static function articleHints(): Closure
    {
        return self::array(self::string(['min', 1], ['max', 500]), 0, 5);
    }

    private static function words(int $max): Closure
    {
        return self::string(['trim', null], ['min', 1], ['max', $max]);
    }

    private static function doneWhen(): Closure
    {
        $kinds = ['clicked', 'filled', 'chosen', 'appears', 'route'];
        $options = [
            'clicked' => self::object(['kind' => self::enum('clicked', 'filled', 'chosen')]),
            'appears' => self::object(['kind' => self::enum('appears'), 'anchor' => self::anchor()]),
            'route' => self::object(['kind' => self::enum('route'), 'route' => self::route()]),
        ];
        $options['filled'] = $options['chosen'] = $options['clicked'];

        return function (mixed $value, array $path, array &$issues) use ($kinds, $options) {
            if (! is_object($value)) {
                return self::wrong('object', $value, $path, $issues);
            }
            $kind = $value->kind ?? null;
            if (! is_string($kind) || ! in_array($kind, $kinds, true)) {
                $issues[] = [[...$path, 'kind'], "Invalid discriminator value. Expected '".implode("' | '", $kinds)."'"];

                return [self::ABORTED, null];
            }

            return $options[$kind]($value, $path, $issues);
        };
    }

    private static function step(): Closure
    {
        $side = self::enum('top', 'bottom', 'left', 'right');

        return self::object([
            'anchor' => self::nullable(self::anchor()),
            'route' => self::optional(self::route()),
            'title' => self::words(80),
            'body' => self::words(400),
            'side' => self::optional($side),
            'align' => self::optional(self::enum('start', 'center', 'end')),
            'wait_for' => self::optional(self::enum('appear', 'person')),
            'advance_on_click' => self::optional(self::boolean()),
            'done_when' => self::optional(self::doneWhen()),
            'optional' => self::optional(self::boolean()),
            'help_after' => self::optional(self::integer(1, 120)),
            'blocked' => self::optional(self::array(self::object([
                'anchor' => self::anchor(),
                'title' => self::optional(self::words(80)),
                'body' => self::words(400),
            ]), 0, 5)),
            'only_if' => self::optional(self::union(self::anchor(), self::array(self::anchor(), 1, 5))),
            'phone' => self::optional(self::union(self::literal('skip'), self::object([
                'anchor' => self::optional(self::nullable(self::anchor())),
                'title' => self::optional(self::words(80)),
                'body' => self::optional(self::words(400)),
                'side' => self::optional($side),
            ]))),
            'articles' => self::optional(self::articleHints()),
            'missing' => self::union(self::enum('centred', 'end'), self::object([
                'alt' => self::optional(self::anchor()),
                'body' => self::optional(self::words(400)),
            ])),
        ]);
    }

    public static function steps(): Closure
    {
        return self::array(self::step(), 1, 30);
    }

    /** `createFileSchema`. format_version comes first, so a newer file gets that message, not a complaint about a field it added. */
    public static function file(): Closure
    {
        $newest = self::FORMAT_VERSION;
        $newer = fn (mixed $v) => $v > $newest ? "this file is format $v, but this version of the package only reads up to format $newest. Update the package to use it." : null;
        $slug = fn () => self::string(['regex', self::SLUG], ['max', 120]);

        return self::object([
            'format_version' => self::optional(self::integer(1, null, $newer)),
            'number' => self::optional(self::integer(1, 999_999_999)),
            'slug' => $slug(),
            'title' => self::words(120),
            'mode' => self::optional(self::enum('show', 'guide')),
            'article' => self::optional(self::nullable($slug())),
            'articles' => self::optional(self::articleHints()),
            'permission' => self::optional(self::nullable(self::string(['min', 1], ['max', 120]))),
            'offer_on' => self::optional(self::nullable(self::route())),
            'reoffer_from' => self::optional(self::integer(1)),
            'status' => self::optional(self::enum('draft', 'live', 'inactive')),
            'steps' => self::steps(),
        ]);
    }

    // ── the request bodies ───────────────────────────────────────────────────

    public static function event(): Closure
    {
        return self::object([
            'event' => self::enum('started', 'paused', 'completed', 'dismissed', 'step'),
            'version' => self::integer(1),
            'step' => self::integer(0, 29),
            'how' => self::optional(self::enum('next', 'back', 'done', 'skipped')),
            'from' => self::optional(self::enum('offer', 'article', 'checklist', 'chat', 'list', 'dev')),
        ]);
    }

    public static function offersBody(): Closure
    {
        return self::object(['offer_walkthroughs' => self::boolean()]);
    }

    public static function versionBody(): Closure
    {
        return self::object(['from_version' => self::integer(1), 'status' => self::enum('draft', 'live', 'inactive')]);
    }

    public static function linkBody(): Closure
    {
        return self::object(['link' => self::string(['min', 1], ['max', 1024])]);
    }

    /** The steps themselves are checked when they are saved, as any walkthrough file's are. */
    public static function recordingBody(): Closure
    {
        $record = fn (mixed $value, array $path, array &$issues) => is_object($value) ? [self::OK, $value] : self::wrong('object', $value, $path, $issues);

        return self::object(['link' => self::string(['min', 1], ['max', 1024]), 'steps' => self::array($record, 1, 30)]);
    }

    // ── checks ───────────────────────────────────────────────────────────────

    /** `retiredPattern`: `work order` also catches `Workorders` and `work-order`. */
    private static function retiredPattern(array|string $words): ?string
    {
        if (is_string($words) || ! $words) {
            return $words ?: null;
        }
        $each = array_map(fn (string $word) => implode('[\s-]?', array_map(fn ($part) => preg_quote($part, '/'), preg_split('/\s+/', trim($word)))).'s?', $words);

        return '/\b('.implode('|', $each).')\b/i';
    }

    /** `stepProblems`: everything wrong with parsed steps that their shape can't show. Empty = fine. */
    public static function stepProblems(array $steps, Connectors $app): array
    {
        $problems = [];
        $retired = self::retiredPattern($app->retiredWords());
        foreach ($steps as $i => $s) {
            $at = 'step '.($i + 1);
            $phone = is_object($s->phone ?? null) ? $s->phone : null;
            $missing = is_object($s->missing) ? $s->missing : null;
            $done = $s->done_when ?? null;
            $anchors = [
                ['', $s->anchor],
                ['fallback ', $missing->alt ?? null],
                ['phone ', $phone->anchor ?? null],
                ['done-when ', $done?->kind === 'appears' ? $done->anchor : null],
                ...array_map(fn ($b) => ['blocked ', $b->anchor], $s->blocked ?? []),
                ...array_map(fn ($id) => ['only-if ', $id], (array) ($s->only_if ?? [])),
            ];
            foreach ($anchors as [$kind, $id]) {
                if ($id && ! $app->anchorExists($id)) {
                    $problems[] = "$at: no {$kind}element “{$id}” in the app";
                }
            }
            foreach (array_filter([$s->route ?? null, $done?->kind === 'route' ? $done->route : null]) as $route) {
                if (! $app->routeExists($route)) {
                    $problems[] = "$at: no page “{$route}” in the app";
                }
            }
            $missingBody = $missing->body ?? '';
            $copy = implode(' ', [$s->title, $s->body, $phone ? ($phone->title ?? '').' '.($phone->body ?? '') : '', $missingBody]);
            if ($retired && preg_match($retired, $copy, $m)) {
                $problems[] = "$at: “{$m[0]}” is a retired word";
            }
            if (($s->phone ?? null) !== 'skip') {
                $touch = implode(' ', [$phone->title ?? $s->title, $phone->body ?? $s->body, $missingBody]);
                if (preg_match(self::MOUSE_WORDS, $touch, $m)) {
                    $problems[] = "$at: “{$m[0]}” can’t be done on a touch screen: add phone copy (tap)";
                }
            }
        }

        return $problems;
    }

    /** `unwrittenSteps`: step numbers (from 1) still holding a recording's placeholder words. */
    public static function unwrittenSteps(array $steps): array
    {
        $numbers = [];
        foreach ($steps as $i => $s) {
            if (($s->title ?? null) === self::UNWRITTEN_TITLE || ($s->body ?? null) === self::UNWRITTEN_BODY) {
                $numbers[] = $i + 1;
            }
        }

        return $numbers;
    }

    /** `recordingFile`: recorded steps as a walkthrough file, blank words filled. JavaScript's `||`, so "0" counts as words. */
    public static function recordingFile(array $steps): object
    {
        $blank = fn (mixed $v) => in_array($v, [null, '', 0, 0.0, false], true);
        $filled = array_map(function (object $s) use ($blank) {
            $s = clone $s;
            $s->title = $blank($s->title ?? null) ? self::UNWRITTEN_TITLE : $s->title;
            $s->body = $blank($s->body ?? null) ? self::UNWRITTEN_BODY : $s->body;

            return $s;
        }, $steps);

        return (object) ['slug' => 'recorded-walkthrough', 'title' => 'Recorded walkthrough', 'mode' => 'guide', 'steps' => $filled];
    }
}

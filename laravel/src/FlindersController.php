<?php

namespace Flinders\Laravel;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Throwable;

/** The contract over HTTP: who's asking, then one call on Flinders. Mirrors `handle` in server-flinders.ts. */
class FlindersController
{
    public function __construct(private Flinders $flinders, private Connectors $connectors)
    {
    }

    public function listWalkthroughs(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => ['data' => $this->flinders->list($p)]);
    }

    public function getMyProgress(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->mine($p));
    }

    public function setOffers(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->setOffers($p, $this->body($r)));
    }

    public function recordEvent(Request $r, string $walkthroughId): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->record($p, $walkthroughId, fn () => $this->body($r)));
    }

    public function checkRecordingLink(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->checkRecordingLink($p, fn () => $this->body($r)));
    }

    public function saveRecording(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->saveRecording($p, fn () => $this->body($r)), status: 201);
    }

    public function adminList(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => ['data' => $this->flinders->adminList($p)], admin: true);
    }

    public function adminUpload(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->adminUpload($p, $this->body($r)), admin: true, status: 201);
    }

    public function adminDetail(Request $r, string $walkthroughId): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->adminDetail($p, $walkthroughId), admin: true);
    }

    public function adminSaveVersion(Request $r, string $walkthroughId): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->adminSaveVersion($p, $walkthroughId, $this->body($r)), admin: true, status: 201);
    }

    public function adminStats(Request $r, string $walkthroughId): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->adminDetail($p, $walkthroughId)['stats'], admin: true);
    }

    public function adminCreateRecordingLink(Request $r): JsonResponse
    {
        return $this->answer($r, fn (Person $p) => $this->flinders->createRecordingLink($p), admin: true, status: 201);
    }

    public function unknownRoute(Request $r): JsonResponse
    {
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (str_starts_with((string) $route->getName(), 'flinders.') && $route->matches($r, false)) {
                return $this->failure(405, 'method_not_allowed', 'That route doesn’t take this method.');
            }
        }

        return $this->failure(404, 'not_found', 'No such route.');
    }

    private function answer(Request $request, Closure $run, bool $admin = false, int $status = 200): JsonResponse
    {
        try {
            $person = $this->connectors->person($request);
            if (! $person) {
                return $this->failure(401, 'unauthorized', 'Sign in first.');
            }
            if ($admin && ! $person->admin) {
                return $this->failure(403, 'forbidden', 'This is for admins.');
            }

            return $this->json($run($person), $status);
        } catch (FlindersError $e) {
            return $this->failure($e->status, $e->errorCode, $e->getMessage());
        } catch (Throwable $e) {
            report($e);

            return $this->failure(500, 'internal', 'Something went wrong.');
        }
    }

    /** Decoded to objects, not arrays: `{}` and `[]` mean different things in a walkthrough file. */
    private function body(Request $request): mixed
    {
        $text = $request->getContent();
        if ($text === '') {
            return Schema::missing();
        }
        $body = json_decode($text);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw FlindersError::invalid('That isn’t JSON.');
        }

        return $body;
    }

    private function failure(int $status, string $code, string $message): JsonResponse
    {
        return $this->json(['error' => ['code' => $code, 'message' => $message]], $status);
    }

    private function json(mixed $body, int $status): JsonResponse
    {
        return new JsonResponse($body, $status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}

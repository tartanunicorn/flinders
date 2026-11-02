<?php

namespace App\Providers;

use App\Models\User;
use Flinders\Laravel\Connectors;
use Flinders\Laravel\Flinders;
use Flinders\Laravel\FlindersError;
use Flinders\Laravel\Person;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Throwable;

/** Signs test users in by a bearer token, and lets the kit check the database rules. Test rig only. */
class TestProvider extends ServiceProvider
{
    public function register(): void
    {
        config(['auth.guards.test' => ['driver' => 'test-token']]);
    }

    public function boot(): void
    {
        Auth::viaRequest('test-token', fn (Request $r) => User::where('api_token', $r->bearerToken())->first());
        Gate::define('manage-walkthroughs', fn (User $user) => (bool) $user->is_admin);

        // The kit asks: does the database itself refuse an edit or a delete?
        Route::get('/_rig/append-only', function () {
            $table = fn () => DB::table(config('flinders.tables.versions'));
            $refused = function ($write) {
                try {
                    $write();

                    return false;
                } catch (Throwable) {
                    return true;
                }
            };

            return [
                'rows' => $table()->count(),
                'update_refused' => $refused(fn () => $table()->update(['number' => 5])),
                'delete_refused' => $refused(fn () => $table()->delete()),
                'rows_after' => $table()->count(),
            ];
        });

        // What the kit skips on a full backend: features left off, and the default Connectors' lists.
        Route::get('/_rig/defaults', function () {
            config(['flinders.recording.secret' => null]);
            $plain = new Connectors;
            $flinders = new Flinders($plain);
            $person = new Person('someone');
            $status = function ($call) {
                try {
                    $call();

                    return 'no refusal';
                } catch (FlindersError $e) {
                    return "$e->status $e->errorCode";
                }
            };
            file_put_contents('/tmp/anchors.json', '["listed"]');
            config(['flinders.anchors' => '/tmp/anchors.json']);

            return [
                'offers' => $status(fn () => $flinders->setOffers($person, (object) ['offer_walkthroughs' => true])),
                'offers_bad_body_first' => $status(fn () => $flinders->setOffers($person, (object) [])),
                'link' => $status(fn () => $flinders->createRecordingLink($person)),
                'check' => $status(fn () => $flinders->checkRecordingLink($person, fn () => (object) [])),
                'save' => $status(fn () => $flinders->saveRecording($person, fn () => (object) [])),
                'offers_default_on' => $flinders->mine($person)['offer_walkthroughs'],
                'listed' => [$plain->anchorExists('listed'), $plain->anchorExists('not-listed')],
            ];
        });
    }
}

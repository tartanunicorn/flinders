<?php

namespace Flinders\Laravel;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Everything a product plugs in. These defaults read config/flinders.php: Laravel's own sign-in and
 * Gate. Extend this class and override what differs, then name it in `connectors` or bind it.
 */
class Connectors
{
    /** Who's signed in; null = nobody. */
    public function person(Request $request): ?Person
    {
        $user = $request->user(config('flinders.guard'));
        if (! $user) {
            return null;
        }
        $owner = config('flinders.owner_attribute');

        return new Person(
            id: (string) $user->getAuthIdentifier(),
            admin: Gate::forUser($user)->allows(config('flinders.admin_ability')),
            owner: $owner && $user->{$owner} !== null ? (string) $user->{$owner} : null,
            user: $user,
        );
    }

    /** Asked on every use of a recording link. */
    public function mayRecord(Person $person): bool
    {
        return Gate::forUser($person->user)->allows(config('flinders.record_ability'));
    }

    /** The person's offers switch. Null = they haven't set it: on. */
    public function offers(Person $person): ?bool
    {
        return null;
    }

    /** Saves the switch. False = this product hasn't set it up, and the route answers feature_off. */
    public function setOffers(Person $person, bool $on): bool
    {
        return false;
    }

    public function anchorExists(string $id): bool
    {
        return $this->listed('anchors', $id);
    }

    public function routeExists(string $route): bool
    {
        return $this->listed('pages', $route);
    }

    /** @return string[]|string A list of words, or a PCRE pattern. */
    public function retiredWords(): array|string
    {
        return config('flinders.retired_words', []);
    }

    private function listed(string $key, string $value): bool
    {
        $file = config("flinders.$key");
        if (! $file) {
            return true;
        }

        // `flinders-check --list` writes a bound element as its fixed start and a star: open-*.
        foreach (json_decode(file_get_contents($file), true) as $listed) {
            if (Str::is($listed, $value)) {
                return true;
            }
        }

        return false;
    }
}

<?php

namespace App\Flinders;

use Flinders\Laravel\Connectors;
use Flinders\Laravel\Person;

/** The only product code a real app needs: the offers switch on its users, and what's in the app. */
class TestConnectors extends Connectors
{
    public function offers(Person $person): ?bool
    {
        $on = $person->user->fresh()->offer_walkthroughs;

        return $on === null ? null : (bool) $on;
    }

    public function setOffers(Person $person, bool $on): bool
    {
        $person->user->forceFill(['offer_walkthroughs' => $on])->save();

        return true;
    }

    public function anchorExists(string $id): bool
    {
        return $id !== 'conformance-no-such-element';
    }

    public function routeExists(string $route): bool
    {
        return $route !== '/conformance-no-such-page';
    }
}

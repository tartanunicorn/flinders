# flinders/laravel

The Flinders server for Laravel and MySQL. It serves the same HTTP contract as `flinders/server`, so the browser code works against either, and the same conformance kit proves both.

Needs PHP 8.2+, Laravel 11, 12 or 13, and MySQL 8.0.16+ (tested on PHP 8.4 and MySQL 8.4). MariaDB isn't supported.

Installing a whole product, with an Angular admin and app on different domains? Follow [Install on Laravel and Angular](../docs/install.md), which a coding agent can run from one prompt. This page is the reference for the server on its own.

## Install

Add the package from wherever you keep this folder, then migrate:

```sh
composer config repositories.flinders path ../flinders/laravel
composer require "flinders/laravel:*@dev"
php artisan vendor:publish --tag=flinders-config
php artisan migrate
```

The service provider is found on its own. The routes appear under `/flinders`, each named `flinders.<operationId>`; `php artisan route:list --name=flinders` lists them.

Point the browser at it:

```ts
createFlinders({ http: { baseUrl: '/flinders' } });
```

## Wire up who's signed in

With Laravel's own sign-in and Gate, this is only config. In `config/flinders.php`:

```php
'guard' => 'sanctum',
'owner_attribute' => 'company_id',       // Each company gets its own walkthroughs
'admin_ability' => 'manage-walkthroughs',
'record_ability' => 'manage-walkthroughs',
```

Then define the abilities, which are denied until you do:

```php
Gate::define('manage-walkthroughs', fn (User $user) => $user->isAdmin());
```

Leave `auth` out of `routes.middleware`. The routes answer their own 401 in the contract's error shape, which Laravel's middleware wouldn't. If you use the `web` group or a cookie sign-in, the browser must send Laravel's CSRF token.

A person sees the product's own walkthroughs (owner null) and their company's. An admin manages exactly their own owner's: a person whose owner is null manages the product's.

## Swap anything else

Everything a product plugs in is one class, `Flinders\Laravel\Connectors`. Extend it, override what differs, and name it in `connectors` (or bind `Connectors::class` in a service provider):

```php
class WalkthroughConnectors extends Connectors
{
    // Who's asking, if your sign-in isn't the default.
    public function person(Request $request): ?Person
    {
        $user = $request->user();

        return $user ? new Person(id: (string) $user->id, admin: $user->is_staff, owner: $user->is_staff ? null : $user->company_id, user: $user) : null;
    }

    // The offers switch. Without these, offers are on and PATCH /offers answers feature_off.
    public function offers(Person $person): ?bool
    {
        return $person->user->offer_walkthroughs;
    }

    public function setOffers(Person $person, bool $on): bool
    {
        $person->user->forceFill(['offer_walkthroughs' => $on])->save();

        return true;
    }

    // What's in the app, if a list file isn't enough.
    public function anchorExists(string $id): bool { /* ... */ }
    public function routeExists(string $route): bool { /* ... */ }
}
```

Keep the switch wherever your settings live: a nullable column on `users` is enough.

## Point it at your tables

Set the names before you migrate. Any names work:

```php
'tables' => ['versions' => 'help_walkthroughs', 'progress' => 'help_walkthroughs_progress'],
'owner_column' => 'company_id',
'connection' => 'mysql',
```

## Check steps against your app

The `validation.app` rule needs to know what's in the app. Give `anchors` and `pages` the path of a JSON array each, generated at build time, or override the two methods above. `flinders-check --list` writes the elements; an entry ending in `*`, such as `open-*`, takes any ending. Left null, neither is checked. `retired_words` takes a list of words or a PCRE pattern.

## Recording links

Set `FLINDERS_RECORDING_SECRET` and `FLINDERS_WEB_URL`. Without both, those routes answer `feature_off`. Links use the contract's format, so a link made by a Node server with the same secret checks here too.

The admin site calls `flinders.record()` from the browser package: it opens the link and spots the draft. The web site's calls need CORS if it's another origin, and the signed-in person must have the same id on both sites, or the check answers `not_allowed`: see [the install guide](../docs/install.md).

## Triggers

Versions are append-only. The code only ever inserts, and two triggers make MySQL refuse an UPDATE or DELETE.

With binary logging on, which is the default, an ordinary database user can't create a trigger and the migration stops with error 1419, leaving the tables made. Either set `log_bin_trust_function_creators=1` on the server (RDS and Aurora: in the parameter group) before migrating, or set `FLINDERS_APPEND_ONLY_TRIGGERS=false` and rely on the code. After a stopped migration, drop the two empty tables, then migrate again; any migration after it waits until you do.

The numbering lock is `GET_LOCK`, which belongs to a connection, so a proxy that shares connections between statements (ProxySQL, say) needs it pinned. The unique indexes still stop a duplicate; the second save would answer 500.

## Prove it

With Docker running, from this folder:

```sh
docker compose -f docker/compose.yaml up --build --abort-on-container-exit --exit-code-from kit
```

It builds a fresh Laravel app with this package, on MySQL, and runs the conformance kit against it. It exits 0 only if every rule passes with none skipped, every answer fits `contract/openapi.yaml`, and the rig's own checks pass:

- bad files get the same words as the TypeScript schema;
- uploads made at once take numbers and versions in a row;
- MySQL itself refuses an edit or a delete;
- features left off answer `feature_off`.

Set `LARAVEL_VERSION='^11'` or `'^12'` to try another Laravel. Add `RIG_VERSIONS_TABLE`, `RIG_PROGRESS_TABLE` and `RIG_OWNER_COLUMN` to try other names.

## Differences from the TypeScript server

The contract is the same. Past it, this package leaves out:

- `articles` and `people`: `article_title` is null, and `updated_by` and `created_by` are ids.
- `permissions`: a step file's `permission` can be any text.
- `events`: use Laravel's own logging around the routes.
- `skipIfSame` seeding and AI drafts: neither is on the contract.

A JSON column doesn't keep key order, so a step's keys can come back in another order. Nothing reads them by order.

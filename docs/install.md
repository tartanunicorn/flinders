# Install on Laravel and Angular

This is the one route in for a product with its admin on `admin.<domain>` and its app on `web.<domain>`, including recording across the two. It's written for a coding agent to follow from start to finish. [The rollout checklist](rollout-checklist.md) is the one-page version for the person in charge. Copy the Flinders folder into the repo, then paste this one line:

```text
Install Flinders in this product: follow packages/flinders/docs/install.md from start to finish, ask me only what the codebase can't answer, and finish by running its checklist and telling me each result.
```

**If you're the agent:** work through the steps in order. Fit the code below to what you find, keeping every Flinders name exactly as written, and don't change anything inside the Flinders folder. If another product's Flinders wiring is to hand, copy from it only the calls to Flinders' own public names; its stores, services, words and UI kit belong to that product.

`web.domain.com` and `admin.domain.com` below stand for the real addresses, and `yourToast` and the other `your…` names for what the product already has.

## How it behaves

Tell the person installing this, and put it in your own help text.

- **Recording opens a new tab.** The admin's **+ Record walkthrough** button opens the web site in a new tab. Changing the URL by hand doesn't work, because the link has to come through the button. A tab opened by hand has no recording bar.
- **Moving around keeps the recording.** It's held in that tab, so moving between pages, reloading and signing in on the web site all keep it.
- **Finish saves and jumps back.** On Finish the steps save through the API and a recording opened in a new tab closes, so the person lands in the admin tab, where the draft opens. Set `recording: { jumpBack: false }` to keep it open. If the browser won't close it, the tab stays with the saved message.
- **The link only works for the person who made it.** Admin and web must see the same user id, or the check answers `not_allowed`. Step 1 finds out, and [Fixing `not_allowed`](#fixing-not_allowed) gives the options.
- **Another origin needs CORS.** If the web site calls the API on another origin, the API must allow it.
- **Pop-ups must be allowed.** A browser may stop the new tab, more so if the API was slow to answer. The button then says to allow pop-ups for the admin site and press it again.
- **Show me clicks nothing.** It can't open a page with an id unless the walkthrough started on one, so a Show me recorded from a list into `/projects/:projectId` stops there. Start it on that page, or make it a Guide me, where the person's own click gives the id. `draftProblems` warns of this.

## Step 1: Find out

Look in the codebase first. Ask the person only what isn't there, all at once. Stop and say so if a **Stop if** applies.

| Find out | Where to look | What it decides |
|---|---|---|
| Laravel, PHP and database versions | `composer.json`, `config/database.php`, `SELECT VERSION()` | **Stop if** it's below Laravel 12, PHP 8.2 or MySQL 8.0.16, or it's MariaDB |
| Can the migration create triggers? | `SELECT @@log_bin, @@log_bin_trust_function_creators` as the app's database user | `1` and `0`, without `SUPER`, means error 1419 in step 3. Before migrating, have the flag set, or set `FLINDERS_APPEND_ONLY_TRIGGERS=false`. See "Triggers" in [the Laravel README](../laravel/README.md) |
| Where admin and web live | Root folders, `angular.json`, deploy config | One Angular workspace or two; the paths in step 2 |
| Angular version and `moduleResolution` | `package.json`, `tsconfig.json` | It must be `bundler`, which `"module": "preserve"` gives by default. If it's `node`, change it, or Flinders' entry points won't resolve. The samples were built on Angular 22 and use `@if`, `@let` and `@else if (…; as x)`: rewrite those on an older Angular |
| The router on each site | `app.config.ts` or `app.routes.ts` | Where `routes` come from; whether `withHashLocation` is on (it's fine: the link is read before the router starts) |
| The first code that runs on web | `main.ts` | Where the one line of `RecordingTab` goes |
| How web knows who's signed in | The auth service, a guard | `identity.id`. If sign-in opens another tab, change it to stay in this one, or the link is left behind |
| How Angular sends sign-in | HTTP interceptors, `withCredentials`, Sanctum or a token | Flinders' calls go through the same `HttpClient`, so they carry it. A token held per site means signing in on web as well; a shared cookie doesn't |
| Which Laravel guards exist | `config/auth.php` | `guard`, and whether `person()` must be overridden |
| How permissions work | Gates, policies, a role column, a permissions package | The body of the `manage-walkthroughs` ability |
| **Do admin and web share a user id?** | `users` tables, guards, what each site's `/me` returns | Same table and id: nothing to do. Otherwise see [Fixing `not_allowed`](#fixing-not_allowed) first |
| Do customers own their own walkthroughs? | A `company_id` on users, tenancy code | `owner_attribute`, or leave it null |
| The API's origin | `environment.ts` on each site, `config/cors.php` | `http.baseUrl`, and whether step 3's CORS is needed |
| Security headers on web and admin | Web server config, CSP middleware | `connect-src` must let both sites call the API |
| Does the production build strip `data-testid`? | Build plugins, Angular transforms | **Stop if** it does and can't be turned off: pick another attribute with [Matching your design](matching-your-design.md) |

## Step 2: Add the packages

Keep one copy of the Flinders folder in the repo at `packages/flinders`, outside `vendor`, which belongs to Composer. Flinders isn't on npm or Packagist. Paths below are from the repo root; adjust them when the Laravel app or an Angular site sits in a subfolder, because each path is relative to that app.

```sh
(cd packages/flinders && npm install && npm run build)

composer config repositories.flinders path packages/flinders/laravel
composer require "flinders/laravel:*@dev"
php artisan vendor:publish --tag=flinders-config

# From each Angular site's own folder. One workspace needs it once.
npm install ../packages/flinders
```

`dist` isn't committed, so add the first line to every build that compiles either site, and include the folder in any Docker build context. Composer links the package rather than copying it, so a container running Laravel must see `packages/flinders` at the same relative path, and an image copying only the Laravel app needs `"options": { "symlink": false }` on that repository. If PHP only runs in Docker, run the Composer and `artisan` lines there.

Add the stylesheet to the web site's `styles` in `angular.json`, and to the admin's if it previews walkthroughs:

```text
"styles": ["src/styles.css", "node_modules/flinders/src/player.css"]
```

## Step 3: Laravel

**Config and tables.** In `config/flinders.php`, set the table names if you want your own, then migrate. Check before migrating, as a name can't change afterwards without a migration of your own.

```php
'guard' => 'sanctum',                    // The guard the API uses. Null = the default.
'owner_attribute' => null,               // 'company_id' if each company has its own walkthroughs.
'admin_ability' => 'manage-walkthroughs',
'record_ability' => 'manage-walkthroughs',
'anchors' => base_path('flinders/anchors.json'),  // Inside the Laravel app. Step 8 makes it.
'pages' => base_path('flinders/pages.json'),      // Leave both null until step 8: a named file that's missing is a 500.
```

Leave `routes.middleware` as `['api']`, and leave `auth` out of it.

```sh
php artisan migrate
```

Error 1419 means the database user can't create triggers: see "Triggers" in [the Laravel README](../laravel/README.md). The product's own later migrations stop with it, so finish this before anything else.

**Environment.** Add these to every environment. The secret stays on the server, and every API server in one environment uses the same one.

```sh
FLINDERS_RECORDING_SECRET=   # openssl rand -base64 32
FLINDERS_WEB_URL=https://web.domain.com
```

Without both, the recording routes answer `feature_off` and the button can't work.

**Abilities.** They're denied until defined. In `AppServiceProvider::boot()`, using the product's own rule:

```php
Gate::define('manage-walkthroughs', fn ($user) => $user->isAdmin());
```

`mayRecord` is checked on the web site too, so the rule must be true for the person as the web site sees them. A rule that only an admin-site guard satisfies answers `not_allowed`.

**Connectors.** With one guard and Laravel's Gate, the config above is enough. Extend `Flinders\Laravel\Connectors` only for what differs, and name the class in `connectors`:

```php
namespace App\Flinders;

use Flinders\Laravel\Connectors;
use Flinders\Laravel\Person;

class WalkthroughConnectors extends Connectors
{
    public function offers(Person $person): ?bool
    {
        return $person->user->offer_walkthroughs;
    }

    public function setOffers(Person $person, bool $on): bool
    {
        $person->user->forceFill(['offer_walkthroughs' => $on])->save();

        return true;
    }
}
```

The two offers methods are the "don't offer me these" switch and need a nullable `offer_walkthroughs` column on `users`. Left out, offers are always on and `PATCH /offers` answers `feature_off`, so hide that setting.

**CORS.** Skip this only if each site reaches the API on its own origin. Otherwise run `php artisan config:publish cors` if `config/cors.php` isn't there, then merge these in, keeping what's already listed:

```php
'paths' => ['api/*', 'sanctum/csrf-cookie', 'flinders/*'],
'allowed_methods' => ['*'],              // Flinders uses GET, POST and PATCH.
'allowed_origins' => [env('FLINDERS_ADMIN_URL'), env('FLINDERS_WEB_URL')],
'allowed_headers' => ['*'],
'supports_credentials' => true,          // Only for cookie sign-in.
```

Add `FLINDERS_ADMIN_URL=https://admin.domain.com`. Origins are exact: no path and no trailing slash, and the port if there is one. These two replace a `*`: keep other listed origins, not that. A changed `FLINDERS_PREFIX` changes `flinders/*` too.

**Cookie sign-in (Sanctum) across subdomains.** Skip this for tokens. Both sites must get the same session, and the API must read it on `api` routes:

```sh
SESSION_DOMAIN=.domain.com
SANCTUM_STATEFUL_DOMAINS=admin.domain.com,web.domain.com
```

Call `$middleware->statefulApi()` in `bootstrap/app.php`, and set `supports_credentials` in step 3's CORS. The API must be on the same parent domain (`api.domain.com`). `SANCTUM_STATEFUL_DOMAINS` includes the port wherever there is one, as on a local machine.

Writes need the CSRF token. Angular adds it only to relative URLs, so if the API is on another origin, keep to what the product already does for its own POSTs. If it has nothing, an interceptor does both jobs:

```ts
export const crossSiteCookies: HttpInterceptorFn = (req, next) => {
  const xsrf = decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '');
  return next(req.clone({ withCredentials: true, setHeaders: xsrf ? { 'X-XSRF-TOKEN': xsrf } : {} }));
};
```

Testing locally, a cookie for `.localhost` is thrown away, so use three-part names: `admin.demo.localhost`, `web.demo.localhost`, `api.demo.localhost`, with `SESSION_DOMAIN=.demo.localhost`. Browsers reach them with no hosts file.

## Step 4: One HTTP connector, on both sites

Through the product's `HttpClient`, so its interceptors add sign-in and CSRF to Flinders' calls too. An error status is an answer, not a failure: only an unreachable API throws.

```ts
// flinders-http.ts
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import type { FlindersHttp } from 'flinders';
import { firstValueFrom } from 'rxjs';

export const flindersHttp = (http: HttpClient, baseUrl: string): FlindersHttp => ({
  baseUrl, // https://api.domain.com/flinders, or /flinders on the same origin.
  request: async ({ method, url, body }) => {
    try {
      return { ok: true, body: await firstValueFrom(http.request(method, url, { body })) };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status > 0) return { ok: false, body: error.error };
      throw error;
    }
  },
});
```

## Step 5: The web site

Put the link's one line at the top of `main.ts`. Angular creates services after the router starts, and the link has to leave the URL before a redirect can lose it:

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { RecordingTab } from 'flinders/recording-tab';
import { App } from './app/app';
import { appConfig } from './app/app.config';

new RecordingTab();

bootstrapApplication(App, appConfig).catch((error) => console.error(error));
```

Then one service holds Flinders, and is all the wiring there is. Flinders checks a recording link once someone is signed in, puts the recording bar up, loads the person's own progress, and offers each page's walkthrough as they move about. `routePattern` is what makes a recorded step say `/projects/:projectId`, not `/projects/123`, and without it recording is off.

```ts
// walkthroughs.ts
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { type ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { createFlinders, type OfferAnswer, type WalkthroughOffer } from 'flinders';
import { filter } from 'rxjs';
import { environment } from '../environments/environment';
import { flindersHttp } from './flinders-http';

function routePatternOf(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.routeConfig?.path) parts.push(route.routeConfig.path);
  }
  return `/${parts.join('/')}`;
}

@Injectable({ providedIn: 'root' })
export class Walkthroughs {
  private readonly router = inject(Router);
  private answer: ((answer: OfferAnswer) => void) | null = null;

  /** Your offer card draws this: `title`, `message`, and buttons calling `answerOffer`. */
  readonly offer = signal<WalkthroughOffer | null>(null);

  readonly flinders = createFlinders({
    http: flindersHttp(inject(HttpClient), environment.flindersUrl),
    router: {
      url: () => this.router.url,
      navigate: (url) => this.router.navigateByUrl(url),
      onNavigated: (listener) => {
        const sub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => listener(e.urlAfterRedirects));
        return () => sub.unsubscribe();
      },
      routePattern: () => routePatternOf(this.router.routerState.snapshot.root),
    },
    identity: {
      id: () => yourAuth.userId(), // Null when nobody is signed in.
      name: () => yourAuth.displayName(), // Shown on the recording bar.
      can: (permission) => yourPermissions.can(permission),
    },
    offers: {
      show: (offer) => new Promise<OfferAnswer>((resolve) => { this.answer = resolve; this.offer.set(offer); }),
      clear: () => this.offer.set(null),
    },
    toast: (message) => yourToast(message),
    labels: { recordingSaved: 'Saved as a draft. Go back to the admin tab to finish it.' },
  });

  answerOffer(answer: OfferAnswer): void {
    this.offer.set(null);
    this.answer?.(answer);
  }

  constructor() {
    console.log(this.flinders.off); // While wiring: what's off, and which connector turns it on.
  }
}
```

Inject `Walkthroughs` once in the app's root component so it exists from the first page. The offer card's buttons answer `acceptLabel` with `true`, `dismissLabel` with `false` and, when it's there, `alternativeLabel` with `'alternative'`.

**The recording bar** comes up by itself. To restyle it, pass `recording: { bar: { classes, unstyled, labels } }`; to draw your own, see [Recording](recording.md). If the person isn't signed in, your normal sign-in runs and needs no change: the link waits in the tab.

**Your own buttons.** `flinders.start(handle, 'chat')` starts a walkthrough from a chat, a help menu or a home list.

**Your chat (optional).** Someone part-way through a walkthrough can ask a question and carry on. Pass `player: { askAbout: () => yourChat.open() }`, mark the chat and its button `data-flinders-keep`, and call `flinders.hold(open)` when it opens and closes. `flinders.context()` gives your chat where they are, as plain JSON, including the articles the walkthrough names. Your chat does its own search. See [Chat and admin](chat-and-admin.md).

## Step 6: The admin site

No router is needed here. `flinders.record()` does the whole button: it asks for a link, opens the tab, says so if pop-ups are blocked, and calls `recording.onDraft` once the draft is back.

```ts
// walkthroughs-page.ts
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { type AdminWalkthrough, createFlinders } from 'flinders';
import { environment } from '../environments/environment';
import { flindersHttp } from './flinders-http';

@Component({
  selector: 'app-walkthroughs-page',
  template: `
    <button (click)="flinders.record()">+ Record walkthrough</button>
    @for (row of rows(); track row.walkthrough_id) {
      <button (click)="open(row)">{{ row.title }}: v{{ row.latest_version }} {{ row.latest_status }}</button>
    }
  `,
})
export class WalkthroughsPage {
  protected readonly flinders = createFlinders({
    http: flindersHttp(inject(HttpClient), environment.flindersUrl),
    recording: { onDraft: (draft) => void this.open(draft) },
    toast: (message) => yourToast(message),
  });
  private readonly api = this.flinders.api!;
  protected readonly rows = signal<AdminWalkthrough[]>([]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.flinders.destroy());
    void this.api.admin.list().then((list) => list.ok && this.rows.set(list.data));
  }

  protected async open(row: AdminWalkthrough): Promise<void> {
    /* Open your step editor on this walkthrough: see below. */
  }
}
```

**The step editor** is yours too. The least that works: load the draft, ask for each step's words, and save the next version.

```ts
import { clearRecordedWords, draftBlockers, draftProblems, editedFile, updateStep, walkthroughFileOf, type WalkthroughStep } from 'flinders';

const detail = await api.admin.detail(row.handle);
if (!detail.ok) return;
const version = detail.data.versions[0]!;
const steps = clearRecordedWords(version.steps as WalkthroughStep[]); // A recording's placeholder words go blank.

// Draw a title and body input per step, changing them with updateStep(steps, index, { title, body }).
const blockers = draftBlockers(steps, version.mode); // Show these, and hold Save until there are none.
const warnings = draftProblems(steps, version.mode); // Show these too: they don't stop a save.

const file = walkthroughFileOf(detail.data.number, version);
// Same number, so it's the next version. A recording has no offer_on: nothing is offered until it's set.
const saved = await api.admin.upload(editedFile({ file: { ...file, offer_on: offerOn || null }, title, mode, steps }));
if (saved.ok) await api.admin.saveVersion(saved.data.handle, saved.data.version, 'live'); // Your Make live button.
```

Give the title an input, as it arrives as `Recorded walkthrough`, and the page it's offered on (a route pattern such as `/projects/:projectId`) and Show me or Guide me (`show` or `guide`).

## Step 7: Mark the elements

Recording and playing both find elements by `data-testid`, on the web site.

- Every button, link, field and tab a walkthrough may touch needs one. A click on something without one captures nothing, and the bar shows a warning. The nearest marked parent counts, so one on a row covers what's inside it.
- Names say what the element is and never change: `new-project`, not `button-3`.
- Don't put record ids in them. A step recorded on `project-123` finds nothing for anyone else. In a list, mark the row people should start from: `[attr.data-testid]="$first ? 'first-project' : null"`.
- Add them to the screens the first walkthroughs cover, and in every shared button, input and tab component pass the attribute through to the real element.
- Mark sticky bars `data-flinders-bar` and a phone's bottom bar `data-flinders-bottom-bar`, so the card stays clear of them.

## Step 8: Generate the elements and pages lists

Saves check every step against these lists, so a step naming something that's gone is refused with a message. Generate both from the web site, at every build, and deploy them with the API, at the paths step 3 named: `base_path` is the Laravel app, wherever that sits. A stale list makes **Finish** fail on a new element, and a missing file answers 500. If the deploy can't carry them, leave `anchors` and `pages` null, and nothing is checked.

**Elements.** `flinders-check --list` writes them. A bound element comes out as its fixed start and a star, `open-*`, which Laravel reads as any ending. The commands below have Laravel at the repo root; adjust the path if it isn't.

```sh
(cd web && npx flinders-check --source src --list ../flinders/anchors.json)
```

**Pages.** Nothing can read Angular's nested and lazy routes from text, so a spec walks the real ones, with the same joining as `routePatternOf`, and fails with the new list when `flinders/pages.json` is out of date:

```ts
// pages.spec.ts
import type { Route, Routes } from '@angular/router';
import pages from '../../../flinders/pages.json';
import { routes } from './app.routes';

async function pagesOf(list: Routes, base = ''): Promise<string[]> {
  const found: string[] = [];
  for (const route of list) {
    if (route.redirectTo !== undefined || route.path === '**') continue;
    const path = route.path ? `${base}/${route.path}` : base;
    if (route.component || route.loadComponent) found.push(path || '/');
    const loaded = (await route.loadChildren?.()) as Routes | { default: Routes } | undefined;
    const children = route.children ?? (loaded && 'default' in loaded ? loaded.default : loaded) ?? [];
    found.push(...(await pagesOf(children as Route[], path)));
  }
  return [...new Set(found)].sort();
}

it('flinders/pages.json is up to date', async () => {
  expect(pages).toEqual(await pagesOf(routes));
});
```

It needs `resolveJsonModule` in the spec's tsconfig. To make the first list, put `[]` in the file and copy in what the failure prints. Include admin's elements and pages only if walkthroughs will run on the admin site too.

Add `npx flinders-check --source src --walkthroughs <folder>` to the web site's build as well if you keep walkthrough files in the repo.

## Step 9: Checklist

Run all of it, in order, and report each result.

1. `php artisan route:list --name=flinders` lists 12 routes.
2. Both sites build, and in the web site's production bundle `data-testid` is still there.
3. As a signed-in admin, the web site's console shows no `flinders.off` line about recording.
4. **The conformance kit.** Run it against a test database, never a real one: it adds walkthroughs and never removes any. Copy `.env` to `.env.testing`, with its own `DB_DATABASE` and `FLINDERS_RECORDING_SECRET=test-secret`: `artisan serve` ignores a variable set on its command line if the env file has it. It needs four people: `admin`, who has the ability and no owner; `person` and `person2`, ordinary people; and `other-admin`, who manages another company's. With Sanctum, `$user->createToken('kit')->plainTextToken` makes each token. With no companies, leave out `other-admin`, and the owner rules skip and say so. Any other skip or failure is a real problem.

   ```sh
   php artisan migrate --env=testing
   php artisan serve --env=testing

   cd packages/flinders
   node bin/flinders-conformance.mjs --url http://localhost:8000/flinders \
     --user admin="Authorization: Bearer <admin token>" \
     --user person="Authorization: Bearer <person token>" \
     --user person2="Authorization: Bearer <person2 token>" \
     --user other-admin="Authorization: Bearer <other admin token>" \
     --recording-secret test-secret \
     --offer-on /
   ```

   `--offer-on` takes a page in `pages.json`. In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` before `node`, or `/` turns into a folder. For cookie sign-in, pass `--sign-in <file.mjs>`: see [the server contract](server-contract.md).

5. **CORS.** Skip this if step 3's was skipped. Each answer must carry that exact origin in `access-control-allow-origin`:

   ```sh
   curl -si -X OPTIONS https://api.domain.com/flinders/recording-links/check \
     -H "Origin: https://web.domain.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
   curl -si -X OPTIONS https://api.domain.com/flinders/admin/recording-links \
     -H "Origin: https://admin.domain.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
   ```

6. **Two sites, by hand.** An agent with a browser can do this; otherwise hand it to the person. Use two real hostnames, such as `admin.localhost` and `web.localhost` (`admin.demo.localhost` and `web.demo.localhost` for a shared cookie): cookies ignore ports, so two ports on `localhost` can hide a sign-in problem. Use test data. Playwright switches the pop-up blocker off, and its headless shell doesn't block: to test that row in a script, use a browser such as Edge with `ignoreDefaultArgs: ['--disable-popup-blocking']` and an API delayed by over 5 seconds.

   | Do | Expect |
   |---|---|
   | Open the admin signed in, and press **+ Record walkthrough** | A new tab on the web site, with no `flinders_record` left in its address |
   | Look at the new tab | **Ready to record**, or your sign-in page if not signed in there; after signing in, the bar appears |
   | Go to another page, then press **Start recording** | The bar shows Recording · 0 steps |
   | Click two marked elements | 2 steps |
   | Click something unmarked | A warning, and still 2 steps |
   | Press **This has paths**, click down one path, **Next path**, go back, **Record path**, click down the other, **End paths** | Each path's steps count, and the draft shows them as paths |
   | Reload the tab | Still Recording · 2 steps |
   | Press **Finish** | Saved as a draft, and the tab closes |
   | You land back in the admin tab | The draft opens in your step editor |
   | Write the words, set the page, save and make it live | It plays on the web site, and is offered on its page if it has `offer_on` |
   | As an ordinary person, take the offer to the end, then reload | Not offered again |
   | Sign out and sign in as someone else in that tab | That person is offered it |
   | Open the web site in a plain tab | No bar |
   | Block pop-ups for the admin site, then press the button | The message saying to allow them; no error |
   | Press the button, then sign in on web as someone else | The `not_allowed` message, and no bar |

## When it goes wrong

| What you see | Why | Fix |
|---|---|---|
| The tab opens, with no bar and no message | `identity.id` is null, or `Walkthroughs` was never injected | Inject it in the root component, and check `flinders.off` |
| The tab opens on the wrong site, or the link can't be made | `FLINDERS_WEB_URL` is wrong, or a missing setting answers `feature_off` | Set both env values, then `php artisan config:clear` |
| The link is still in the address bar | `new RecordingTab()` runs too late, or not at all | Make it the first thing in `main.ts` |
| Browser console says CORS | Origin or path not allowed | Step 3's CORS, then checklist item 5 |
| 401 on the web site though signed in | Sign-in isn't going with Flinders' calls | Use `flindersHttp` with the product's `HttpClient`; check cookie domains or the token interceptor |
| 419 on a POST | CSRF token missing | Send it as the product does for its own POSTs |
| `not_allowed` | A different id, or `mayRecord` is false there | [Fixing `not_allowed`](#fixing-not_allowed) |
| Finish says an element or page isn't in the app | The lists are stale | Regenerate them and deploy (step 8) |
| Finish says it wasn't saved, and the log says `file_get_contents` | A list named in the config isn't on the server | Deploy it (step 8), or set it to null |
| Nothing is offered | The draft has no `offer_on`, or `offers` is missing a connector | Set the page in your step editor; check `flinders.off` |
| The next person in a tab is offered nothing | No `identity.id` connector | Step 5 |
| A Show me stops at a page with an id | It clicks nothing, so it has no id | Start it on that page, or make it a Guide me |
| The draft is saved but never opens | No `recording.onDraft`, or the draft went to another owner | Step 6; check `owner_attribute` gives the same owner on both sites |
| Every click says no anchor | The build strips `data-testid`, or a shared component doesn't pass it down | Step 1 and step 7 |
| Steps say `/` for every page | `routePattern` isn't walking the routes | Use `routePatternOf` as written |

### Fixing `not_allowed`

A link records who made it, and the check compares that with the person calling from the web site. Both the id and the ability must match, on both sites. Pick the first that fits:

1. **One users table, two accounts for one person.** Sign in on the web site with the same account as the admin. Nothing to build.
2. **Two tables that can be linked.** Add a `web_user_id` column to the admin users table, and report that id from `person()`, so an admin counts as their web user:

   ```php
   public function person(Request $request): ?Person
   {
       $admin = $request->user('admin');
       $user = $admin ?? $request->user('sanctum');
       if (! $user) {
           return null;
       }

       return new Person(id: (string) ($admin?->web_user_id ?? $user->getAuthIdentifier()), admin: $admin !== null, owner: null, user: $user);
   }

   public function mayRecord(Person $person): bool
   {
       return $person->user instanceof Admin || Admin::where('web_user_id', $person->id)->exists();
   }
   ```

   `admin` and `sanctum` are guards: use the product's own. With Sanctum tokens, `admin` is a guard in `config/auth.php` with `'driver' => 'sanctum', 'provider' => 'admins'`, which only an admin's token passes, and the plain `sanctum` guard takes the web user's token. A session guard such as `web` sees no tokens. `Admin` is the product's admin model, and `mayRecord` is there because a web user isn't an admin by Gate.
3. **Two tables with nothing to link them.** Add a shared id, such as a UUID column on both tables, filled for the people who may record, and report it as `id` as above. Never use a name or an email: the id travels in the link.

Everything saved is attributed to that id, so progress and `created_by` follow it.

## What a product still does itself

Flinders has no screens beyond the player's card, so these are yours, in your own components and words:

- **Web site:** the offer card, and where **Show me** starts: a chat, a help menu or a home list.
- **Admin site:** the walkthroughs list, the **+ Record walkthrough** button, the step editor, Make live and Inactive, Upload and version history. The calls are in [Chat and admin](chat-and-admin.md).
- **Words:** every message on this page is a suggestion. `labels` changes Flinders' own.
- **By hand:** create `FLINDERS_RECORDING_SECRET` in each environment, allow pop-ups in the browser, mark elements as screens are added, and write the walkthroughs' words.

Not built yet: previewing a draft on the web site from the admin.

## If admin and web are one site

`flinders.record()` brings the bar up in the same tab, given the router connector on that page. The recording env values are still needed, or the bar comes up with no link to save through: pass `recording: { onFinish }` to open your step editor.

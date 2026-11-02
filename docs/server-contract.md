# The server contract

A Flinders backend can be in any language. What keeps them the same is a definition and a test:

- `contract/openapi.yaml` defines every route, in OpenAPI 3.1. Bodies reuse `schema/walkthrough.schema.json`.
- This page lists the rules a shape can't show.
- `flinders-conformance` drives a running backend through all of it.

A backend that passes the kit works with the browser side as it comes. `flinders/server` is one implementation of this contract, not a special one. On a TypeScript server, use it and skip to [Running the kit](#running-the-kit). On Laravel and MySQL, use `flinders/laravel`: see `laravel/README.md`.

## The routes

All paths sit under a base you choose (`/flinders`, `/api/help`). Everything is JSON.

| Route | Name | Who | Answers |
|---|---|---|---|
| GET `/walkthroughs` | `listWalkthroughs` | Anyone signed in | `{ data: [...] }`: every live walkthrough they can read |
| GET `/progress` | `getMyProgress` | Anyone signed in | `{ offer_walkthroughs, progress }` |
| PATCH `/offers` | `setOffers` | Anyone signed in | The same, after changing the switch |
| POST `/walkthroughs/{walkthroughId}/events` | `recordEvent` | Anyone signed in | The same, after saving the event |
| POST `/recording-links/check` | `checkRecordingLink` | Anyone signed in | `{ valid: true, created_by, expires_at, link }` or `{ valid: false, reason }` |
| POST `/recording-links/drafts` | `saveRecording` | Anyone signed in | 201, the version saved |
| GET `/admin/walkthroughs` | `adminList` | Admins | `{ data: [...] }`: newest and live versions |
| POST `/admin/walkthroughs` | `adminUpload` | Admins | 201, the version saved |
| GET `/admin/walkthroughs/{walkthroughId}` | `adminDetail` | Admins | Every version, newest first, and `stats` |
| POST `/admin/walkthroughs/{walkthroughId}/versions` | `adminSaveVersion` | Admins | 201, the version saved |
| GET `/admin/walkthroughs/{walkthroughId}/stats` | `adminStats` | Admins | `{ people, finished, reached, actions_done }` |
| POST `/admin/recording-links` | `adminCreateRecordingLink` | Admins | 201, `{ link, url, expires_at }` |

Your own paths are fine. Give the browser a map, with the contract's route names as keys, and the kit the same one:

```ts
createFlinders({ http: { baseUrl: '/api', paths: { getMyProgress: '/me/tours', adminStats: null } } });
```

`null` means the backend doesn't serve that route. Stats then come from the admin detail.

## Errors

Every failure has the same shape, and `message` is shown to a person as it is:

```text
{ "error": { "code": "validation_failed", "message": "steps ▸ 0 ▸ missing: Required" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_failed` | Something a person can fix. Say where it is and what's wrong, with no code or SQL in it |
| 401 | `unauthorized` | Nobody is signed in |
| 403 | `forbidden` | They may not do this, or a recording link was refused |
| 404 | `not_found` | No such walkthrough or version, or one they can't see |
| 501 | `feature_off` | You haven't set this feature up: recording links, or the offers switch |

## The rules

These are the kit's rules, by id. Each one is a check it runs.

### Sign-in

Sign-in is your own. Every route checks it first.

| Rule | Must hold |
|---|---|
| `auth.signed-in` | Every route answers 401 with nobody signed in |
| `auth.admin-only` | An ordinary person gets 403 on every admin route |

### Owners and numbers

A walkthrough belongs to the product (no owner) or to one customer. The owner comes from who's signed in, never from the request. A walkthrough's `number` is its identity, and `handle` is `<number>-<slug>`. On admin routes `{walkthroughId}` may be the id, the number or a handle; only the number in a handle counts.

| Rule | Must hold |
|---|---|
| `numbering.next` | A file with no number gets the owner's highest number plus one |
| `numbering.same-number` | A file with a known number adds the next version to that walkthrough |
| `numbering.new-number` | A file with an unused number starts a walkthrough with it |
| `numbering.rename` | A new slug renames it, and a handle with the old slug still finds it |
| `numbering.per-owner` | Two owners can each have the same number, and neither's numbers move the other's |
| `owners.no-leak` | One owner's walkthroughs aren't listed, opened, changed or recorded against by another's people. The product's own are served to everyone |

Draw numbers under a lock, so two saves at once can't take the same one.

### Versions

Every change saves a new row. A row is never updated or deleted: put a database rule behind that if you can, as `sql/001_walkthroughs.sql` does with a trigger. What people get is a walkthrough's newest row that isn't a draft, if that row is `live`.

| Rule | Must hold |
|---|---|
| `upload.always-draft` | An upload is saved as a draft, even if the file says `live` |
| `versions.next` | Each save is the next version, copied from `from_version`, with the status asked for |
| `versions.never-edited` | Later saves leave an earlier version exactly as it was |
| `versions.draft-behind-live` | A later draft doesn't replace what's live |
| `versions.restore` | Restore copies an old version forward as a draft; people get it once that's made live |
| `versions.inactive` | Inactive takes it away from people, and every version stays |
| `versions.not-found` | No such walkthrough, version or reference is a 404 |
| `versions.references` | The id, the number and the handle all find it |
| `list.fields` | A served walkthrough holds everything `Walkthrough` lists |
| `list.articles` | `articles` come back as written, on the walkthrough and its steps, `[]` when there are none. More than 5, or a blank one, is a 400. Nothing else checks them |

### Progress

There is one row per person per walkthrough. `recordEvent` takes `started`, `paused`, `completed`, `dismissed` or `step`.

| Rule | Must hold |
|---|---|
| `progress.one-row` | Events update the person's one row: its status, the step, the version seen and when |
| `progress.own` | A person reads and changes only their own row |
| `progress.completed-stays` | `completed` never becomes `dismissed`: the row keeps its status and step, and only remembers the version seen |
| `progress.dismissed-to-started` | Every other change goes through, including starting again after finishing |
| `progress.step-keeps-status` | A `step` event moves `step` and leaves the status alone |
| `progress.refused` | A version past the newest is a 400; a walkthrough that isn't there is a 404 |

`reoffer_from` is the version a person must have seen not to be offered a walkthrough again.

| Rule | Must hold |
|---|---|
| `reoffer.keeps` | It is 1 at first. A file that doesn't say keeps the last version's, so only raising it offers again |

### Stats

| Rule | Must hold |
|---|---|
| `stats.counts` | `people` is progress rows; `finished`, rows now `completed`; `reached[n]`, rows whose furthest step is at least `n`, for each step of the newest version; `actions_done`, `step` events with `how: done`, across everyone |

The furthest step only ever rises, so going Back doesn't lower `reached`.

### Recording links

A link lets its creator add one kind of thing: a new draft. It lasts 30 minutes, and its address carries it after the `#`, as `<app>#flinders_record=<link>`, so it stays out of server logs.

| Rule | Must hold |
|---|---|
| `recording.link` | A new link comes with `url` and `expires_at`, 30 minutes on |
| `recording.check` | A good link checks as valid for its creator, with `created_by` and a fresh link |
| `recording.creator-only` | For anyone else it's `not_allowed`, and so for its creator once they may no longer record |
| `recording.invalid` | A forged or tampered link is `invalid` |
| `recording.expired` | An expired link is `expired` |
| `recording.saves-a-draft` | The steps save as a new walkthrough, version 1, a draft, never a version of another. Blank words get the placeholder words |

A check answers 200 with `valid: false`; saving with a bad link is a 403 `forbidden`.

The format below is the one `flinders/server` uses. Use it and the kit can test expiry with your secret. With your own format, pass the kit `expireLink`.

```text
<payload>.<signature>
payload    base64url of the JSON { "by": <user id>, "exp": <ms since 1970>, "purpose": "walkthrough-recording" }
signature  base64url of HMAC-SHA256(secret, "walkthrough-recording." + payload)
```

Compare signatures in constant time, and keep the secret on the server.

### Words

| Rule | Must hold |
|---|---|
| `placeholders.not-live` | A version with `Untitled step` as a title or `Say what to do here.` as a body can't be made live: a 400 naming the steps. Other statuses still save |
| `validation.file` | A file that doesn't fit `schema/walkthrough.schema.json` is a 400 that says where. Unknown fields are refused |
| `validation.app` | A step naming an element or page that isn't in the app is a 400 naming it |
| `validation.requests` | Bodies that don't fit the contract are 400s in plain words |
| `format.newer` | A file with a `format_version` newer than you support is refused with a message saying to update. This comes before any other complaint, because a newer file may have fields you don't know |
| `format.current` | The supported `format_version` is taken, and isn't saved with the walkthrough |
| `offers.switch` | The switch is the person's own. Off changes nothing served: it only stops offers, which the browser decides |

To know what's in the app, generate a list of elements and pages at build time, as `flinders-check` reads them, and check against it. The kit uses the element `conformance-no-such-element` and the page `/conformance-no-such-page`, so neither may exist in your app.

## Tables

The tables are yours, in any database. They need:

- **Versions:** an id, `walkthrough_id` (the id of its first version), owner, `number`, `version`, the definition as JSON, `created_by`, `created_at`. Unique on (`walkthrough_id`, `version`), and on (owner, `number`) for first versions.
- **Progress:** `user_id`, `walkthrough_id`, `seen_version`, `status`, `last_step`, `furthest_step`, `actions_done`, `updated_at`. Unique on (`user_id`, `walkthrough_id`).

`sql/001_walkthroughs.sql` is the Postgres version, with the rules written down as triggers. `laravel/database/migrations` is the MySQL version.

## Running the kit

Build the package, then point the kit at a backend on a **test database**. It adds walkthroughs and never removes any.

```sh
npx flinders-conformance --url http://localhost:3000/flinders \
  --user admin="Authorization: Bearer admin-token" \
  --user person="Authorization: Bearer person-token" \
  --user person2="Authorization: Bearer person2-token" \
  --user other-admin="Authorization: Bearer other-admin-token" \
  --recording-secret test-secret
```

```text
FAIL  progress.completed-stays: `completed` never becomes `dismissed`
      after Not now: expected ["completed",2], got ["dismissed",0]

37 passed, 1 failed, 0 skipped.
```

| Option | Means |
|---|---|
| `--url <base>` | The backend, base included |
| `--user <name>="<header>: <value>"` | A header that signs in `admin`, `person`, `person2` or `other-admin`. Repeatable |
| `--sign-in <file.mjs>` | Instead: a module whose default export is `async (user) => headers`, for a real sign-in. Its `user` is `admin`, `person`, `person2` or `otherAdmin` |
| `--paths <file.json>` | Your own paths, by route name; `null` for a route you don't serve |
| `--recording-secret <secret>` | Your test secret, to check expiry |
| `--permission <name>` | A permission your backend accepts, if it checks them against its own list |
| `--offer-on <page>` | A page your backend accepts as `offer_on`, if it checks them against its routes |
| `--only <prefix>` | Only rules starting with this. Repeatable |
| `--json` | The report as JSON |

It exits 0 when the backend passes, 1 when it doesn't and 2 when it couldn't run.

`admin` manages the product's own walkthroughs and may record. `person` and `person2` are ordinary people of the product's own. `other-admin` manages another owner's. Rules it can't check are skipped and say why: leave out `other-admin` and the owner rules skip; without a secret, expiry skips; with no recording set up (501), so do the recording rules.

As a function, in a test:

```ts
import { runConformance } from 'flinders/conformance';

const report = await runConformance({
  url: 'http://localhost:3000/flinders',
  signIn: async (user) => ({ authorization: `Bearer ${await tokenFor(user)}` }),
  recordingSecret: 'test-secret',
  onResponse: (route, status, body) => checkShape(route, status, body),
});
expect(report.failed).toBe(0);
```

`conformance/reference/` is a working backend in about 100 lines: `flinders/server` behind `node:http`. The package's own tests run the kit against it on Postgres when `FLINDERS_TEST_DATABASE_URL` is set, check each answer against `contract/openapi.yaml`, and prove the kit fails a backend that breaks a rule.

`laravel/docker/` does the same for the PHP server, on MySQL, with one Docker command.

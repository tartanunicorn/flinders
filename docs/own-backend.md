# Your own server: .NET and other languages

Flinders ships its server for Node (`flinders/server`) and for Laravel and MySQL (`flinders/laravel`). On anything else, such as ASP.NET Core, Go or Django, you write the 12 routes yourself. They're small. This page is the map: what each route does, where to copy it from, and the details that trip people up. [The server contract](server-contract.md) is the full list of rules, and its conformance kit is what tells you you're done.

The examples are for **.NET and Postgres**, but every step holds in any language.

## What you need

- **The tables.** On Postgres 15 or newer, run [`sql/001_walkthroughs.sql`](../sql/001_walkthroughs.sql) as it is. CI runs it on 16, and it passes on 18. Its triggers draw walkthrough numbers under a lock and refuse any UPDATE or DELETE on the versions table, so your code needs neither. Rename the tables if you like, inside the triggers too.
- **The two working servers to copy from.** Each function names its counterpart in the other:
  - `src/server-flinders.ts`: the routes, who's asking, the error answers.
  - `src/repository.ts`: every query, already in Postgres SQL.
  - `src/recording-link.ts`: recording links.
  - `laravel/src/`: the same again in PHP, closer to C# in shape. `Schema.php` is the file format's checks without a schema library, `Flinders.php` one method per route, `FlindersController.php` the HTTP side.
- **The kit**, to run against your server: see [Running the kit](server-contract.md#running-the-kit).

## The routes, and where to copy each one

Every route checks sign-in first (401), then admin (403) on `/admin/…`, then reads the body.

| Route | Copy from (TypeScript · PHP) | What it does |
|---|---|---|
| GET `/walkthroughs` | `served` · `list` | Each walkthrough's newest non-draft row, if it's `live`. People see the product's own (owner null) and their own owner's |
| GET `/progress` | `mine`, `progressOf` · `mine` | `{ offer_walkthroughs, progress }`, progress keyed by walkthrough id |
| PATCH `/offers` | `offers.set` · `setOffers` | Saves the person's switch. Without somewhere to keep it, `501 feature_off`, after the body is checked |
| POST `/walkthroughs/{walkthroughId}/events` | `recordEvent`, `saveProgress`, `saveStep` · `record` | The id must be a UUID (404 first), then the body. One progress row per person: see [Progress](#progress) |
| POST `/recording-links/check` | `checkAndRenewRecordingLink` · `checkRecordingLink` | 200 either way. A good link comes back renewed |
| POST `/recording-links/drafts` | `saveRecording` · `saveRecording` | Saves the steps as a new draft by the link's creator. A bad link is `403 forbidden` |
| GET `/admin/walkthroughs` | `adminList` · `adminList` | The owner's walkthroughs: newest version, and the live one |
| POST `/admin/walkthroughs` | `saveFile` · `adminUpload`, `saveFile` | Checks the file, then saves it as the next version, always a draft |
| GET `/admin/walkthroughs/{walkthroughId}` | `resolve`, `adminDetail` · `adminDetail` | Every version, newest first, and `stats` |
| POST `/admin/walkthroughs/{walkthroughId}/versions` | `copyVersion` · `adminSaveVersion` | Make live, Make inactive, Restore: copies `from_version` forward with the new status |
| GET `/admin/walkthroughs/{walkthroughId}/stats` | `stats` · `adminDetail` | `{ people, finished, reached, actions_done }` |
| POST `/admin/recording-links` | `createRecordingLink`, `recordingLinkUrl` · `createRecordingLink` | `201 { link, url, expires_at }` |

Anything else under the base answers in the error shape: `405 method_not_allowed` for a known path with the wrong method, else `404 not_found`.

## Who's asking

Each request needs a person: an `id` (text), whether they're an admin, and their `owner`: their company, or null for the product's own people. The owner always comes from sign-in, never from the request. In ASP.NET Core that's one function over `HttpContext.User`:

```csharp
// Who's asking: null = nobody signed in (answer 401).
// Admin and the recording check are your own policy.
sealed record FlindersPerson(string Id, bool Admin, string? Owner);

static async Task<FlindersPerson?> PersonOf(HttpContext http, IAuthorizationService auth)
{
    var id = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (id is null) return null;
    var admin = (await auth.AuthorizeAsync(http.User, "manage-walkthroughs")).Succeeded;
    return new FlindersPerson(id, admin, http.User.FindFirstValue("company_id"));
}
```

The admin web site and the product's web site must give one person the same `id`, or recording links answer `not_allowed`.

## The details that trip people up

### Requests and answers

- **Errors are always `{ "error": { "code", "message" } }`**, with the statuses in [Errors](server-contract.md#errors). Never put an exception's text in `message`: answer a 500 and log it.
- **Keep `{}` and `[]` apart.** A walkthrough file stores both, and they mean different things. Parse into `JsonNode` (`System.Text.Json.Nodes`), not into classes, and write the definition back as you read it.
- **An empty body is "missing", not `{}`**, and text that isn't JSON is `400 validation_failed`.
- **Times are UTC ISO with milliseconds**, as in `2026-11-03T02:01:59.123Z`: `ToString("yyyy-MM-ddTHH:mm:ss.fffZ")` on a UTC `DateTime`.

### Checking a walkthrough file

The shape is [`schema/walkthrough.schema.json`](../schema/walkthrough.schema.json), and you can validate against it with any JSON Schema library. Then, as `Schema.php` does:

- **Objects are strict.** An unknown field is a 400.
- **`format_version` comes first.** A number higher than 1 is refused, with a message telling the person to update, before any other complaint.
- **`title` and `body` are trimmed, then must be 1 or more characters.** Lengths count UTF-16 units, which is what .NET's `string.Length` already does.
- **After the shape, `stepProblems`:** each element and page a step names must be in the app. The kit sends `conformance-no-such-element` and `/conformance-no-such-page` and expects a 400 naming them. Generate the lists with `flinders-check --list` and check against them, or accept everything else.
- **A 400 must say where the problem is**, as in `steps ▸ 0 ▸ title: …`. The exact words are yours. Port `Schema.php` if you want the same words as Node and Laravel.

### Saving versions

- **An upload is always a draft**, whatever its `status` says. `format_version` isn't saved.
- **Matched by number.** A known number (this owner's) adds the next version to it. An unused number starts a walkthrough with that number. With no number, insert `number = NULL` and the trigger draws the next one. Insert `walkthrough_id = NULL` for a new walkthrough, and the trigger makes it the row's own id.
- **What's stored** is `{ slug, title, status, mode?, permission, offer_on, reoffer_from, article, articles?, steps }`. `mode` is stored only when the file or the last version has one. `articles` is stored only when it isn't empty. A file without `reoffer_from` keeps the last version's, or 1.
- **Versions under load.** Two saves to one walkthrough at once must take 2 and 3, not both take 2. Do the read and the insert in one transaction, behind `SELECT pg_advisory_xact_lock(hashtextextended('walkthroughs.version:' || $1, 0))` on the walkthrough id.
- **Make live checks the words.** A version still holding `Untitled step` or `Say what to do here.` can't go live: a 400 naming the steps (`unwrittenSteps`).

### Owners and references

- **People** see `owner IS NULL OR owner = @owner`. **Admins** see exactly their own owner's: `owner IS NOT DISTINCT FROM @owner`. So the product's own admin (owner null) manages only the product's own walkthroughs.
- **`{walkthroughId}` on admin routes** is a UUID, a number or a handle `<number>-<slug>`. Only the number in a handle counts, so a renamed walkthrough's old handle still finds it (`parseWalkthroughRef` in `src/logic.ts`).

### Progress

Copy the two `INSERT … ON CONFLICT` statements from `saveProgress` and `saveStep` in `src/repository.ts` as they are. They hold two rules that are easy to miss:

- `completed` never turns into `dismissed`. The row keeps its status and step, and only the version seen changes.
- `furthest_step` only rises, and a `step` event leaves the status alone.

### Recording links

Use this format, and the kit can test expiry with your secret:

```text
<payload>.<signature>
payload    base64url of the JSON { "by": <user id>, "exp": <ms since 1970>, "purpose": "walkthrough-recording" }
signature  base64url of HMAC-SHA256(secret, "walkthrough-recording." + payload)
```

- **Base64url has no `=` padding.** Compare signatures with `CryptographicOperations.FixedTimeEquals`.
- **A link lasts 30 minutes.** A good check answers `{ valid: true, created_by, expires_at, link }` with a fresh link, so the clock runs from when it's used.
- **Only the link's creator** may use it, and only while they may still record. For anyone else it's `{ valid: false, reason: "not_allowed" }`.
- **The URL carries the link after the `#`**: `<web url>#flinders_record=<link>`, so it never reaches a server log.
- **A saved recording is always a new walkthrough**, version 1, a draft. Fill blank titles and bodies with the placeholder words, as `recordingFile` does.
- **Without a secret and a web URL**, all three recording routes answer `501 feature_off`.

## Done

Run the kit against your server on a test database, as [Running the kit](server-contract.md#running-the-kit) shows. It's done when it reports every rule passed and none skipped. Then follow [Install on Laravel and Angular](install.md) from step 4 for the Angular side: the browser code is the same whatever the server is written in.

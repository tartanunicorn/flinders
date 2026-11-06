# Chat and admin

Flinders has no chat or admin screens. It gives you JSON and you draw them in your own product, so they look like the rest of it. `examples/react`, `examples/angular` and `examples/nextjs` show a small version of each.

Examples here take `q`, your query function from the [quick start](quick-start.md).

## The controller

`flinders.controller` holds all of it in the browser: loading, starting, picking up where someone stopped, offers, leaving part-way and previews. It has no framework, so draw what `view` says, keeping it in your own state with `onChange`:

```ts
const flinders = createFlinders({
  // …
  onChange: (view) => render(view), // view.list, view.mine, view.offers, view.left, view.state
  labels: { offerHint: 'Turn these off in your settings.' },
});
```

Offers run by themselves. A product with its own routes can build a `WalkthroughController` from a host instead, with `offerFor(url)` on each page change.

A page with a Show me and a Guide me offers Guide me first and Show me beside it. One answer settles both, once the one chosen has really started. Every word has a default in `WALKTHROUGH_LABELS`; pass `labels` to change any of them.

`flinders.recorder` does the same for a recording bar: see [Recording](recording.md).

## What you get

| You need | Call | You get |
|---|---|---|
| Everything in the browser, in one place | `flinders.controller` | Load, start, resume, offers, leaving part-way, previews; you draw `view` |
| A recording bar's state | `flinders.recorder` | The stages, the link's clock, steps to download; you draw `view` |
| Is this chat message a request? | `parseWalkthroughRequest(text)` | `{ topic, mode }`, or null |
| The chat's answer | `walkthroughAnswer(matched, request)` | `{ text, options }`: the words and the buttons |
| Chat "show me" | `matchWalkthroughs(list, url, topic)` | Walkthroughs in order, each with `here` |
| Why it can't start here | `openFirstReason(firstRoute, url, reasons)` | "Open a project first.", or null |
| Offer on a page | `walkthroughToOffer(list, url, person)` | The walkthrough to offer, or null |
| Admin wording | `walkthroughStatusLabel`, `reachedLabel`, `peopleLabel`, `describeUpload`, `versionChangeWords` | The words, for your own screens |
| A step's edit form | `stepForm(step)`, `applyStepForm(step, form)`, `editedFile(input)` | What to show, and the step or file to save |
| Admin list | `repository.adminList(q)` | Newest and live versions, `problems` |
| Admin detail | `repository.adminDetail(q, id)` | Every version |
| Upload | `repository.saveFile(q, file, opts)` | The saved version, or a `WalkthroughFileError` to show |
| Make live, inactive, Restore | `repository.copyVersion(q, id, from, status, by)` | The next version |
| Progress | `repository.progressOf(q, userId)`, `saveProgress(...)`, `saveStep(...)` | One row per person per walkthrough |
| An event from the player | `repository.recordEvent(read, write, userId, id, event)` | `'saved'`, `'not_found'` or `'no_such_version'`, for your API to word |
| What a browser loads | `repository.mine(q, userId, settings)` | `{ offer_walkthroughs, progress }` |
| A finished recording | `repository.saveRecording(q, link, person, steps, { secret })` | `{ saved, created_by }` or `{ refused }` |
| Home checklist | `checklistFor(list, progress, can, url)` | One row per task, by number: `{ title, done, options }` |
| Chatting during a walkthrough | `flinders.hold(open)`, `flinders.context()` | Where the person is, as plain JSON, for your chat |
| Show something from an answer | `flinders.elements()`, `parseShowMe(answer)`, `flinders.showMe(name, { route })`: see [Show me where](show-me-where.md) | The names on screen, the words without the token, and a card on the spot |
| AI first draft | `flinders.draft(input)` on the server, with `ask` your call to your AI service | `{ file, notes }`, for a person to edit |
| AI first draft through a queue | `buildDraftRequest(input)` when queuing, `checkDraft(answer, app, context)` when reading | `{ system, user, schema }`, then `{ file, notes }` |

A walkthrough belongs to the product (owner null) or one customer. `adminList`, `resolve`, `adminDetail` and `copyVersion` take the owner as their last argument, `saveFile` as `opts.owner`; left out, they work on the product's own. Numbers are per owner, so two customers can each have a walkthrough 1. `served` returns every owner's; narrow it with your row-level security.

A walkthrough is offered until the person has seen `reoffer_from` or later. A new version stays quiet unless the file raises it. By default any row counts as seen, Finish later included. Pass `{ reofferUnfinished: true }` as the last argument to `walkthroughToOffer` (or `reofferUnfinished: true` to `createFlinders`), and only `completed` and `dismissed` stop an offer, so someone who left part-way is offered it again. `offerSeen(walkthrough, row, rules)` is the same test for one walkthrough.

`copyVersion` won't make a version live while it holds a recording's placeholder words. It throws a `WalkthroughFileError` naming the steps, to show as it is.

`checklistFor` is for a list on your home page. A walkthrough counts as done when the person's row says `completed`, on `reoffer_from` or later; Finish later and Not now don't count. A Show me and a Guide me with the same `offer_on` are one task: one row with the lower number's title, both in `options`, Guide me first, done when either is. It leaves out what the person may not see and what can't start from `url`, because its first page needs an id that URL doesn't give (they're still offered on their own pages). It ignores their offers switch, because asking always works, and comes back empty once nothing startable is left to do, so your list can go away. `missingRouteParam(route, url)` is there for your own use, such as the words a chat shows for a walkthrough that can't start yet.

## Answering "show me" in a chat

`matchWalkthroughs` turns a request into a list:

```ts
import { matchWalkthroughs } from 'flinders';

const list = await walkthroughs.served(q);
const answers = matchWalkthroughs(list, '/projects/12', 'show me how to add a note');
// [{ walkthrough: { title: 'Add a note', … }, here: true }]
```

- With words, it returns the walkthroughs that match. A word in the title, slug or article counts for more than one in a step title.
- With no real words ("show me"), it returns them all, those on this page first.
- A number or handle ("4", "4-add-a-note") returns that one walkthrough.
- `here` says whether it's about the current page, so your chat can say "on this page".

It ignores offers and what the person has seen, because asking always works. It doesn't check `permission`, so filter the list first:

```ts
const allowed = list.filter((w) => !w.permission || person.can(w.permission));
```

To start one from the chat, call `flinders.start(walkthrough.handle, 'chat')`.

`parseWalkthroughRequest(text)` says whether a message is a request at all ("show me", "walkthrough 4", "guide me through adding a note"), and `walkthroughAnswer(matches, request)` turns the matches into what to say and the buttons to show. `openFirstReason(option.firstRoute, url, { projectId: 'Open a project first.' })` says why a button can't start from this page yet.

## Chatting during a walkthrough

Someone part-way through a walkthrough can ask a question and carry on at the same step. Flinders handles that moment and hands your chat plain JSON. It draws no chat, searches nothing and calls no AI, so your own chat answers as usual, better informed. Searching your help, and anything else it should know about the person, are your chat's job.

```ts
const flinders = createFlinders({
  // …
  player: {
    // Adds "Ask about this" to the card. Leave it out and the card has no such button.
    askAbout: () => yourChat.open(),
  },
});
```

**Keep your chat usable.** Put `data-flinders-keep` on the chat and the button that opens it: they stay above the dimmed page, under the card, and take clicks. Then tell the player when the chat opens and closes:

```ts
yourChat.onToggle((open) => flinders.hold(open));
```

While held, the walkthrough stays on its step, the card waits out of sight, the dimmed page stays, and Esc and Tab belong to the chat. `hold(false)` brings the card back where it was. "Ask about this" holds by itself, so you only need `hold(false)` afterwards.

**Answer a question.** Send the context with the question:

```ts
yourChat.send({ question: 'How much will this cost?', context: flinders.context() });
```

**The context** is stable: `version` goes up if a field changes meaning.

| Field | What |
|---|---|
| `version` | `1` |
| `walkthrough` | `id`, `title`, `mode` (`show` or `guide`) |
| `step` | `number` and `total` as the card counts them, `title`, `body` as the card says it, in plain text, and `element`, the anchor highlighted (null when nothing is) |
| `page` | The route pattern (`/projects/:projectId`), never a URL with ids; null when not known |
| `done` | The steps done so far, each `{ number, title }`. A skipped step isn't here; picking up part-way, the steps before count, except fork steps |
| `elements` | On `flinders.context()` only: the names on screen now, each `{ name, label }`, for [Show me where](show-me-where.md) |
| `articles` | The articles most relevant here, as written in the file: this step's, then the walkthrough's, then its `article`, each once. Empty when none are named |

**Article hints** are only strings. Flinders doesn't know what they point at, so your chat decides what to do with them: read those articles first, link to them, or ignore them. An author types them into the file, or your admin gives them a picker over your own articles; either way it's strings. `applyStepForm` and `editedFile` take `articles` for that.

It's built only from the walkthrough's own words and route patterns, so it holds no personal data and nothing anyone typed. `elements` alone reads the page, and only the words on buttons, links and `aria-label`s. `facts` is yours: send only what you'd show that person.

Drawing your own card? `renderCard` gets `askAbout` and `askAboutLabel` when the button is on. The word is the `askAbout` label.

## Offers

`createFlinders` runs these for you. Without it, `walkthroughToOffer(list, url, { progress, can })` returns the walkthrough to offer on this page, or null. Draw your own banner, and save `dismissed` on Not now:

```ts
await walkthroughs.saveProgress(q, userId, offer.walkthrough_id, { version: offer.version, status: 'dismissed', step: 0 });
```

## An admin screen

| Screen | Call | What you get |
|---|---|---|
| The list | `walkthroughs.adminList(q)` | One row per walkthrough: `handle`, `title`, `mode`, `latest_version`, `latest_status`, `live_version`, `steps_count`, `updated_at`, `updated_by`, `problems` |
| One walkthrough | `walkthroughs.adminDetail(q, id)` | Every version, newest first, and `stats` |
| Upload | `walkthroughs.saveFile(q, file, { createdBy, status: 'draft' })` | The saved version |
| Make live or inactive, Restore | `walkthroughs.copyVersion(q, id, fromVersion, status, createdBy)` | The next version, copied from the one you name |
| Find by handle or number | `walkthroughs.resolve(q, ref)` | Its original id |

Show **Needs update** when `problems` isn't empty: a live walkthrough points at something your latest release no longer has. Pass real checks as `app.anchorExists` and `app.routeExists` for this to work.

When a file can't be saved, `saveFile` throws `WalkthroughFileError` with a message you can show as it is:

```ts
import { WalkthroughFileError } from 'flinders/server';

try {
  await walkthroughs.saveFile(q, file, { createdBy: userId, status: 'draft' });
} catch (error) {
  if (error instanceof WalkthroughFileError) return res.status(400).json({ message: error.message });
  throw error;
}
```

## Seeing where people stop

Save every move as well as every start and finish:

```ts
player.start(tour, {
  onEvent: (status, step) => save({ event: status, version, step }),
  onStep: (step, how) => save({ event: 'step', version, step, how }),
});
```

The quick start's progress route already handles these. `adminDetail` then returns `stats`: `people`, `finished`, `reached` (`reached[2]` is how many got to the third step) and `actions_done` (Guide me steps people did themselves).

## Whose walkthrough it is

A walkthrough belongs to your product (owner null) or to one customer. `adminList`, `resolve`, `adminDetail` and `copyVersion` take the owner as their last argument, and `saveFile` as `owner`. Left out, they work on your product's own. Numbers are per owner. `served` returns everyone's, so narrow it with row-level security.

## Building a step editor

These work on a list of steps and return a new list, with no screen: `moveStep`, `updateStep`, `removeStep`, `addStep`. `draftProblems(steps, mode)` lists what's unfinished, in plain words, then `forkWarnings`, which don't stop a save; `draftBlockers` is the list without them. For forks: `stepRows(steps)` gives a table's rows (a step, a fork's heading, its paths' steps, numbered as the card numbers them; the heading is never saved), `dropStepRow(steps, dragged, order)` says what a drag means, and `moveFork`, `moveIntoFork`, `moveOutOfFork`, `addPath` and `setOnlyIf` do the rest. `Recorder` gives you a first draft of the steps by watching someone click through the real app; see the README.

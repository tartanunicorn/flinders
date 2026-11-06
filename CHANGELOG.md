# Changelog

Each version says what changed and what to do. Flinders follows [semantic versions](https://semver.org): before 1.0, a minor version can break things.

## Unreleased

Fixes from the first product rollout. Every change of behaviour has an option that keeps the old one.

- **Can't find it?** can be turned off or made to help. The player's new `cantFind` option: `'skip'` (the default, as before) moves on; `'help'` says what's missing ("We can't see “…” on this page", then the step's `missing.body`) and offers a labelled **Skip this step**; `false` never shows it, after any wait or redraw. It is never added to a card twice. New labels: `cantSee(title)` and `skipStep`.
- **A walkthrough left part-way can be offered again.** `reofferUnfinished: true` on `createFlinders` (or the controller's host, or the last argument of `walkthroughToOffer`) means only Done and Not now stop an offer; Finish later, Esc and leaving the page don't. It applies to the main offer and to the other kind offered beside it. `checklistFor` already ticked only Done, and still does. New: `offerSeen(walkthrough, row, rules)`. Off by default.
- **A card drawn without its element now finds it when it appears.** A list that loads a second late used to leave the card centred until a reload; now the card keeps watching and points at the element as soon as it's there. `lateElements: false` keeps the old way.
- **"Looking for …" while the next step loads.** After Next or Back, while the next page or element is on its way, the card says so and its buttons wait, so a second press can't skip a step. A product's own card (`renderCard`) gets the same: its `next()` and `back()` wait too. `lookingNote: false` turns the note off. New label: `looking(title)`.
- **Options for awkward pages:** `lookAlike: true` lets a numbered anchor (`row-3`) fall back to a visible one with the same base name; `settle: true` keeps a new card hidden until its element stops moving (300 ms still, at most 3 s). Both off by default.
- **No offer beside a walkthrough that's just started.** A walkthrough counts as playing from the moment `flinders.start()`, `controller.start()` or `player.start()` is called, not from its first card, so a slow first page no longer gets its own offer on top. An offer already up is taken down when a walkthrough starts, from the player too. New: `player.busy` and the player host's `onStart`.

## 0.1.1 (unreleased)

- `examples/nextjs`: Flinders on the Next.js App Router, with the routes served from one route handler on Postgres.
- `flinders/laravel` now installs on Laravel 11 as well as 12 and 13. The conformance kit passes on 11.50 and 11.57.
- The subpath entry points (`flinders/player`, `flinders/recording-tab` and the rest) now type-check under `"moduleResolution": "node"`, through `typesVersions`. Nothing to change in your tsconfig.
- The install guide no longer says the Angular samples need Angular 22: they use `@if` and `@for`, so Angular 18 or later.
- [Your own server](docs/own-backend.md): a route-by-route guide to writing the server in another language, worked for .NET and Postgres.

## 0.1.0

The first release.

- `createFlinders` in the browser and on the server: one call on each side, with connectors.
- Show me and Guide me walkthroughs over a product's real screens, with forks, phone copy and resuming.
- Recording, in the same tab or from a recording link when the admin is on another site.
- JSON helpers for a product's own chat and admin, and a context object for questions asked part-way.
- Show me where: `parseShowMe`, `flinders.elements()` and `flinders.showMe()`, so an AI's answer can point at something on the real screen, with a warning before another page.
- AI first drafts through a product's own AI.
- Article hints: a walkthrough or step can name the articles most relevant to it, and the chat context passes them on.
- The server contract (`contract/openapi.yaml`), its conformance kit, and a server for Laravel and MySQL.
- `flinders-check`, which checks walkthrough files against an app's source.

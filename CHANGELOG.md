# Changelog

Each version says what changed and what to do. Flinders follows [semantic versions](https://semver.org): before 1.0, a minor version can break things.

## 0.1.1 (unreleased)

- `examples/nextjs`: Flinders on the Next.js App Router, with the routes served from one route handler on Postgres.
- `flinders/laravel` now installs on Laravel 11 as well as 12 and 13. The conformance kit passes on 11.50 and 11.57.
- The subpath entry points (`flinders/player`, `flinders/recording-tab` and the rest) now type-check under `"moduleResolution": "node"`, through `typesVersions`. Nothing to change in your tsconfig.
- The install guide no longer says the Angular samples need Angular 22: they use `@if` and `@for`, so Angular 17 or later.

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

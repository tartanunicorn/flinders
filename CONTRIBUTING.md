# Contributing

Thanks for helping. Flinders is maintained in spare time, so a small, focused change gets a quicker answer. For anything large, open an issue first.

## Working on it

```sh
npm install
npm run build
npm run typecheck
npm test
```

The repository tests need a Postgres 15+ database and skip themselves without one:

```sh
FLINDERS_TEST_DATABASE_URL=postgres://user:password@localhost:5432/flinders_test npm test
```

`npm run demo` builds `examples/demo/site`. Serve that folder to try a change in a real browser.

## What a change needs

- A test, and docs in the same change. Tests in `test/docs.test.ts` keep the docs and the code in step.
- Keep the package free of frameworks. `src` imports only itself, Driver.js and Zod; `test/portable.test.ts` fails otherwise.
- Keep it lean. The way in is `createFlinders`: new standard behaviour goes there, with a default, rather than being one more thing to call.
- Words on screen go through `labels`. Nothing a person sees is hard-coded.
- A change to the routes changes `contract/openapi.yaml`, the conformance kit and `laravel/` together.
- A line in `CHANGELOG.md` for anything a user would notice, saying what to do if it breaks them.

## Versions

Semantic versions. Before 1.0, a minor version can break things. After 1.0, a major version is needed to change a public name, a route of the contract, the file format's `format_version`, or a table.

## Licence

By contributing you agree your work is licensed under the MIT licence.

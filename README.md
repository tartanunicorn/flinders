# Flinders

Guided walkthroughs over your product's real screens, kept in your own database. No hosted service and no vendor script: a library in your app and a few routes on your server.

- **Show me**: the person reads a card on each step and presses Next.
- **Guide me**: they do the real thing on the real screen, and each step moves on by itself.
- **Recording**: click through your app and the steps write themselves. Someone who doesn't code can make a walkthrough.
- **Your own screens**: your chat and admin get plain JSON, so they look like the rest of your product.

It works with any framework. React, Angular and Next.js examples are included, and `examples/demo` needs no server at all.

## What Flinders does for you

A list of the names on your screens isn't the value. Your product already owns its `data-testid`s, in its own code, and Flinders' list is only a copy rebuilt at build time. Here's what you'd otherwise have to build:

- **Showing it properly.** Finding the element while the page draws, scrolling inner columns, clearing sticky bars, placing the card beside a pop-out and above a phone's bottom bar, in your theme. That's the hard part, and it's done once.
- **Guiding people.** Reading a walkthrough or doing it for real, forks, picking up where someone stopped, and offers at the right moment.
- **Building without code.** Someone who doesn't code clicks through the app and the steps write themselves.
- **Remembering who's seen what.** Each person's progress, in your own database, and where people stop.
- **Staying correct.** `flinders-check` and "Needs update" tell you when a release breaks a walkthrough.
- **One tool across products.** The same files, routes and behaviour in every product, whatever its framework or backend.

**The AI side is yours.** Flinders has no model, no prompt and no knowledge base, and calls no AI. Your product's AI answers the question and says where to look; Flinders only points. See [Show me where](docs/show-me-where.md).

## Five-minute start

You need Node 20+, Postgres 15+ and an app with a client-side router. The server below uses Express, but anything that can run a query will do.

Build a package from a copy of this folder, then add it to your app:

```sh
cd flinders && npm install && npm pack          # gives flinders-0.1.1.tgz
cd ../your-app && npm install ../flinders/flinders-0.1.1.tgz pg express
psql "$DATABASE_URL" -f node_modules/flinders/sql/001_walkthroughs.sql
```

**On the server**, one call. Everything goes through your own `query`:

```js
// server.mjs
import express from 'express';
import pg from 'pg';
import { createFlinders } from 'flinders/server';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params).then((result) => result.rows);
const flinders = createFlinders({ query });

// Saved on every start; a file with a number that hasn't changed saves nothing.
await flinders.publish([
  {
    number: 1,
    slug: 'find-your-way',
    title: 'Find your way round',
    mode: 'show',
    offer_on: '/',
    steps: [
      { anchor: 'new-project', route: '/', title: 'Start here', body: 'Every project starts from **New project**.', missing: 'centred' },
      { anchor: null, title: 'That’s it', body: 'You can ask for this at any time.', missing: 'centred' },
    ],
  },
]);

const app = express();
app.use(express.json());
app.use('/flinders', async (req, res) => {
  const person = { id: 'me', admin: true }; // Use your own sign-in here.
  const { status, body } = await flinders.handle({ method: req.method, path: req.path, body: req.body, person });
  res.status(status).json(body);
});
app.listen(3000);
```

**In the browser**, one call, where your app starts. Each connector is one small thing you already have:

```js
import { createFlinders } from 'flinders';
import 'flinders/player.css';

const flinders = createFlinders({
  http: { baseUrl: '/flinders' },
  router: {
    url: () => location.pathname + location.search,
    navigate: (to) => yourRouter.go(to), // A promise of true, or false if it couldn't.
    onNavigated: (listener) => yourRouter.afterEach(listener), // Returns how to stop listening.
    routePattern: (url) => yourRouter.patternOf(url), // /projects/12 to /projects/:projectId. Recording needs this.
  },
  identity: { can: () => true }, // Your own permissions.
  offers: {
    show: async (offer) => confirm(`${offer.title}: ${offer.message}`), // Swap for your own banner.
    clear: () => {},
  },
});

console.log(flinders.off); // What's off, and which connector would turn it on.
```

**On your page**, mark what steps point at, and check your production build keeps it:

```html
<button data-testid="new-project">New project</button>
```

Open the home page and say yes to the offer. That's all the wiring there is: each page's walkthrough is offered as people move about, their progress is saved, and a no is remembered. Nothing else needs calling.

`examples/react`, `examples/angular` and `examples/nextjs` show the `router` connector for React Router, Angular and the Next.js App Router. The Next.js one also serves the routes from a route handler.

## What you call

| To | Call |
|---|---|
| Start a walkthrough from a button or a chat | `flinders.start('1')`, by number or handle |
| Add a Record button | `flinders.record()`. The bar, its stages and saving the draft are all done for you |
| Answer "show me" in your chat | `flinders.controller.matching(url, text)`, then `flinders.start` |
| Hand your chat where the person is | `flinders.context()` |
| Build your admin | `flinders.api.admin` in the browser, every route as a call |

Left out, a connector turns that feature off, and `flinders.off` says so in plain words. When someone signs in after the page has loaded, add `identity.signedIn`, a promise; offers and recording wait for it.

## Docs

- [Quick start](docs/quick-start.md): the five minutes above, step by step
- [Recording](docs/recording.md): the bar, your own bar, and an admin on a different site from your app
- [The file format](docs/file-format.md): every field of a walkthrough, and writing steps and forks
- [Matching your design](docs/matching-your-design.md): your colours, your classes or your own card
- [Chat and admin](docs/chat-and-admin.md): what your own screens get
- [Show me where](docs/show-me-where.md): your AI names something, and Flinders shows it
- [Checking files against your app](docs/checking.md): the `flinders-check` command, and "Needs update"
- [AI first drafts](docs/ai-drafts.md): plug in the AI service you already have
- [The server contract](docs/server-contract.md): what any backend must do, in any language, and the kit that proves it
- [Install on Laravel and Angular](docs/install.md): one document a coding agent follows from a single prompt
- [Rollout checklist](docs/rollout-checklist.md): what to check on a real product before going live

Not on Node? [`laravel/`](laravel/README.md) is the same server in PHP for Laravel and MySQL. A backend in another language follows `contract/openapi.yaml` and proves itself with `flinders-conformance`.

## Try it with no server

```sh
npm install && npm run demo
npx serve examples/demo/site
```

A pretend app with Show me, Guide me and recording. Its server is in the page, and the folder can go on any static host.

## Supported

| What | Versions |
|---|---|
| Browsers | The last two versions of Chrome, Edge, Firefox and Safari, phones and tablets too |
| Node | 20 or newer, for `flinders/server` and the two commands |
| Postgres | 15 or newer. MySQL through `laravel/` |
| Frameworks | Any. Examples for React 19, Angular 22 and none |
| Pages | Light and dark, phone and desktop, left-to-right and right-to-left, and a strict Content Security Policy with no `unsafe-inline` |

Sizes, minified and gzipped: the browser code about 18 kB, the player's Driver.js 8 kB more when a walkthrough first starts, and `player.css` 3 kB. Zod is used only on the server.

## The parts

`createFlinders` is the one way in. Everything under it stays exported, for a product that wraps it in its own state:

| Entry point | What |
|---|---|
| `flinders` | `createFlinders`, `WalkthroughController`, `RecordingSession`, `Recorder`, and the JSON helpers for your chat and admin |
| `flinders/player` | `WalkthroughPlayer`, `markup` |
| `flinders/recorder-bar` | `mountRecorderBar`, the default bar |
| `flinders/recording-tab` | `RecordingTab`, small enough to run first thing |
| `flinders/server` | `createFlinders` for Node, `createWalkthroughRepository`, recording links, the file checks |
| `flinders/draft` | AI first drafts |
| `flinders/conformance` | The contract's test kit |
| `flinders/player.css`, `flinders/sql/*`, `flinders/schema/walkthrough.schema.json`, `flinders/contract/openapi.yaml` | Files |

## Versions

Flinders follows [semantic versions](https://semver.org). Before 1.0, a minor version can break things, and the [changelog](CHANGELOG.md) says what to do. `format_version` in a walkthrough file and the contract's routes change only with a major version after 1.0. See [CONTRIBUTING](CONTRIBUTING.md) to help, and [SECURITY](SECURITY.md) to report a problem privately.

## Licence

MIT. Built on [Driver.js](https://driverjs.com) (MIT).

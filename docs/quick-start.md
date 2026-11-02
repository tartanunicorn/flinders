# Quick start

The README's five minutes, step by step: two tables, one walkthrough, one server route and one call in your page. You need Node 20 or newer, Postgres 15 or newer, and an app with a client-side router. The code uses Express on the server, but anything that can run a query will do.

## 1. Add the package

From a copy of this folder:

```sh
npm install
npm pack
```

`npm pack` builds it and writes `flinders-0.1.0.tgz`. Keep that file in your repo, then from your app:

```sh
npm install ./vendor/flinders-0.1.0.tgz pg express
```

## 2. Create the tables

```sh
psql "$DATABASE_URL" -f node_modules/flinders/sql/001_walkthroughs.sql
```

No `psql` to hand? Paste the file into any Postgres client.

This makes `walkthroughs` (one row per version, never changed) and `walkthroughs_progress` (one row per person per walkthrough). To use other names, edit the file and pass `tables` to `createFlinders`. If your app has many customers in one database, add row-level security to suit.

## 3. Mark what the steps point at

Steps find elements by `data-testid`. Add one to something on your home page, and check your production build keeps it:

```html
<button data-testid="new-project">New project</button>
```

To use another attribute, see [Matching your design](matching-your-design.md).

## 4. Write a walkthrough

Save this as `walkthroughs/find-your-way.json`. [The file format](file-format.md) explains every field.

```json
{
  "number": 1,
  "slug": "find-your-way",
  "title": "Find your way round",
  "mode": "show",
  "offer_on": "/",
  "steps": [
    {
      "anchor": "new-project",
      "route": "/",
      "title": "Start here",
      "body": "Every project starts from **New project**.",
      "missing": "centred"
    },
    {
      "anchor": null,
      "title": "That's it",
      "body": "You can ask for this walkthrough again at any time.",
      "missing": "centred"
    }
  ]
}
```

## 5. Add the server

Save this as `server.mjs`, or fit the route into your own server. `handle` serves every route of [the server contract](server-contract.md), so any framework will do.

```js
import { readFileSync } from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFlinders } from 'flinders/server';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Your query function: every call goes through it, so your own tenancy and audit stay in charge.
const query = (text, params) => pool.query(text, params).then((result) => result.rows);

const flinders = createFlinders({ query });

// Safe on every start: a file with a number that hasn't changed saves nothing.
await flinders.publish([JSON.parse(readFileSync('walkthroughs/find-your-way.json', 'utf8'))]);

const app = express();
app.use(express.json());

app.use('/flinders', async (req, res) => {
  const person = { id: req.get('x-user-id') ?? 'me', admin: true }; // Use your own sign-in here; admin only for admins.
  const { status, body } = await flinders.handle({ method: req.method, path: req.path, body: req.body, person });
  res.status(status).json(body);
});

app.listen(3000);
```

Three things are worth setting later, each one line in `createFlinders`:

- `offers: { get, set }`: where a person's "offer me walkthroughs" switch lives. Without it, offers are on and the switch answers `feature_off`.
- `app: { anchors, pages }`: your real elements and pages, so a typo is refused and a renamed element shows as **Needs update**. See [Checking files against your app](checking.md).
- `recording: { secret, webUrl, mayRecord }`: for an admin on a different site from your app. See [Recording](recording.md).

Not on Node? The routes are the same in any language: see [the server contract](server-contract.md).

## 6. Add it to your page

`createFlinders` takes what you already have, one connector each. Call it where your app starts, before your router. The router connector needs the current URL, a way to go somewhere, and a call after each move. `examples/react` and `examples/angular` show it for React Router and Angular; `yourRouter` below stands for yours.

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
  offers: { show: async (offer) => confirm(`${offer.title}: ${offer.message}`), clear: () => {} },
  toast: (message) => yourToast(message),
});

console.log(flinders.off); // What's off, and which connector would turn it on.
```

Swap `confirm` for your own banner: `show` resolves `true`, `'alternative'` for the second button, `false` for Not now, or `null` if it went unanswered, and `clear` takes it down. A no is saved for you, so nobody's asked again.

That's everything. Flinders offers each page's walkthrough as the person moves about, holds offers back while something is playing or being recorded, and saves progress. If people sign in after this runs, add `identity.signedIn`, a promise that resolves once they have; everything waits for it.

A product that wants to run those parts itself passes `auto: false`, and calls `controller.offerFor(url)` and `recorder.resumeFromLink()`.

## 7. Try it

Open your home page and say yes to the offer. The card appears on **New project**, and after Done there's a row in `walkthroughs_progress`, so the offer doesn't come back.

## What next

- A button: `flinders.start('1')`, by number or handle.
- A Record button: `flinders.record()`. See [Recording](recording.md).
- [The file format](file-format.md): Guide me, phones and what to do when an element is missing.
- [Matching your design](matching-your-design.md): your colours, your classes or your own card.
- [Chat and admin](chat-and-admin.md): answering "show me" and building an admin screen.

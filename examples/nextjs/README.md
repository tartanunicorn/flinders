# Flinders with Next.js

Flinders on the App Router, with a real server: the routes are one route handler, on Postgres.

- `app/flinders-client.tsx`: `createFlinders` in the browser, once, with the router connector on `useRouter` and `usePathname`, and the offer drawn in React. `useFlinders()` hands it to any client component.
- `app/api/flinders/[...path]/route.ts`: every Flinders route behind one catch-all, through `flinders.handle`.
- `lib/flinders-server.ts`: the server side, one `pg` pool and `createFlinders({ query })`, and where your own sign-in goes.
- `lib/walkthroughs.ts`: the walkthroughs, published when the server starts.
- `app/chat.tsx` and `app/admin/page.tsx`: a chat answer from `matching`, and an admin list.

This folder has its own dependencies. Build the package first, from its root (`npm install && npm run build`), then make a database and start the app here:

```sh
psql "$DATABASE_URL" -f ../../sql/001_walkthroughs.sql
npm install
DATABASE_URL=postgres://… npm run dev
```

Open <http://localhost:3000>. Press **Show me** on the offer, or ask the chat "add a note".

## In your own app

- **Your sign-in.** `whoIsAsking` in `lib/flinders-server.ts` lets everyone in as an admin. Read your own session there and return the person, with `admin` only for those who may manage walkthroughs, or null.
- **Your routes.** `routePattern` in `app/flinders-client.tsx` turns `/projects/12` into `/projects/:projectId`. Write yours from your `app` folder: each `[id]` folder is a `:id`.
- **Search params.** The App Router says nothing when only the query string changes, so the connector listens to the pathname. Walkthroughs that move on by query string alone need `useSearchParams` added to the effect.
- **`next.config.ts`.** The two lines about the root are only because this example links the package from two folders up. In your app it's an ordinary package.
- **Another server.** If your API is Express rather than Next.js, mount `flinders.handle` there instead, as in the main README, and point `http.baseUrl` at it.

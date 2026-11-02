# Security

## Reporting a problem

Please don't open a public issue. Use the repository's private vulnerability reporting (Security ▸ Report a vulnerability). You'll get an answer within a week.

Only the latest version gets fixes.

## What Flinders does

- **Words are text.** Step titles and bodies are escaped; `**bold**` is the only mark-up. A walkthrough file can't inject anything.
- **Pages are your own.** A step's `route` must be a path in your app, never another site.
- **Nothing typed is read.** The recorder and Guide me only ever ask whether a field has a value, never what it is.
- **A recording link is signed, short-lived, for one person and only adds a draft.** It never signs anyone in. It travels after the `#`, so it stays out of server logs, and leaves the URL as soon as the page reads it.
- **No inline scripts or styles.** It runs under a strict Content Security Policy.

## What stays yours

- Who is signed in. `flinders.handle` trusts the `person` you pass it, and `person.admin` opens the admin routes.
- Row-level security, if your customers share a database. `flinders/sql/001_walkthroughs.sql` doesn't add it.
- The recording secret: at least 32 random characters, kept on the server.
- The size of a request body. Limit it in your server, as Express's `json()` does by default.
- `renderCard`: if you draw your own card, set `title` as text, and only `bodyHtml` as HTML.

# Flinders compared

There are two kinds of product tour tool: libraries that draw a tour in the browser, and hosted services that do everything from their own servers. Flinders sits between them. It's open source and runs in your app like a library, but it also saves progress, records walkthroughs and tells you where people stop, like a hosted service. This page says where each fits, including when Flinders is the wrong choice.

## At a glance

| | Flinders | Tour libraries (Shepherd.js, Intro.js, Driver.js, React Joyride) | Hosted tools (Appcues, Pendo, Userpilot, WalkMe) |
|---|---|---|---|
| Where it runs | Your app and your server | Your app | Their servers, through a script in your app |
| Where the data lives | Your own database | Nowhere: progress is yours to build | Theirs |
| Licence and cost | MIT, free | Shepherd.js and Intro.js: AGPL-3.0 or a paid licence. Driver.js and React Joyride: MIT | Paid, usually priced by monthly active users |
| Remembers who's seen what | Yes, per person, across devices | No | Yes |
| Made without code | Yes: click through the app to record | No: steps are written in code | Yes: a visual builder |
| Steps that wait for the person to act | Yes: Guide me | Partly: some can, with code of your own | Yes |
| Where people stop | Yes, per step | No | Yes, with much more analytics |
| Says when a release breaks a tour | Yes: `flinders-check` at build time, and "Needs update" | No | Some do, at run time |
| Looks like your product | Yes: your colours, your classes or your own card | Yes | Partly: their editor, their themes |
| Your AI can point at things | Yes: Show me where | No | Some, through their own AI |
| Backends | Node with Postgres, Laravel with MySQL, or any language that passes the conformance kit | None needed | None: theirs |

## Choose a tour library when

- You want a few fixed tours, written by developers, and nobody needs to know who has finished one.
- You have no server, or don't want to touch it.

Driver.js is the lightest of these, and Flinders draws its highlight with it. If you start with a library and later need progress, recording or analytics, Flinders adds those around the same idea.

## Choose a hosted tool when

- You want checklists, surveys, NPS, A/B tests, a resource centre or detailed audience targeting, with no engineering time. Flinders has none of these.
- You need tours inside native mobile apps. Flinders is for the web.
- You're happy for a third party to load a script in your app and keep your users' data.

## Choose Flinders when

- Walkthroughs and each person's progress should live in your own database, with no vendor script and nobody else's servers in the way.
- People who don't code should make walkthroughs, but on your real screens and in your own look.
- You want walkthroughs checked like code, so a release that renames a button says so before it ships.
- You run several products, or several customers in one database, and want the same tool and the same files in each.
- Your product has its own chat or AI assistant, and you want it to answer "show me how" on the real screen.
- Per-user pricing is a problem as you grow.

## Moving from another tool

Flinders' steps point at elements by `data-testid`, so mark the elements your current tours use and write each tour as a [walkthrough file](file-format.md), or record it again. The [quick start](quick-start.md) takes about five minutes.

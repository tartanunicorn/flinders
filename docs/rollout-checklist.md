# Rollout checklist

One page for the person in charge of adding Flinders to a Laravel and Angular product. [Install on Laravel and Angular](install.md) is the full route, for the coding agent.

## Before starting

| Check | How | If not |
|---|---|---|
| MySQL 8.0.16 or newer, not MariaDB | `SELECT VERSION()` | MariaDB isn't supported: stop |
| Laravel 12+, PHP 8.2+ | `composer.json` | Upgrade first |
| Migrations can create triggers | `SELECT @@log_bin, @@log_bin_trust_function_creators` as the app's database user. `1` and `0` will fail with error 1419 | Have the host set `log_bin_trust_function_creators=1`, or set `FLINDERS_APPEND_ONLY_TRIGGERS=false` |
| Admin and web see the same user id for one person | Compare what each site's `/me` returns | Choose a fix from [Fixing `not_allowed`](install.md#fixing-not_allowed) first. A separate admin table needs a linking column |
| The API can allow both sites | `config/cors.php` | Add both origins. No `*` with cookies |
| Pop-ups from the admin site are allowed | Each person recording allows them once | The button says so |
| `data-testid` survives the production build | Search the built bundle for it | Choose another attribute, or stop |
| The screens to cover have `data-testid`s | Search the templates | Add them to the first walkthroughs' screens, and pass them through shared components |
| One walkthrough's words are ready to write | The first task, in the product's own words | Someone has to write them |

## The prompt

Copy the Flinders folder to `packages/flinders`, then paste:

```text
Install Flinders in this product: follow packages/flinders/docs/install.md from start to finish, ask me only what the codebase can't answer, and finish by running its checklist and telling me each result.
```

## What a person does by hand

- Say yes to any host change for the database trigger setting.
- Create `FLINDERS_RECORDING_SECRET` in each environment, and set `FLINDERS_WEB_URL` and `FLINDERS_ADMIN_URL`.
- Decide who may record: the `manage-walkthroughs` rule.
- Allow pop-ups, once, in each browser that records.
- Record, write the words, choose the page and make it live.
- Mark new elements with `data-testid` as screens are added.

## How to test it worked

1. `php artisan route:list --name=flinders` lists 12 routes.
2. The conformance kit passes on a test database. Without companies, only the two owner rules skip.
3. Press **+ Record walkthrough** in the admin. A new tab opens on web, and its address shows no `flinders_record`. Sign in if asked, and the bar says Ready to record.
4. Open web by hand in another tab. It has no bar.
5. Record, reload part-way, record a fork and press **Finish**. The tab closes and the draft opens in the admin tab.
6. Write the words, set the page and make it live. As an ordinary person, take the offer to the end, then reload: it isn't offered again.
7. Open a link signed in as someone else on web: it says so, and shows no bar.

The full table is checklist item 6 in the [install guide](install.md).

## How to back it out

Flinders adds code you can remove and two tables you can leave. In order:

1. Stop anyone starting a new recording: remove the record button, or leave `FLINDERS_RECORDING_SECRET` empty, and the routes answer `feature_off`.
2. Remove the Angular wiring: the `RecordingTab` line in `main.ts`, the `Walkthroughs` service and bar, the offer card and the admin page. `npm uninstall flinders` on each site, and take `player.css` out of `angular.json`.
3. Remove the Laravel wiring: `composer remove flinders/laravel`, then `config/flinders.php`, the abilities, your connectors class, and `flinders/*` in CORS.
4. Leave the two tables and any column you added. They do nothing once the code has gone, and they hold the walkthroughs if you come back.

To drop them as well, do it by hand after a backup, as the migration has no way back: drop the two tables (their triggers go with them), then delete the row for `create_flinders_tables` from `migrations`, so a later install can migrate again.

`data-testid`s can stay: they do nothing.

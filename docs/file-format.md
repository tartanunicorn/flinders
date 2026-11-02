# The file format

A walkthrough is one JSON file. `repository.saveFile` checks it and saves it as the next version. A field the format doesn't know is refused, and the error says where the problem is.

Here's a Guide me walkthrough using most of what's below:

```json
{
  "number": 2,
  "slug": "add-a-note",
  "title": "Add a note",
  "mode": "guide",
  "article": "notes",
  "permission": "notes.write",
  "offer_on": "/projects/:projectId",
  "reoffer_from": 3,
  "status": "draft",
  "steps": [
    {
      "anchor": "add-note",
      "route": "/projects/:projectId",
      "title": "Start a note",
      "body": "Press **Add note**.",
      "side": "bottom",
      "align": "start",
      "wait_for": "appear",
      "done_when": { "kind": "appears", "anchor": "note-text" },
      "help_after": 10,
      "blocked": [{ "anchor": "project-locked", "title": "This project is locked", "body": "Ask its owner to unlock it, then try again." }],
      "missing": "end"
    },
    {
      "anchor": "note-text",
      "title": "Write it",
      "body": "Type your note here.",
      "phone": { "side": "top", "body": "Tap here and type your note." },
      "done_when": { "kind": "filled" },
      "missing": { "alt": "note-panel", "body": "Your note goes in this panel." }
    },
    {
      "anchor": "save-note",
      "title": "Save it",
      "body": "Press **Save** and you're done.",
      "done_when": { "kind": "route", "route": "/projects/:projectId/notes" },
      "missing": "centred"
    }
  ]
}
```

## The walkthrough

| Field | Required | What it does |
|---|---|---|
| `number` | No | Its identity, the same on every version. A file with a known number adds a version; a new number starts a walkthrough with it; no number takes the next one. |
| `slug` | Yes | Its readable name: lowercase words and hyphens, up to 120 characters. It can change between versions. `number` and `slug` make the handle, `2-add-a-note`. |
| `title` | Yes | What people see, up to 120 characters. |
| `mode` | No | `show`: the person reads and presses Next. `guide`: they do the real thing on the real screen. New walkthroughs default to `show`; left out, a new version keeps the last one's mode. |
| `article` | No | The slug of its help article, or null. With the controller, pass `learnMore(slug)` in the host and the walkthroughs with an article show **Learn more** on their last step. Using the player alone, give the walkthrough you pass to `start` a `learnMore` function. Either way the walkthrough ends first, then your function runs. |
| `articles` | No | Up to 5 articles most relevant to the whole walkthrough, for your chat (below). |
| `permission` | No | Who it's for, or null for everyone. `walkthroughToOffer` asks your `can()`. Any text, unless you pass your own list as `permissions`. |
| `offer_on` | No | The route pattern where it's offered, or null for never. |
| `format_version` | No | The file format. Left out, it's 1. A file newer than the package understands is refused with a plain message. |
| `reoffer_from` | No | The version a person must have seen not to be offered it again. Starts at 1. Left out, a new version keeps the last one's, so changing a walkthrough stays quiet. To offer version 3 to everyone again, set it to 3. Finished, paused and Not now all count as seen. |
| `status` | No | `draft`, `live` or `inactive`. Used only if the call to `saveFile` doesn't pass its own, and `draft` if neither says. Pass `status: 'draft'` on uploads, so nobody can go live by editing a file. |
| `steps` | Yes | 1 to 30 steps. |

## A step

Each step is one of three types. The names live in `STEP_TYPES`, with `stepType(step)` and `setStepType(step, type)` to read and change one.

| Type | The person | In the file |
|---|---|---|
| Read | Reads it and presses Next | No `done_when` |
| Do | Does it, and it moves on by itself | `done_when`: `clicked`, `filled`, `chosen`, `appears` or `route`; or `advance_on_click` |
| Optional | Can use what's highlighted, then presses Next | `optional: true`, no `done_when` |

Do and Optional need something highlighted. In a Show me, `done_when` is ignored, so a Do step keeps Next; `advance_on_click` counts in both kinds and hides Next.

| Field | Required | What it does |
|---|---|---|
| `anchor` | Yes | The element to point at, or null for a centred card. Lowercase words and hyphens, up to 80 characters. |
| `route` | No | The route pattern the step is on, such as `/projects/:projectId/settings`. The player goes there if the page isn't on it. Left out, the step stays where the last one was. |
| `title` | Yes | Up to 80 characters. |
| `body` | Yes | Up to 400 characters of plain text. `**bold**` is the only mark-up. |
| `side` | No | `top`, `bottom` (the default), `left` or `right` of the element. Phones change left and right to bottom, as there's no room beside it. |
| `align` | No | `start` (the default), `center` or `end` along that side. |
| `wait_for` | No | `appear`: wait while the page is loading, up to 4 seconds. This is also what happens if you leave it out. `person`: wait as long as it takes, for something only the person can bring up. |
| `advance_on_click` | No | `true`: clicking the real element moves on, in both kinds, with Next hidden while the element is there. **Can't find it?** shows after `help_after`. On a Guide me step with `done_when`, that decides instead. `optional` turns it off. A step never clicks for the person. |
| `done_when` | No | In `guide` mode, what finishes the step (below). Ignored in `show`. |
| `help_after` | No | On a step with `done_when` or `advance_on_click`: seconds, 1 to 120, before the card offers **Can't find it?**, which moves on. 3 by default. |
| `optional` | No | `true`: what's highlighted can be used, and the person still presses Next. |
| `only_if` | No | An element, or a list where any one will do. If none is on screen, the step is skipped, so one walkthrough can serve several paths. Neighbouring steps with `only_if` are a fork, of which one path plays; neighbouring steps with the same `only_if` are one path. |
| `blocked` | No | Up to 5 things that stop the person doing this step (below). |
| `phone` | No | `"skip"`, or a different `anchor`, `title`, `body` or `side` for phones and touch screens. With `"anchor": null` a step that waits for a click has Next on a phone, for something that can't be done there. |
| `articles` | No | Up to 5 articles most relevant to this step, for your chat (below). |
| `missing` | Yes | What to do if the element isn't there (below). |

### `done_when`

Next is hidden until this happens. If the step's element is missing, there's nothing to act on, so `clicked`, `filled` and `chosen` keep Next.

| `kind` | Finished when |
|---|---|
| `clicked` | The step's element is clicked. |
| `filled` | The field in the step's element has a value. Only whether it has one is checked, never what it is. |
| `chosen` | The same check as `filled`, for dropdowns and pickers. A custom picker says it has a value with `data-has-value="true"`, on itself or inside the step's element. |
| `appears` | The element named by its own `anchor` shows up. |
| `route` | The page matches its own `route`. |

### `blocked`

Each entry has an `anchor`, a `body` and an optional `title`. When a step starts, the first of these on the screen replaces the step: the card points at that element, says this text instead, and keeps Next, so nobody gets stuck.

### `missing`

| Value | What happens |
|---|---|
| `"centred"` | The step shows as a centred card. |
| `"end"` | The walkthrough pauses. |
| `{ "alt": "other-element", "body": "…" }` | The card points at `alt`, with `body` in place of the step's own. Both are optional; with no `alt`, or if `alt` isn't there either, the card is centred. |

## `articles`

Each entry is a string of up to 500 characters: a url, an id or a slug, whatever your product calls an article. Flinders never fetches, parses, checks or follows them. It keeps them as written and passes them on in the chat context: see [Chatting during a walkthrough](chat-and-admin.md#chatting-during-a-walkthrough). `article` is separate: it's the one link behind **Learn more**, and it counts last among the hints.

## Routes

A route pattern starts with `/`, and `:name` stands for one part of the path. Query strings and a trailing `/` are ignored when matching. When the player has to go to a route, it fills each `:name` from the page the walkthrough started on or passed through. If it has no value for one, the walkthrough pauses, so make sure an earlier step lands on a page that has it.

## What else is checked

`saveFile` also refuses:

- an element or page your `app.anchorExists` and `app.routeExists` say isn't there, including `offer_on`
- any word in your `app.retiredWords` (a list, or a pattern)
- "click" or "hover" in copy a touch screen would show. Say "press", or give `phone` copy that says "tap"

`repository.problemsOf(steps)` runs the same element, page and word checks on saved steps, and `adminList` uses it to show which live walkthroughs need an update after you release.

## Saving versions

Every save is a new row; nothing is edited or deleted. A draft saved after a live version doesn't replace it until you make it live. With `skipIfSame`, a file matching the newest version saves nothing, but it needs a `number` to find that version.

# AI first drafts

Draft a walkthrough from an article with the AI service you already have. This package holds the prompt and the check and imports no AI SDK. You supply one function, `ask`, and a person edits the result before it is saved.

## The connector

`ask` gets a request of plain JSON, calls your AI service and returns its answer, as text or as a parsed object. Here it wraps a generic HTTP endpoint:

```ts
import { draftWalkthrough } from 'flinders/draft';

const { file, notes } = await draftWalkthrough({
  source: { title: article.title, body: article.body },
  mode: 'guide',
  app: { ...appChecks, anchors, routes },
  ask: async ({ system, user, schema }) => {
    const res = await fetch('https://ai.example.com/v1/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_KEY}` },
      body: JSON.stringify({ system, user, response_schema: schema }),
    });
    if (!res.ok) throw new Error(`The AI service answered ${res.status}`);
    return (await res.json()).text;
  },
});
```

Then open `file` in your step editor and show `notes` above it. Save with `repository.saveFile(q, file, { createdBy, status: 'draft' })` once a person has checked it.

| In | Means |
|---|---|
| `source` | `{ title, body }`: what the draft is written from. Only the first 60,000 characters are sent. |
| `mode` | `show` or `guide`. |
| `app` | Your `AppChecks`, plus `anchors` (the elements a step may point at), and optionally `prefixes` and `routes`. |
| `ask` | Your call to your AI service. |
| `instructions` | Optional. Your own guidance, added to the prompt as it is: your product's words, its tone. |
| `article` | Optional. The article the walkthrough belongs to, copied to `file.article`. |

Only give the AI what it should see: the prompt carries `source`, the lists and `instructions`, and nothing else.

## What comes back

```json
{
  "slug": "add-an-item",
  "title": "Add an item",
  "mode": "show",
  "steps": [
    {
      "route": "/items",
      "anchor": "new-item-btn",
      "title": "Add an item",
      "body": "Press **+ New item** to start.",
      "phone": { "body": "Tap **+ New item** to start." },
      "missing": "centred"
    }
  ]
}
```

`file` is that shape. `notes` has one plain sentence for each thing left out, such as "Left out step 2: no page “/nope” in the app."

- **A bad step costs only that step.** Each must fit the [file format](file-format.md) and pass `stepProblems`. A step that follows a left-out one takes its page.
- **An answer that isn't JSON** is an empty draft with a note, so the person sees what happened. JSON with fences or a sentence around it is read as usual.
- **A failed `ask` rejects** with your error, and nothing stands in for it: a made-up draft would look like a real proposal.
- **The AI never sets** `mode`, `article`, `permission`, `offer_on`, `number` or `status`. `mode` and `article` come from you, and the rest stay unset until a person chooses.
- **`retiredWords` can be a list** in your `AppChecks`: `['widget', 'bore log']` catches any case, a plural, and the words with a hyphen or no space. The list is also put in the prompt. A `RegExp` still checks, but can't be listed in the prompt.

## When your AI is behind a queue

`ask` can wait for a job, but it doesn't have to, because `draftWalkthrough` is only two functions either side of `ask`. Use them apart when the request and the answer happen in different places:

```ts
import { buildDraftRequest, checkDraft } from 'flinders/draft';

// When the person asks: put the prompt in your job, and let your worker pass it to your AI.
const { system, user } = buildDraftRequest({ source, mode, anchors, routes, retiredWords, instructions });
const jobId = await queue.add('walkthrough-draft', { mode, title: source.title, system, user });

// When the answer is read, on a later request: nothing is saved.
const job = await queue.get(jobId);
const { file, notes } = checkDraft(job.result, app, { mode: job.data.mode, title: job.data.title });
```

Your worker holds no prompt and no word list, so there is one copy of each. `buildDraftRequest` returns plain JSON, so it can sit in any queue. `schema` is there too, if your AI service can be held to a JSON Schema.

`checkDraft` reads a JSON string or an object, and a third argument gives what the answer doesn't decide: `mode`, a fallback `title` and `article`.

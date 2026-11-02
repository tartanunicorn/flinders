# Checking files against your app

A walkthrough points at elements and pages, and those change. Two checks catch it. Both are optional: left out, anything is accepted.

## In your build

`flinders-check` finds steps pointing at elements that aren't in your source. It reads text, so it works with any framework, and needs only Node:

```sh
npx flinders-check --source src --walkthroughs walkthroughs
```

```
walkthroughs/first-steps.json: step 2: no element “save-button” in the app

1 problem found checking 3 walkthrough files against 212 anchors in 96 source files.
```

| Option | Means |
|---|---|
| `--source <folder>` | Source files to scan. Repeat for several folders. |
| `--walkthroughs <path>` | A walkthrough file, or a folder of them. Repeatable. |
| `--list <file>` | Instead of checking, writes every element found as a JSON array, a bound one as `open-*`. For `app.anchors`. |
| `--attribute <name>` | Attribute that marks an element, `data-testid` by default. Repeatable. |
| `--ext <.ext>` | File type to scan, replacing the default list. Repeatable. |

It exits 0 when all is fine, 1 with problems, and 2 when it couldn't run, including when it found nothing to check.

It reads fixed values (`data-testid="save"`) and the fixed start of bound ones, in the usual forms: `[attr.data-testid]="'open-' + slug"`, `:data-testid="'open-' + slug"`, ``data-testid={`open-${slug}`}``, `data-testid="open-{{slug}}"`, `setAttribute('data-testid', 'open-' + id)`. Any anchor starting with `open-` then counts as found, so a wrong ending on a bound anchor gets through. A value with no fixed start, like `data-testid={id}`, can't be seen, so a step pointing at it is reported as missing: give the value a fixed start. `node_modules`, build folders and `.spec` and `.test` files are skipped.

## On your server

Your server has no source to read, so give it the lists. Add `--list` to your build, and pass the file in:

```sh
npx flinders-check --source src --list flinders-anchors.json
```

```js
const anchors = JSON.parse(readFileSync('flinders-anchors.json', 'utf8'));

createFlinders({
  query,
  app: { anchors, pages: ['/', '/projects/:projectId'], retiredWords: ['old product name'] },
});
```

An upload that points at something missing is then refused with a plain message, and a live walkthrough that stops fitting a new release shows `problems` in the admin list, for your **Needs update**. `pages` are your route patterns; nothing can read those from text in every framework, so list them, or generate them from your router. `retiredWords` are words a walkthrough may not use, and a touch-screen check (`click`, `hover` without phone copy) always runs.

If your checks are more than lists, `app` also takes `{ anchorExists(id), routeExists(route) }`.

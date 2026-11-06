# Matching your design

There are three levels. Start at the first and only go further if you need to. `player.css` is needed at every level, as it holds the layout.

## Level 1: your colours

The card works as it is. To match your product, set any of these variables on `:root`; each has a default.

```css
:root {
  --flinders-primary: #0f766e;
  --flinders-primary-hover: #115e59;
  --flinders-accent-deep: #0f766e;
}
```

| What | Variables |
|---|---|
| Buttons | `--flinders-primary`, `--flinders-primary-hover`, `--flinders-on-primary` |
| Card | `--flinders-surface`, `--flinders-surface-2`, `--flinders-border`, `--flinders-shadow-dialog`, `--flinders-r-dialog`, `--flinders-r-control` |
| Text | `--flinders-text`, `--flinders-text-secondary`, `--flinders-text-muted`, `--flinders-danger`, `--flinders-font-ui`, `--flinders-fs-base`, `--flinders-fs-meta` |
| Highlight and focus | `--flinders-accent-deep`, `--flinders-focus-ring`, `--flinders-focus-offset` |
| Dimmed page | `--flinders-overlay` |
| Spacing | `--flinders-sp-2`, `--flinders-sp-3`, `--flinders-sp-4`, `--flinders-sp-5` |
| Recording bar | `--flinders-recorder-bottom`, its distance from the bottom of the screen |

## Level 2: your classes

Add your own class names to the card and its buttons, and pass `unstyled` to drop ours and keep only the layout.

```ts
createFlinders({
  // …
  player: {
    classes: { card: 'my-card', primary: 'btn btn-primary', secondary: 'btn', link: 'btn-link' },
    unstyled: true,
  },
});
```

## Level 3: your own card

Pass `renderCard` and draw the card yourself. The player still dims the page, places the card and moves it with the element. You get a `PlayerCard` of plain data and functions: `title`, `body`, `bodyHtml`, `step`, `total`, `progress`, `canGoBack`, `showNext`, `nextLabel`, `next()`, `back()` and `finishLater()`, plus `learnMore()` and `learnMoreLabel` on the last step of a walkthrough with an article. Return a function if you have anything to clear up.

```ts
createFlinders({
  // …
  player: {
    renderCard(container, card) {
      container.innerHTML = `<h3></h3><p>${card.bodyHtml}</p>`;
      container.querySelector('h3')!.textContent = card.title;
    },
  },
});
```

- `bodyHtml` is safe to insert: everything but `**bold**` is escaped. Set `title` as text, as it isn't escaped.
- Draw Next only when `showNext` is true: on a Guide me step, the person's own action moves on.
- **Can't find it?** isn't part of `PlayerCard`, so an own card doesn't show it today. On a Guide me step with no Next, make sure the person can still leave with `finishLater()`.
- Draw it straight away. The player measures the card on the next frame, so in React use `flushSync`, and in Angular call `detectChanges`.

`examples/react` and `examples/angular` each draw the card in a component.

## The recording bar

The default bar has the same levels: the variables above, then `recording: { bar: { classes, unstyled } }`. For level 3, pass `recording: { bar: false }` and draw your own: see [Recording](recording.md).

## Words

Every word on screen can be changed, so you can use your own or translate them. Each has a default.

| Where | Option | Words |
|---|---|---|
| `player` | `labels` | `next`, `back`, `done`, `finishLater`, `learnMore`, `waiting`, `cantFind`, `cantSee(title)`, `skipStep`, `looking(title)`, `progress(step, total)`, `announce(step, total, title)` |
| `RecorderHost` | `labels` | `noAnchor`, the warning when a click lands on something with no `data-testid`; `full`, `noChoice`, `emptyPath`, `samePathStart`, `pathsOverlap` |
| `recording.bar` | `labels` | `bar`, `ready`, `readyHint`, `start`, `cancel`, `recording`, `recordingHint`, `undo`, `finish`, `paths`, `pathHint`, `nextPath`, `paused`, `pausedHint`, `recordPath`, `endPaths`, `stopped`, `stoppedHint`, `stoppedEmptyHint`, `download`, `steps(count)`, `path(number)`, `recordingAs(name)` |
| `createFlinders` | `labels` | `show`, `guide`, `offerMessage`, `notNow`, `offerHint`, `couldNotStart`, `linkExpired`, `linkNotAllowed`, `allowPopups`, `recordingRefused`, `recordingSaved`, `recordingNotSaved` |

## Fitting your page

- `player.anchorAttribute`: the attribute the player looks for, `data-testid` by default. Recording reads the same one.
- `player.markers`: what marks your sticky bars, so the card and highlight keep clear of them. By default, put `data-flinders-bar` on sticky bars and `data-flinders-bottom-bar` on a phone's bottom bar. In a pop-out, use `data-flinders-bar="header"` and `data-flinders-bar="actions"`.
- `player.compactQuery`: the media query for the phone layout. By default it's `(pointer: coarse), (max-width: 479.98px)`.

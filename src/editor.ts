import { forkAround, pathAround, samePath, stepPlaces } from './paths.js';
import { MAX_ARTICLE_HINTS } from './types.js';
import type { DoneWhen, WalkthroughMode, WalkthroughStep } from './types.js';

export type StepType = 'read' | 'do' | 'optional';

/** The three step types and their names: rename one here and every editor follows. */
export const STEP_TYPES: Record<StepType, { label: string; hint: string }> = {
  read: { label: 'Read', hint: 'They press Next' },
  do: { label: 'Do', hint: 'They do it, and it moves on by itself' },
  optional: { label: 'Optional', hint: 'They can use what’s highlighted, and press Next' },
};

/**
 * What a step editor does, with no screen: a product draws its own table and calls these. Each
 * returns a new list, so a product's own undo, dirty check or Save works however it likes.
 */

/** A step moved to a new position. */
export function moveStep(steps: readonly WalkthroughStep[], from: number, to: number): WalkthroughStep[] {
  const next = [...steps];
  const [step] = next.splice(from, 1);
  if (!step) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, step);
  return next;
}

/** A step with some of its fields changed. A field set to undefined is removed. */
export function updateStep(steps: readonly WalkthroughStep[], index: number, patch: Partial<WalkthroughStep>): WalkthroughStep[] {
  return steps.map((step, i) => {
    if (i !== index) return step;
    const merged = { ...step, ...patch };
    for (const key of Object.keys(merged) as (keyof WalkthroughStep)[]) if (merged[key] === undefined) delete merged[key];
    return merged;
  });
}

export function removeStep(steps: readonly WalkthroughStep[], index: number): WalkthroughStep[] {
  return steps.filter((_, i) => i !== index);
}

/** A new explaining step, with nothing highlighted, after `index`. */
export function addStep(steps: readonly WalkthroughStep[], index: number): WalkthroughStep[] {
  const next = [...steps];
  next.splice(index + 1, 0, { anchor: null, title: '', body: '', missing: 'centred' });
  return next;
}

/** A step's type. `done_when` wins, the same as in the player; a click that moves it on is a Do step too. */
export function stepType(step: WalkthroughStep): StepType {
  if (step.done_when) return 'do';
  if (step.optional) return 'optional';
  return step.advance_on_click ? 'do' : 'read';
}

/**
 * A step of the given type. The same type changes nothing, so saving an untouched step keeps it as
 * it was. Leaving Do drops what only Do uses; clicking must not skip an Optional step or a step
 * changed to Read, so those drop `advance_on_click` too.
 */
export function setStepType(step: WalkthroughStep, type: StepType): WalkthroughStep {
  if (type === stepType(step)) return step;
  const { done_when: _done, help_after: _help, optional: _optional, advance_on_click, ...rest } = step;
  if (type === 'do') return { ...rest, ...(advance_on_click ? { advance_on_click } : {}), done_when: { kind: 'clicked' } };
  return type === 'optional' ? { ...rest, optional: true } : rest;
}

/** What moves a Do step on. */
export const DONE_WHEN_LABELS: Record<DoneWhen['kind'], string> = { clicked: 'They click it', filled: 'They fill it in', chosen: 'They choose something', appears: 'Something appears', route: 'They reach a page' };

/** "Can't find it?" shows after this long unless a step says otherwise. */
export const DEFAULT_HELP_AFTER = 3;

/** The seconds to save: nothing for the default, a step that isn't Do, or something that isn't a number. */
export function helpAfterOf(type: StepType, text: string | undefined): number | undefined {
  const seconds = Math.round(Number(text));
  if (type !== 'do' || !text?.trim() || !Number.isFinite(seconds) || seconds === DEFAULT_HELP_AFTER) return undefined;
  return Math.min(120, Math.max(1, seconds));
}

/** A slug from a title. */
export const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

/** What a step's edit form starts from: the phone words, whether the step can be Do or Optional, and what can move a Do step on. */
export function stepForm(step: WalkthroughStep): { phone: string; canUse: boolean; doneChoices: DoneWhen['kind'][] } {
  const kind = step.done_when?.kind;
  return {
    phone: typeof step.phone === 'object' ? (step.phone.body ?? '') : '',
    canUse: !!step.anchor || !!kind,
    doneChoices: [...(step.anchor ? (['clicked', 'filled', 'chosen'] as const) : []), ...(kind === 'appears' || kind === 'route' ? [kind] : [])],
  };
}

/** A step after its edit form: the words, the type and what goes with it. Everything else stays. */
export function applyStepForm(step: WalkthroughStep, form: { title: string; body: string; phone?: string; type: StepType; done?: string; helpAfter?: string; articles?: string[] }): WalkthroughStep {
  const done = form.done || 'clicked';
  const typed = setStepType(step, form.type);
  const done_when = form.type !== 'do' ? undefined : done === (typed.done_when?.kind ?? 'clicked') ? typed.done_when : ({ kind: done } as WalkthroughStep['done_when']);
  const keepPhone = typeof step.phone === 'object' ? step.phone : {};
  const phoneBody = form.phone?.trim();
  const phone = step.phone === 'skip' ? 'skip' : phoneBody ? { ...keepPhone, body: phoneBody } : undefined;
  const articles = form.articles ? { articles: form.articles.length ? form.articles : undefined } : {};
  return updateStep([typed], 0, { title: form.title, body: form.body, done_when, phone, help_after: helpAfterOf(form.type, form.helpAfter), ...articles })[0]!;
}

/** What a step editor saves: the file it came from with new words and steps, or a new one from the title. */
export function editedFile<F extends { slug?: string; articles?: string[] }>(input: { file?: F; article?: string; articles?: string[]; title: string; mode: WalkthroughMode; steps: WalkthroughStep[] }) {
  const { file, article, articles, title, mode, steps } = input;
  const { articles: kept, ...rest } = (file ?? {}) as F;
  const hints = articles ?? kept;
  return { ...rest, ...(article ? { article } : {}), ...(hints?.length ? { articles: hints } : {}), slug: file?.slug ?? slugOf(title), title, mode, steps };
}

/** The words a recorded step is saved with until someone writes its own (a saved step can't be blank). */
const UNWRITTEN_TITLE = 'Untitled step';
const UNWRITTEN_BODY = 'Say what to do here.';

/** Recorded steps with their blank words filled, so they can be saved as a draft. */
export function fillRecordedWords<T extends { title?: unknown; body?: unknown }>(steps: readonly T[]): (T & { title: unknown; body: unknown })[] {
  return steps.map((s) => ({ ...s, title: s.title || UNWRITTEN_TITLE, body: s.body || UNWRITTEN_BODY }));
}

/** Recorded steps as a walkthrough file: what a finished recording saves, and what uploads later if it can't be saved. */
export function recordingFile<T extends { title?: unknown; body?: unknown }>(steps: readonly T[]) {
  return { slug: 'recorded-walkthrough', title: 'Recorded walkthrough', mode: 'guide' as const, steps: fillRecordedWords(steps) };
}

/** The opposite, for a step editor: unwritten words are blank again, so `draftProblems` asks for them. */
export function clearRecordedWords(steps: readonly WalkthroughStep[]): WalkthroughStep[] {
  return steps.map((s) => ({ ...s, title: s.title === UNWRITTEN_TITLE ? '' : s.title, body: s.body === UNWRITTEN_BODY ? '' : s.body }));
}

/** Step numbers (from 1) still holding the words a recording saved them with. */
export function unwrittenSteps(steps: readonly { title?: unknown; body?: unknown }[]): number[] {
  return steps.flatMap((s, i) => (s.title === UNWRITTEN_TITLE || s.body === UNWRITTEN_BODY ? [i + 1] : []));
}

/**
 * What's unfinished in a draft, in plain words, per step: empty words, and a Guide me with nothing
 * to do, then `forkWarnings`, which don't stop a save (`draftBlockers` is the list without them).
 * The product's own checks (elements, pages, retired words) come from `stepProblems`.
 */
export function draftProblems(steps: readonly WalkthroughStep[], mode: WalkthroughMode): string[] {
  return [...draftBlockers(steps, mode), ...forkWarnings(steps), ...(mode === 'show' ? showWarnings(steps) : [])];
}

/** A Show me clicks nothing, so it can't reach a page whose id no earlier page gave it: it would stop there. */
function showWarnings(steps: readonly WalkthroughStep[]): string[] {
  const names = stepNames(steps);
  const known = new Set<string>();
  let started = false;
  return steps.flatMap((s, i) => {
    if (!s.route) return [];
    const ids = s.route.match(/:\w+/g) ?? [];
    const stuck = started && ids.some((id) => !known.has(id));
    ids.forEach((id) => known.add(id));
    started = true;
    return stuck ? [`${names[i]} needs a page that a Show me can’t open by itself, as it doesn’t know which one. Start on that page, or make this a Guide me.`] : [];
  });
}

/** What must be fixed before a draft can be saved. */
export function draftBlockers(steps: readonly WalkthroughStep[], mode: WalkthroughMode): string[] {
  const problems: string[] = [];
  const names = stepNames(steps);
  if (!steps.length) problems.push('Add at least one step.');
  steps.forEach((s, i) => {
    if (!s.title.trim()) problems.push(`${names[i]} needs a title.`);
    if (!s.body.trim()) problems.push(`${names[i]} needs a sentence saying what to do.`);
    if (onlyIfList(s).length > MAX_ONLY_IF) problems.push(`${names[i]} can name up to ${MAX_ONLY_IF} things to show only when.`);
    if ((s.articles?.length ?? 0) > MAX_ARTICLE_HINTS) problems.push(`${names[i]} can name up to ${MAX_ARTICLE_HINTS} articles.`);
  });
  if (mode === 'guide' && steps.length && !steps.some((s) => s.done_when)) problems.push('Guide me needs at least one step the person does themselves.');
  return problems;
}

/**
 * A fork: neighbouring `only_if` steps, of which a person takes one path; neighbouring steps with
 * the same `only_if` are one path. Nothing here is stored or changes the file's shape: a fork is only
 * a way of reading the flat list, the same way the player reads it (`stepPlace`), so `place` is the
 * number on the card. `path` and `paths` count paths, `part` and `parts` the steps of this path.
 */
export type StepRow =
  | { kind: 'step'; index: number; place: number; step: WalkthroughStep }
  /** The row that heads a fork: not a step, and never saved. `first` and `last` are its paths. */
  | { kind: 'fork'; first: number; last: number; paths: number; place: number }
  | { kind: 'path'; index: number; place: number; step: WalkthroughStep; fork: number; path: number; paths: number; part: number; parts: number };

/** The most elements `only_if` can name (the file format's limit). */
export const MAX_ONLY_IF = 5;

/** A step list as a table's rows: each step, and each fork as a heading with its paths under it. */
export function stepRows(steps: readonly WalkthroughStep[]): StepRow[] {
  const rows: StepRow[] = [];
  const { places } = stepPlaces(steps);
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i]!.only_if) {
      rows.push({ kind: 'step', index: i, place: places[i]!, step: steps[i]! });
      continue;
    }
    const fork = forkAround(steps, i);
    const starts: number[] = [];
    for (let at = fork.first; at <= fork.last; at = pathAround(steps, at).last + 1) starts.push(at);
    rows.push({ kind: 'fork', ...fork, paths: starts.length, place: places[fork.first]! });
    starts.forEach((start, n) => {
      const { first, last } = pathAround(steps, start);
      for (let at = first; at <= last; at++) rows.push({ kind: 'path', index: at, place: places[at]!, step: steps[at]!, fork: fork.first, path: n + 1, paths: starts.length, part: at - first + 1, parts: last - first + 1 });
    });
    i = fork.last;
  }
  return rows;
}

/** What a fork's heading says. */
export const forkHeading = (paths: number) => (paths === 1 ? 'Plays only when it applies' : `One of these plays · ${paths} paths`);

/** The elements a step's `only_if` names, as a list. */
export const onlyIfList = (step: Pick<WalkthroughStep, 'only_if'>): string[] => [step.only_if ?? []].flat();

/** An element's id in words: `project-picker` is "Project picker". */
export const elementLabel = (id: string) => (id.charAt(0).toUpperCase() + id.slice(1)).replace(/-/g, ' ');

/** What a step waits for, in words: "File drop or Project picker". Empty for a step that always plays. */
export const onlyIfLabel = (step: Pick<WalkthroughStep, 'only_if'>) => onlyIfList(step).map(elementLabel).join(' or ');

/** A chooser's list: the elements the product offers, keeping any already chosen that it doesn't list. */
export function elementChoices(anchors: readonly string[], chosen: readonly string[] = []): { value: string; label: string }[] {
  return [...new Set([...chosen, ...anchors])].map((value) => ({ value, label: elementLabel(value) }));
}

/** Each step's name in a message: "Step 4", or "Step 4, path 2" inside a fork. */
function stepNames(steps: readonly WalkthroughStep[]): string[] {
  const names: string[] = [];
  for (const row of stepRows(steps)) {
    if (row.kind === 'fork') continue;
    names[row.index] = row.kind === 'path' && row.paths > 1 ? `Step ${row.place}, path ${row.path}` : `Step ${row.place}`;
  }
  return names;
}

/**
 * A step's `only_if` set or removed, which turns it into a fork or back. Set, it changes the whole of
 * the step's path, which stays one path. A step taken out of the middle of a fork goes below it, so
 * the fork stays whole. Naming the same elements changes nothing.
 */
export function setOnlyIf(steps: readonly WalkthroughStep[], index: number, onlyIf?: string | readonly string[]): WalkthroughStep[] {
  const step = steps[index];
  if (!step) return [...steps];
  const list = [onlyIf ?? []].flat();
  const was = onlyIfList(step);
  if (list.length === was.length && list.every((id, i) => id === was[i])) return [...steps];
  if (list.length) {
    const only_if = list.length === 1 ? list[0]! : list;
    const { first, last } = pathAround(steps, index);
    return steps.map((s, at) => (at >= first && at <= last ? { ...s, only_if } : s));
  }
  const cleared = updateStep(steps, index, { only_if: undefined });
  let below = index;
  while (cleared[below + 1]?.only_if) below++;
  return cleared[index - 1]?.only_if ? moveStep(cleared, index, below) : cleared;
}

/** A whole fork moved. `to`: where its first path lands, counted in the list without the fork. */
export function moveFork(steps: readonly WalkthroughStep[], first: number, last: number, to: number): WalkthroughStep[] {
  const rest = [...steps];
  const block = rest.splice(first, last - first + 1);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, ...block);
  return rest;
}

/** A step moved to `to` and made a path: `onlyIf` is what picks it. Reordering inside a fork is `moveStep`. */
export function moveIntoFork(steps: readonly WalkthroughStep[], from: number, to: number, onlyIf: string | readonly string[]): WalkthroughStep[] {
  return setOnlyIf(moveStep(steps, from, to), to, onlyIf);
}

/** A path moved to `to` and made a step that always plays. */
export function moveOutOfFork(steps: readonly WalkthroughStep[], from: number, to: number): WalkthroughStep[] {
  return updateStep(moveStep(steps, from, to), to, { only_if: undefined });
}

/** A new path at the end of the fork ending at `last`, on the same page and element until edited. */
export function addPath(steps: readonly WalkthroughStep[], last: number, onlyIf: string | readonly string[]): WalkthroughStep[] {
  const { anchor = null, route, side, align } = steps[last] ?? {};
  const next = [...steps];
  next.splice(last + 1, 0, { anchor, title: '', body: '', missing: 'centred', ...(route ? { route } : {}), ...(side ? { side } : {}), ...(align ? { align } : {}) });
  return setOnlyIf(next, last + 1, onlyIf);
}

/** What a dragged row means: the new list, a choice still to make, or why it can't go there. */
export type StepDrop =
  | { kind: 'moved'; steps: WalkthroughStep[] }
  /** A step dropped among paths: ask what picks it, then `moveIntoFork(steps, from, to, …)`. */
  | { kind: 'needs-only-if'; from: number; to: number }
  | { kind: 'refused'; reason: string };

/**
 * Reads a drop in a table of `stepRows`. `order` is those rows as the table now shows them, with
 * `dragged` where it was dropped (a heading's paths stay behind until the list is rebuilt).
 *
 * Inside a fork means between its heading and its last path; a path dragged to the end of its own
 * fork stays in. A fork with one path moves as a step that keeps its `only_if`, so it can rejoin
 * others. Anything that would run two forks together is refused: the card counts them as one.
 */
export function dropStepRow(steps: readonly WalkthroughStep[], dragged: StepRow, order: readonly StepRow[]): StepDrop {
  const single = dragged.kind === 'path' && dragged.paths === 1 && dragged.parts === 1;
  const fork = dragged.kind === 'fork' ? dragged.first : single ? dragged.fork : null;
  const moving = (r: StepRow) => r === dragged || (fork !== null && (r.kind === 'fork' ? r.first === fork : r.kind === 'path' && r.fork === fork));
  const at = order.indexOf(dragged);
  const before = order.slice(0, at).filter((r) => !moving(r));
  const above = before.at(-1);
  const below = order.slice(at + 1).find((r) => !moving(r));
  const to = before.filter((r) => r.kind !== 'fork').length;
  const forkOf = (r?: StepRow) => (r?.kind === 'fork' ? r.first : r?.kind === 'path' ? r.fork : null);
  const among = forkOf(above) !== null && forkOf(above) === forkOf(below);

  if (dragged.kind === 'fork' && dragged.last > dragged.first) {
    const rest = steps.filter((_, i) => i < dragged.first || i > dragged.last);
    if (rest[to - 1]?.only_if || rest[to]?.only_if) return { kind: 'refused', reason: 'Two sets of paths side by side play as one. Leave a step between them.' };
    return { kind: 'moved', steps: moveFork(steps, dragged.first, dragged.last, to) };
  }
  const from = dragged.kind === 'fork' ? dragged.first : dragged.index;
  if (dragged.kind === 'step') {
    if (above?.kind === 'path' && below?.kind === 'path' && samePath(above.step, below.step)) return { kind: 'moved', steps: moveIntoFork(steps, from, to, above.step.only_if!) };
    if (among) return { kind: 'needs-only-if', from, to };
    if (to !== from && steps[from - 1]?.only_if && steps[from + 1]?.only_if) return { kind: 'refused', reason: 'This step keeps two sets of paths apart. Move one of them first.' };
    return { kind: 'moved', steps: moveStep(steps, from, to) };
  }
  const stays = fork !== null || among || (above?.kind === 'path' && above.fork === forkOf(dragged));
  if (!stays) return { kind: 'moved', steps: moveOutOfFork(steps, from, to) };
  const moved = moveStep(steps, from, to);
  return splitsAPath(moved) ? { kind: 'refused', reason: 'That would split a path. Keep its steps together.' } : { kind: 'moved', steps: moved };
}

/** A path broken up inside one fork: its steps would no longer read as one path. */
function splitsAPath(steps: readonly WalkthroughStep[]): boolean {
  const starts = stepRows(steps).flatMap((r) => (r.kind === 'path' && r.part === 1 ? [r] : []));
  return starts.some((a, i) => starts.slice(i + 1).some((b) => a.fork === b.fork && samePath(a.step, b.step)));
}

/**
 * Forks that look wrong in the list, in plain words, though a save can still go ahead: a lone path
 * pointing at the same element as a fork elsewhere (left out of it), and a path waiting for
 * something only a later step's `done_when` brings on screen. Only what the file itself shows.
 */
export function forkWarnings(steps: readonly WalkthroughStep[]): string[] {
  const warnings: string[] = [];
  const names = stepNames(steps);
  const forks = stepRows(steps).filter((r) => r.kind === 'fork');
  for (const lone of forks.filter((f) => f.paths === 1)) {
    const { anchor } = steps[lone.first]!;
    const home = anchor ? forks.find((f) => f.paths > 1 && steps.slice(f.first, f.last + 1).some((s) => s.anchor === anchor)) : null;
    if (home) warnings.push(`Step ${lone.place} is on its own, apart from the paths at step ${home.place}. Move it next to them so only one of them plays.`);
  }
  steps.forEach((s, i) => {
    const needs = onlyIfList(s);
    const opens = (at: WalkthroughStep) => at.done_when?.kind === 'appears' && needs.includes(at.done_when.anchor);
    const later = steps.findIndex((at, j) => j > i && opens(at));
    if (later >= 0 && !steps.slice(0, i).some(opens)) warnings.push(`${names[i]} waits for something that only appears at ${names[later]!.toLowerCase()}. Move it after that step.`);
  });
  return warnings;
}

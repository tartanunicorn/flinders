import { describe, expect, it } from 'vitest';

import {
  addPath,
  draftBlockers,
  draftProblems,
  dropStepRow,
  elementChoices,
  forkHeading,
  forkWarnings,
  MAX_ONLY_IF,
  moveIntoFork,
  onlyIfLabel,
  setOnlyIf,
  setStepType,
  STEP_TYPES,
  stepRows,
  stepType,
  type StepDrop,
  type WalkthroughStep,
} from '../src/index.js';
import { stepPlace } from '../src/player.js';

describe('forks in a step table', () => {
  const plain = (title: string): WalkthroughStep => ({ anchor: 'next', title, body: 'Say it.', missing: 'centred' });
  const path = (title: string, only_if: string | string[] = title.toLowerCase(), anchor = 'pick'): WalkthroughStep => ({ anchor, title, body: 'Say it.', missing: 'centred', only_if });
  const titles = (steps: WalkthroughStep[]) => steps.map((s) => s.title);
  const list = [plain('A'), plain('B'), path('T'), path('E'), path('G'), plain('C')];
  /** The shape of a real walkthrough: one fork on one element, and a lone step about something else. */
  const seed = { steps: [plain('Start'), plain('Source'), path('T'), path('E'), path('G'), plain('Template'), path('Setup', 'setup', 'setup-questions'), plain('Create')] };

  /** Drags the row at `from` so it sits at `at` in the table. */
  function drag(steps: WalkthroughStep[], from: number, at: number) {
    const order = stepRows(steps);
    const [row] = order.splice(from, 1);
    order.splice(at, 0, row!);
    return dropStepRow(steps, row!, order);
  }
  const moved = (drop: StepDrop) => (drop.kind === 'moved' ? titles(drop.steps) : drop);

  describe('stepRows', () => {
    it('reads steps, a heading and its paths; the heading isn’t a step', () => {
      const rows = stepRows(list);
      expect(rows.map((r) => r.kind)).toEqual(['step', 'step', 'fork', 'path', 'path', 'path', 'step']);
      expect(rows[2]).toEqual({ kind: 'fork', first: 2, last: 4, paths: 3, place: 3 });
      expect(rows.filter((r) => r.kind !== 'fork')).toHaveLength(list.length);
    });

    it('numbers every step as the card does', () => {
      const cases = [
        list,
        seed.steps,
        [path('X')],
        [path('X'), plain('A'), path('Y')],
        [plain('A'), path('X'), path('Y'), plain('B'), path('Z')],
        [plain('A'), path('X1', 'x'), path('X2', 'x'), path('X3', 'x'), path('Y1', 'y'), path('Y2', 'y'), plain('B')],
      ];
      for (const steps of cases) {
        for (const row of stepRows(steps)) {
          if (row.kind !== 'fork') expect(row.place).toBe(stepPlace(steps, row.index).step);
        }
      }
    });

    it('three paths for the data, and setup questions on their own', () => {
      const forks = stepRows(seed.steps).filter((r) => r.kind === 'fork');
      expect(forks.map((f) => [f.place, f.paths])).toEqual([[3, 3], [5, 1]]);
    });

    it('steps with the same only_if are one path, and number on from the fork; what follows counts the longest', () => {
      const steps = [plain('A'), path('T1', 't'), path('T2', ['t']), path('T3', 't'), path('E', 'e'), plain('B')];
      const rows = stepRows(steps);
      expect(rows[1]).toEqual({ kind: 'fork', first: 1, last: 4, paths: 2, place: 2 });
      expect(rows.flatMap((r) => (r.kind === 'path' ? [[r.step.title, r.place, r.path, r.part, r.parts]] : []))).toEqual([
        ['T1', 2, 1, 1, 3],
        ['T2', 3, 1, 2, 3],
        ['T3', 4, 1, 3, 3],
        ['E', 2, 2, 1, 1],
      ]);
      expect(rows.at(-1)).toMatchObject({ kind: 'step', place: 5 });
    });

    it('a heading says how many', () => {
      expect(forkHeading(3)).toBe('One of these plays · 3 paths');
      expect(forkHeading(1)).toBe('Plays only when it applies');
    });
  });

  describe('paths of several steps', () => {
    const long = [plain('A'), path('T1', 't'), path('T2', 't'), path('E1', 'e'), path('E2', 'e'), plain('B')];

    it('dragging the heading moves every step of a lone long path', () => {
      const steps = [plain('A'), path('T1', 't'), path('T2', 't'), plain('B')];
      const drop = drag(steps, 1, 5);
      expect(moved(drop)).toEqual(['A', 'B', 'T1', 'T2']);
    });

    it('a step moves within its own path', () => {
      expect(moved(drag(long, 2, 3))).toEqual(['A', 'T2', 'T1', 'E1', 'E2', 'B']);
    });

    it('a step can’t be dropped into another path: that would split one', () => {
      expect(drag(long, 2, 5)).toMatchObject({ kind: 'refused' });
    });

    it('a step dropped inside a path joins it, with nothing to ask', () => {
      const drop = drag(long, 0, 2);
      expect(drop.kind === 'moved' && drop.steps.map((s) => [s.title, s.only_if])).toEqual([
        ['T1', 't'],
        ['A', 't'],
        ['T2', 't'],
        ['E1', 'e'],
        ['E2', 'e'],
        ['B', undefined],
      ]);
    });

    it('Show only when changes the whole path, so it stays one', () => {
      const steps = setOnlyIf(long, 2, 'other');
      expect(steps.map((s) => s.only_if)).toEqual([undefined, 'other', 'other', 'e', 'e', undefined]);
    });

    it('a new path naming the same element as the last goes on the end of it', () => {
      const steps = addPath(long, 4, 'e');
      expect(stepRows(steps).filter((r) => r.kind === 'fork')).toMatchObject([{ paths: 2 }]);
    });

    it('messages name the step and its path', () => {
      expect(draftBlockers([plain('A'), path('T1', 't'), { ...path('T2', 't'), title: '' }, path('E', 'e')], 'show')).toEqual(['Step 3, path 1 needs a title.']);
    });
  });

  describe('dragging', () => {
    it('a fork moves as a block', () => {
      expect(moved(drag(list, 2, 1))).toEqual(['A', 'T', 'E', 'G', 'B', 'C']);
      expect(moved(drag(list, 2, 6))).toEqual(['A', 'B', 'C', 'T', 'E', 'G']);
    });

    it('a step moves past a whole fork', () => {
      expect(moved(drag(list, 1, 5))).toEqual(['A', 'T', 'E', 'G', 'B', 'C']);
      expect(moved(drag(list, 6, 2))).toEqual(['A', 'B', 'C', 'T', 'E', 'G']);
    });

    it('paths reorder inside their fork, to the very end too', () => {
      expect(moved(drag(list, 5, 3))).toEqual(['A', 'B', 'G', 'T', 'E', 'C']);
      const end = drag(list, 3, 5);
      expect(moved(end)).toEqual(['A', 'B', 'E', 'G', 'T', 'C']);
      expect(end.kind === 'moved' && end.steps.slice(2, 5).every((s) => s.only_if)).toBe(true);
    });

    it('a path dragged out always plays', () => {
      const drop = drag(list, 3, 1);
      expect(moved(drop)).toEqual(['A', 'T', 'B', 'E', 'G', 'C']);
      expect(drop.kind === 'moved' && drop.steps[1]!.only_if).toBeUndefined();
    });

    it('a step dropped among paths asks what picks it', () => {
      expect(drag(list, 1, 4)).toEqual({ kind: 'needs-only-if', from: 1, to: 3 });
      const steps = moveIntoFork(list, 1, 3, 'file-drop');
      expect(titles(steps)).toEqual(['A', 'T', 'E', 'B', 'G', 'C']);
      expect(steps[3]!.only_if).toBe('file-drop');
    });

    it('a lone path keeps its only_if and can rejoin a fork', () => {
      const steps = [path('T'), path('E'), plain('A'), path('G')];
      const drop = drag(steps, 5, 2);
      expect(moved(drop)).toEqual(['T', 'G', 'E', 'A']);
      expect(drop.kind === 'moved' && drop.steps[1]!.only_if).toBe('g');
    });

    it('a drag that would run two forks together is refused, and says why', () => {
      const steps = [path('T'), path('E'), plain('A'), path('G'), path('H')];
      expect(drag(steps, 0, 3).kind).toBe('refused');
      expect(drag(steps, 3, 7).kind).toBe('refused');
      expect(drag(steps, 3, 0).kind).toBe('refused');
    });
  });

  describe('forks by hand', () => {
    it('turns a step into a fork and back', () => {
      const on = setOnlyIf(list, 0, ['one']);
      expect(on[0]!.only_if).toBe('one');
      expect(setOnlyIf(on, 0, ['one', 'two'])[0]!.only_if).toEqual(['one', 'two']);
      expect(setOnlyIf(on, 0, [])[0]).toEqual(list[0]);
    });

    it('naming the same elements leaves the step as it was', () => {
      expect(setOnlyIf([path('T', ['t'])], 0, ['t'])[0]!.only_if).toEqual(['t']);
    });

    it('a path cleared from the middle goes below, so the fork stays whole', () => {
      const steps = setOnlyIf(list, 3, undefined);
      expect(titles(steps)).toEqual(['A', 'B', 'T', 'G', 'E', 'C']);
      expect(steps[4]!.only_if).toBeUndefined();
      expect(stepRows(steps).filter((r) => r.kind === 'fork')).toHaveLength(1);
    });

    it('adds a path at the end of the fork, on the same element', () => {
      const steps = addPath([plain('A'), { ...path('T'), route: '/new', side: 'bottom' }, plain('C')], 1, ['site-picker']);
      expect(steps[2]).toEqual({ anchor: 'pick', route: '/new', side: 'bottom', title: '', body: '', missing: 'centred', only_if: 'site-picker' });
      expect(steps).toHaveLength(4);
    });

    it('offers elements with any already chosen, in words', () => {
      expect(elementChoices(['project-picker'], ['site-picker'])).toEqual([
        { value: 'site-picker', label: 'Site picker' },
        { value: 'project-picker', label: 'Project picker' },
      ]);
      expect(onlyIfLabel(path('T', ['site-picker', 'file-drop']))).toBe('Site picker or File drop');
    });
  });

  describe('warnings', () => {
    it('a fork of paths with a separate step about something else is fine', () => {
      expect(draftProblems(seed.steps, 'show')).toEqual([]);
    });

    it('warns that a Show me can’t open a page with an id it was never given', () => {
      const list = { ...plain('List'), route: '/projects' };
      const one = { ...plain('One'), route: '/projects/:projectId' };
      expect(draftProblems([list, one], 'show')).toEqual(['Step 2 needs a page that a Show me can’t open by itself, as it doesn’t know which one. Start on that page, or make this a Guide me.']);
      expect(draftBlockers([list, one], 'show')).toEqual([]);
      expect(draftProblems([one, one], 'show')).toEqual([]);
    });

    it('a lone step left out of its fork', () => {
      expect(forkWarnings([path('T'), path('E'), plain('A'), path('G')])).toEqual(['Step 3 is on its own, apart from the paths at step 1. Move it next to them so only one of them plays.']);
    });

    it('a lone step about something else isn’t left out', () => {
      expect(forkWarnings([path('T'), path('E'), plain('A'), path('G', 'g', 'other')])).toEqual([]);
    });

    it('a fork step before the step that opens its element', () => {
      const opener: WalkthroughStep = { ...plain('Open'), done_when: { kind: 'appears', anchor: 'list' } };
      expect(forkWarnings([path('T', 'list'), opener])).toEqual(['Step 1 waits for something that only appears at step 2. Move it after that step.']);
      expect(forkWarnings([opener, path('T', 'list')])).toEqual([]);
    });

    it('warnings don’t stop a save; unfinished words do, named by path', () => {
      const steps = [path('T'), { ...path('E'), title: '' }, plain('A'), path('G')];
      expect(draftBlockers(steps, 'show')).toEqual(['Step 1, path 2 needs a title.']);
      expect(draftProblems(steps, 'show')).toHaveLength(2);
    });

    it('more elements than a file can hold are named', () => {
      expect(draftBlockers([path('T', ['a', 'b', 'c', 'd', 'e', 'f'])], 'show')).toEqual([`Step 1 can name up to ${MAX_ONLY_IF} things to show only when.`]);
    });
  });
});

const read: WalkthroughStep = { anchor: 'add', title: 'Add', body: 'Add one.', missing: 'centred' };
const doIt: WalkthroughStep = { ...read, done_when: { kind: 'filled' }, help_after: 9 };
const optional: WalkthroughStep = { ...read, optional: true };

describe('step types', () => {
  it('names every type in one place', () => {
    expect(Object.values(STEP_TYPES).map((t) => t.label)).toEqual(['Read', 'Do', 'Optional']);
  });

  it('reads a step’s type from its fields', () => {
    expect(stepType(read)).toBe('read');
    expect(stepType(doIt)).toBe('do');
    expect(stepType(optional)).toBe('optional');
    expect(stepType({ ...read, done_when: { kind: 'clicked' }, optional: true })).toBe('do');
  });

  it('changes nothing when the type stays the same', () => {
    const clicks = { ...read, advance_on_click: true };
    expect(setStepType(clicks, 'do')).toBe(clicks);
    expect(setStepType(doIt, 'do')).toBe(doIt);
    expect(setStepType(optional, 'optional')).toBe(optional);
  });

  it('Do starts as clicked and drops optional', () => {
    expect(setStepType(optional, 'do')).toEqual({ ...read, done_when: { kind: 'clicked' } });
  });

  it('a click that moves on is a Do step, and Read drops it', () => {
    const clicks = { ...read, advance_on_click: true };
    expect(stepType(clicks)).toBe('do');
    expect(stepType({ ...clicks, optional: true })).toBe('optional');
    expect(setStepType(clicks, 'read')).toEqual(read);
  });

  it('Do keeps a click that moves on when it picks up done_when', () => {
    expect(setStepType({ ...optional, advance_on_click: true }, 'do')).toEqual({ ...read, advance_on_click: true, done_when: { kind: 'clicked' } });
  });

  it('Read and Optional have no done_when or seconds', () => {
    expect(setStepType(doIt, 'read')).toEqual(read);
    expect(setStepType(doIt, 'read')).not.toHaveProperty('done_when');
    expect(setStepType(doIt, 'optional')).toEqual(optional);
    expect(setStepType(doIt, 'optional')).not.toHaveProperty('help_after');
  });

  it('a click can’t skip an Optional step', () => {
    expect(setStepType({ ...read, advance_on_click: true }, 'optional')).toEqual(optional);
  });

  it('leaving Optional removes the field', () => {
    expect(setStepType(optional, 'read')).not.toHaveProperty('optional');
  });
});

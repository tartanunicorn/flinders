// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addStep, draftProblems, moveStep, Recorder, removeStep, updateStep, type RecorderState, type WalkthroughStep } from '../src/index.js';

const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();

describe('Recorder', () => {
  let url: string;
  let recorder: Recorder;
  let seen: RecorderState[];

  beforeEach(() => {
    url = '/projects/12';
    seen = [];
    document.body.innerHTML = `
      <button data-testid="add"><span id="inner">Add</span></button>
      <label data-testid="name"><input id="name" /></label>
      <button id="plain">No test id</button>
      <div data-flinders-recorder><button data-testid="undo">Undo</button></div>`;
    recorder = new Recorder({ url: () => url, routePattern: (u) => u.replace(/\/\d+/, '/:projectId'), onChange: (s) => seen.push(s) });
    recorder.start();
  });

  it('turns clicks into steps with the page and what finished them', () => {
    click('#inner');
    expect(recorder.stop()).toEqual([{ anchor: 'add', route: '/projects/:projectId', title: '', body: '', done_when: { kind: 'clicked' }, missing: 'centred' }]);
  });

  it('Undo takes the page back too, so the next step on it says so again', () => {
    click('#inner');
    url = '/reports';
    click('#name');
    recorder.undo();
    recorder.undo();
    click('#inner');
    expect(recorder.stop()[0]?.route).toBe('/reports');
  });

  it('carrying on after a reload knows the page it was on', () => {
    click('#inner');
    const steps = recorder.stop();
    recorder.start(steps);
    click('#name');
    expect(recorder.stop()[1]?.route).toBeUndefined();
  });

  describe('paths', () => {
    let visible: Set<string>;
    const realRect = Element.prototype.getBoundingClientRect;

    beforeEach(() => {
      visible = new Set();
      document.body.insertAdjacentHTML('beforeend', ['choice', 'a1', 'a2', 'b1', 'c1', 'shared'].map((id) => `<button data-testid="${id}">${id}</button>`).join(''));
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const on = visible.has(this.getAttribute('data-testid') ?? '');
        return { width: on ? 10 : 0, height: on ? 10 : 0 } as DOMRect;
      };
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = realRect;
    });

    const tap = (id: string) => click(`[data-testid="${id}"]`);
    const shape = () => recorder.current.steps.map((s) => [s.anchor, s.only_if]);
    /** Choice, then a two-step first path, paused for the next. */
    const onePath = () => {
      tap('choice');
      recorder.startPaths();
      tap('a1');
      tap('a2');
      recorder.nextPath();
    };

    it('every step of a path shares the only_if its first click set, and the steps after End paths have none', () => {
      onePath();
      recorder.recordPath();
      tap('b1');
      recorder.nextPath();
      recorder.recordPath();
      tap('c1');
      recorder.endPaths();
      tap('shared');
      expect(shape()).toEqual([
        ['choice', undefined],
        ['a1', 'a1'],
        ['a2', 'a1'],
        ['b1', 'b1'],
        ['c1', 'c1'],
        ['shared', undefined],
      ]);
      expect(draftProblems(recorder.current.steps.map((s) => ({ ...s, title: 'T', body: 'B' })), 'guide')).toEqual([]);
    });

    it('the choice waits for Next, since a click may only open a list; Undo gives its Do back', () => {
      tap('choice');
      recorder.startPaths();
      expect(recorder.current.steps[0]?.done_when).toBeUndefined();
      recorder.undo();
      expect(recorder.current.steps[0]?.done_when).toEqual({ kind: 'clicked' });
      expect(recorder.current.forks).toEqual([]);
    });

    it('nothing is captured while paused, so going back adds no stray clicks', () => {
      onePath();
      tap('choice');
      tap('b1');
      expect(recorder.current.steps).toHaveLength(3);
      expect(recorder.current.warning).toBeNull();
    });

    it('Undo takes back the last thing done, a step or a press, all the way out', () => {
      onePath();
      recorder.recordPath();
      tap('b1');
      recorder.endPaths();
      const undoTo = (paused: boolean, open: boolean, steps: number) => {
        recorder.undo();
        expect([recorder.current.paused, !!recorder.current.forks.at(-1) && recorder.current.forks.at(-1)!.end === undefined, recorder.current.steps.length]).toEqual([paused, open, steps]);
      };
      undoTo(false, true, 4); // End paths
      undoTo(false, true, 3); // b1
      undoTo(true, true, 3); // Record path
      undoTo(false, true, 3); // Next path
      undoTo(false, true, 2); // a2
      undoTo(false, true, 1); // a1
      undoTo(false, false, 1); // This has paths
      expect(recorder.current.forks).toEqual([]);
      undoTo(false, false, 0);
    });

    it('Undo reaches back through a shared step into the paths, and carrying on still works', () => {
      onePath();
      recorder.recordPath();
      tap('b1');
      recorder.endPaths();
      tap('shared');
      recorder.undo();
      recorder.undo();
      recorder.undo();
      tap('c1');
      expect(shape().at(-1)).toEqual(['c1', 'c1']);
    });

    it('Next path needs something on the path, and paths need a choice before them', () => {
      recorder.startPaths();
      expect(recorder.current.forks).toEqual([]);
      expect(recorder.current.warning).toMatch(/makes the choice/);
      tap('choice');
      recorder.startPaths();
      recorder.nextPath();
      expect(recorder.current.paused).toBe(false);
      expect(recorder.current.warning).toMatch(/nothing on it/);
    });

    it('a step straight after End paths has to come before another fork, or the two would run together', () => {
      onePath();
      recorder.endPaths();
      recorder.startPaths();
      expect(recorder.current.warning).toMatch(/makes the choice/);
      expect(recorder.current.forks).toHaveLength(1);
    });

    it('End paths drops a path with nothing on it; with no path at all, the fork goes', () => {
      onePath();
      recorder.recordPath();
      recorder.endPaths();
      expect(recorder.current.forks).toEqual([{ choice: 0, done: { kind: 'clicked' }, paths: [1], end: 3 }]);
      recorder.stop();
      recorder.start();
      tap('choice');
      recorder.startPaths();
      recorder.endPaths();
      expect(recorder.current.forks).toEqual([]);
    });

    it('a path can’t start where another did: the two couldn’t be told apart', () => {
      onePath();
      recorder.recordPath();
      tap('a1');
      expect(recorder.current.steps).toHaveLength(3);
      expect(recorder.current.warning).toMatch(/another path starts/);
    });

    it('warns when another path’s start is on screen here too, keeping the step', () => {
      onePath();
      recorder.recordPath();
      visible.add('a1');
      tap('b1');
      expect(shape().at(-1)).toEqual(['b1', 'b1']);
      expect(recorder.current.warning).toMatch(/on screen here too/);
    });

    it('a path on another page: the next path knows the choice’s page, and the shared step always names its page', () => {
      tap('choice');
      recorder.startPaths();
      tap('a1');
      url = '/reports';
      tap('a2');
      recorder.nextPath();
      url = '/projects/12';
      recorder.recordPath();
      tap('b1');
      recorder.endPaths();
      tap('shared');
      expect(recorder.current.steps.map((s) => s.route)).toEqual(['/projects/:projectId', undefined, '/reports', undefined, '/projects/:projectId']);
    });

    it('a stopped recording starts again where it was', () => {
      onePath();
      const { forks, paused } = recorder.current;
      const steps = recorder.stop();
      recorder.start(steps, { forks, paused });
      tap('b1');
      expect(recorder.current.steps).toHaveLength(3);
      recorder.recordPath();
      tap('b1');
      expect(shape().at(-1)).toEqual(['b1', 'b1']);
    });
  });

  it('stops at 30 steps, says so in plain words, and Undo makes room', () => {
    const full = Array.from({ length: 30 }, (_, i) => ({ anchor: `s${i}`, title: '', body: '', missing: 'centred' as const }));
    recorder.stop();
    recorder.start(full);
    click('#inner');
    expect(recorder.current.steps).toHaveLength(30);
    expect(recorder.current.warning).toMatch(/30 steps/);
    recorder.undo();
    click('#inner');
    expect(recorder.current.steps).toHaveLength(30);
    expect(recorder.current.warning).toBeNull();
  });

  it('only records the page when it changes', () => {
    click('[data-testid="add"]');
    click('#name');
    url = '/projects/12/settings';
    document.body.insertAdjacentHTML('beforeend', '<button data-testid="save">Save</button>');
    click('[data-testid="save"]');
    expect(recorder.stop().map((s) => s.route)).toEqual(['/projects/:projectId', undefined, '/projects/:projectId/settings']);
  });

  it('counts typing as one filled step, and never reads what was typed', () => {
    click('#name');
    const input = document.querySelector<HTMLInputElement>('#name')!;
    input.value = 'A private name';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const steps = recorder.stop();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.done_when).toEqual({ kind: 'filled' });
    expect(JSON.stringify(seen)).not.toContain('A private name');
  });

  it('carries on from the steps it is given', () => {
    recorder.stop();
    const before: WalkthroughStep = { anchor: 'earlier', title: '', body: '', missing: 'centred' };
    recorder.start([before]);
    click('[data-testid="add"]');
    expect(recorder.stop().map((s) => s.anchor)).toEqual(['earlier', 'add']);
  });

  it('says so when something can’t be a step, and ignores its own bar', () => {
    click('#plain');
    expect(recorder.current.warning).toMatch(/can’t be pointed at/);
    click('[data-testid="undo"]');
    expect(recorder.current.steps).toEqual([]);
  });

  it('says it in the product’s own words when given them', () => {
    recorder.stop();
    const worded = new Recorder({ url: () => url, routePattern: () => null, labels: { noAnchor: 'Not that bit.' } });
    worded.start();
    click('#plain');
    expect(worded.current.warning).toBe('Not that bit.');
    worded.stop();
  });

  it('never stops the click reaching the app, and stops listening when done', () => {
    let reached = 0;
    document.querySelector('[data-testid="add"]')!.addEventListener('click', () => reached++);
    click('[data-testid="add"]');
    recorder.stop();
    click('#name');
    expect(reached).toBe(1);
    expect(recorder.current.steps).toHaveLength(1);
  });

  it('takes the last step back', () => {
    click('[data-testid="add"]');
    recorder.undo();
    expect(recorder.current.steps).toEqual([]);
  });
});

describe('step editor', () => {
  const s = (title: string, extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({ anchor: null, title, body: 'Words.', missing: 'centred', ...extra });

  it('moves, edits, adds and removes without changing what it was given', () => {
    const steps = [s('A'), s('B'), s('C')];
    expect(moveStep(steps, 2, 0).map((x) => x.title)).toEqual(['C', 'A', 'B']);
    expect(updateStep(steps, 1, { title: 'B2' })[1]!.title).toBe('B2');
    expect('done_when' in updateStep([s('A', { done_when: { kind: 'clicked' } })], 0, { done_when: undefined })[0]!).toBe(false);
    expect(addStep(steps, 0).map((x) => x.title)).toEqual(['A', '', 'B', 'C']);
    expect(removeStep(steps, 1).map((x) => x.title)).toEqual(['A', 'C']);
    expect(steps.map((x) => x.title)).toEqual(['A', 'B', 'C']);
  });

  it('says what’s unfinished in plain words', () => {
    expect(draftProblems([], 'show')).toEqual(['Add at least one step.']);
    expect(draftProblems([s('', { body: ' ' })], 'show')).toEqual(['Step 1 needs a title.', 'Step 1 needs a sentence saying what to do.']);
    expect(draftProblems([s('A')], 'guide')).toEqual(['Guide me needs at least one step the person does themselves.']);
    expect(draftProblems([s('A', { done_when: { kind: 'clicked' } })], 'guide')).toEqual([]);
  });
});

import { MAX_WALKTHROUGH_STEPS, type DoneWhen, type WalkthroughStep } from './types.js';

/** What the recorder needs from the product it runs in. */
export interface RecorderHost {
  /** The current URL (path and query). */
  url(): string;
  /** `/projects/123` → `/projects/:projectId`, from the product's own routes; null = not a known page. */
  routePattern(url: string): string | null;
  /** Called whenever the state changes, so a product can draw its own recording bar. */
  onChange?(state: RecorderState): void;
  /** The recorder's words, each with a default. */
  labels?: Partial<RecorderLabels>;
  /** The attribute that holds a step's anchor; `data-testid` by default. */
  anchorAttribute?: string;
}

export interface RecorderLabels {
  /** The warning when a click lands on something with no anchor. */
  noAnchor: string;
  /** The warning when a walkthrough has as many steps as it can hold. */
  full: string;
  /** The warning when paths are started with no step to hang them on. */
  noChoice: string;
  /** The warning when Next path is pressed on a path with no steps. */
  emptyPath: string;
  /** The warning when a path starts on the same element as an earlier one, so nothing tells them apart. */
  samePathStart: string;
  /** The warning when an earlier path's first element is on screen on this path too. */
  pathsOverlap: string;
}

const LABELS: RecorderLabels = {
  noAnchor: 'That part of the page can’t be pointed at yet, so it wasn’t added. Ask a developer to give it a test id.',
  full: `A walkthrough can hold ${MAX_WALKTHROUGH_STEPS} steps, so that wasn’t added. Finish here, or undo a step first.`,
  noChoice: 'Record the step that makes the choice first, then press this.',
  emptyPath: 'Click through this path first. There is nothing on it yet.',
  samePathStart: 'That’s where another path starts, so it wasn’t added. Click something only this path shows.',
  pathsOverlap: 'Added, but what starts another path is on screen here too, so that path would play instead. Set Show only when on this path in the step editor.',
};

/** Paths recorded off one choice. All of it is positions in the flat step list. */
export interface RecordedFork {
  /** The step that makes the choice. */
  choice: number;
  /** What finished that step before it was marked: put back if the marking is undone. */
  done?: DoneWhen;
  /** Where each path starts; the last is the one being recorded. */
  paths: number[];
  /** Where the paths ended; none yet = they're still being recorded. */
  end?: number;
}

/** What a recording holds beside its steps, to carry on from where it was. */
export interface RecorderProgress {
  forks: RecordedFork[];
  /** Between paths: the person is going back to switch the choice, and nothing is captured. */
  paused: boolean;
}

export interface RecorderState extends RecorderProgress {
  recording: boolean;
  steps: WalkthroughStep[];
  /** Why the last click couldn't be a step, in plain words; null = fine. */
  warning: string | null;
}

/** The fork being recorded, if any. */
export const openFork = (state: RecorderProgress): RecordedFork | null => {
  const fork = state.forks.at(-1);
  return fork && fork.end === undefined ? fork : null;
};

const onScreen = (id: string, attribute: string) =>
  Array.from(document.querySelectorAll(`[${attribute}="${id.replace(/["\\]/g, '\\$&')}"]`)).some((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });

/** The recorder's own bar marks itself with this, so clicks on it aren't steps. */
const OWN_UI = '[data-flinders-recorder]';

/**
 * Records a walkthrough while the person clicks through the real app: each click captures the
 * nearest `data-testid`, the page, and what finished the step. It watches and never stops a click,
 * so the app does what it would anyway. Never reads what anyone typed: a field only counts as
 * "filled". The person writes the words afterwards.
 */
export class Recorder {
  private state: RecorderState = { recording: false, steps: [], warning: null, forks: [], paused: false };
  private stopListening: (() => void) | null = null;
  private readonly listeners = new Set<(state: RecorderState) => void>();
  private readonly labels: RecorderLabels;
  private readonly attribute: string;

  constructor(private readonly host: RecorderHost) {
    this.labels = { ...LABELS, ...host.labels };
    this.attribute = host.anchorAttribute ?? 'data-testid';
  }

  get current(): RecorderState {
    return this.state;
  }

  /** Tells a listener of every change, as `onChange` does; returns how to stop listening. */
  subscribe(listener: (state: RecorderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts capturing. Pass `steps` and `progress` to carry on from where a reload left off. */
  start(steps: WalkthroughStep[] = [], progress: Partial<RecorderProgress> = {}): void {
    if (this.state.recording) return;
    this.set({ recording: true, steps, warning: null, forks: progress.forks ?? [], paused: progress.paused ?? false });
    const onClick = (event: Event) => this.onClick(event);
    const onChange = (event: Event) => this.onChange(event);
    // Capture: seen before the app's own handlers can move the page on.
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    this.stopListening = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
    };
  }

  /** Stops and returns the steps, ready for the person to add their words. */
  stop(): WalkthroughStep[] {
    this.stopListening?.();
    this.stopListening = null;
    this.set({ ...this.state, recording: false, warning: null });
    return this.state.steps;
  }

  /**
   * The choice has been made: the last step is the choice, and what's clicked next is its first path.
   * The choice waits for Next, because a click may only open a list, and the fork is read as it moves on.
   */
  startPaths(): void {
    const { steps } = this.state;
    if (!this.state.recording || openFork(this.state)) return;
    const last = steps.at(-1);
    if (!last || last.only_if) {
      this.set({ ...this.state, warning: this.labels.noChoice });
      return;
    }
    const { done_when: done, ...choice } = last;
    const fork = { choice: steps.length - 1, paths: [steps.length], ...(done ? { done } : {}) };
    this.set({ ...this.state, steps: [...steps.slice(0, -1), choice], forks: [...this.state.forks, fork], warning: null });
  }

  /** This path is done: nothing is captured while the person goes back and switches the choice. */
  nextPath(): void {
    const fork = openFork(this.state);
    if (!fork || this.state.paused) return;
    if (this.state.steps.length === fork.paths.at(-1)) this.set({ ...this.state, warning: this.labels.emptyPath });
    else this.set({ ...this.state, paused: true, warning: null });
  }

  /** The choice has been switched: what's clicked next starts the next path. */
  recordPath(): void {
    const fork = openFork(this.state);
    if (!fork || !this.state.paused) return;
    this.setFork({ ...fork, paths: [...fork.paths, this.state.steps.length] });
  }

  /** The paths are done: what's clicked next is a shared step again. A path with nothing on it goes. */
  endPaths(): void {
    const fork = openFork(this.state);
    if (!fork) return;
    const length = this.state.steps.length;
    const paths = length === fork.paths.at(-1) ? fork.paths.slice(0, -1) : fork.paths;
    if (paths.length) this.setFork({ ...fork, paths, end: length });
    else this.undo();
  }

  /** Takes back the last thing done, whether a step or a press on the bar. */
  undo(): void {
    const { steps, forks, paused } = this.state;
    const fork = forks.at(-1);
    const open = openFork(this.state);
    if (paused) this.set({ ...this.state, paused: false, warning: null });
    else if (fork?.end === steps.length) {
      const { end: _end, ...reopened } = fork;
      this.setFork(reopened);
    }
    else if (open && steps.length === open.paths.at(-1)) {
      if (open.paths.length > 1) this.set({ ...this.state, forks: [...forks.slice(0, -1), { ...open, paths: open.paths.slice(0, -1) }], paused: true, warning: null });
      else {
        const choice = steps[open.choice]!;
        this.set({ ...this.state, steps: [...steps.slice(0, -1), open.done ? { ...choice, done_when: open.done } : choice], forks: forks.slice(0, -1), warning: null });
      }
    } else this.set({ ...this.state, steps: steps.slice(0, -1), warning: null });
  }

  /** The latest fork changed, or gone. */
  private setFork(fork: RecordedFork | null): void {
    this.set({ ...this.state, forks: [...this.state.forks.slice(0, -1), ...(fork ? [fork] : [])], paused: false, warning: null });
  }

  private onClick(event: Event): void {
    const target = event.target as Element | null;
    if (!target || target.closest(OWN_UI) || this.state.paused) return;
    const element = target.closest<HTMLElement>(`[${this.attribute}]`);
    if (!element) {
      this.set({ ...this.state, warning: this.labels.noAnchor });
      return;
    }
    const field = element.matches('input, textarea, select');
    this.add(element.getAttribute(this.attribute)!, field ? 'filled' : 'clicked');
  }

  private onChange(event: Event): void {
    const target = event.target as Element | null;
    if (!target || target.closest(OWN_UI) || this.state.paused) return;
    const element = target.closest<HTMLElement>(`[${this.attribute}]`);
    if (element) this.add(element.getAttribute(this.attribute)!, 'filled');
  }

  private add(anchor: string, kind: 'clicked' | 'filled'): void {
    const steps = this.state.steps;
    const fork = openFork(this.state);
    const from = fork?.paths.at(-1);
    const starting = fork !== null && steps.length === from;
    const last = starting ? steps[fork.choice] : steps.at(-1);
    // Clicking into a field then typing in it is one step, the typing.
    if (last?.anchor === anchor) {
      if (starting || kind !== 'filled' || last.done_when?.kind === 'filled') return;
      this.set({ ...this.state, steps: [...steps.slice(0, -1), { ...last, done_when: { kind: 'filled' } }], warning: null });
      return;
    }
    if (steps.length >= MAX_WALKTHROUGH_STEPS) {
      this.set({ ...this.state, warning: this.labels.full });
      return;
    }
    const earlier = starting ? fork.paths.slice(0, -1).map((at) => steps[at]!.anchor!) : [];
    if (earlier.includes(anchor)) {
      this.set({ ...this.state, warning: this.labels.samePathStart });
      return;
    }
    const route = this.host.routePattern(this.host.url());
    const step: WalkthroughStep = { anchor, title: '', body: '', done_when: { kind }, missing: 'centred' };
    if (fork) step.only_if = starting ? anchor : steps[from!]!.only_if!;
    // Read from the steps themselves, so Undo and carrying on after a reload stay right. The other
    // paths aren't on the way here, and the steps after a fork can't know which page a path ended on.
    const before = fork ? [...steps.slice(0, fork.paths[0]), ...steps.slice(from)] : steps;
    const afterFork = this.state.forks.at(-1)?.end === steps.length;
    if (route && (afterFork || route !== [...before].reverse().find((s) => s.route)?.route)) step.route = route;
    this.set({ ...this.state, steps: [...steps, step], warning: earlier.some((id) => onScreen(id, this.attribute)) ? this.labels.pathsOverlap : null });
  }

  private set(state: RecorderState): void {
    this.state = state;
    this.host.onChange?.(state);
    this.listeners.forEach((listener) => listener(state));
  }
}

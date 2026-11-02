import type { PlayerClasses } from './player.js';
import { openFork, type RecorderState } from './recorder.js';
import type { RecordingSession, RecordingSteps, RecordingView } from './recording-session.js';

export interface RecorderBarLabels {
  /** What a screen reader calls the bar. */
  bar: string;
  ready: string;
  readyHint: string;
  start: string;
  cancel: string;
  recording: string;
  recordingHint: string;
  undo: string;
  finish: string;
  /** Marks the last step as the choice. */
  paths: string;
  pathHint: string;
  nextPath: string;
  /** Between paths: nothing is being captured. */
  paused: string;
  pausedHint: string;
  recordPath: string;
  endPaths: string;
  /** The link stopped working with a recording in this tab. */
  stopped: string;
  stoppedHint: string;
  stoppedEmptyHint: string;
  download: string;
  /** "2 steps" on the bar. */
  steps(count: number): string;
  /** "path 2" on the bar. */
  path(number: number): string;
  /** " as Sam" on the bar, in a tab opened from a recording link. */
  recordingAs(name: string): string;
}

export interface RecorderBarOptions<S = unknown> {
  /** Where the bar goes; `document.body` by default. */
  container?: HTMLElement;
  /** The bar's words, each with a default. */
  labels?: Partial<RecorderBarLabels>;
  /** Design level 2: your own class names, added to ours. The player's `classes` fit as they are. */
  classes?: Pick<PlayerClasses, 'card' | 'primary' | 'secondary'>;
  /** Design level 2: drops our look, keeping only layout. */
  unstyled?: boolean;
  /** Who is recording, shown in a tab opened from a link: every click there really happens as them. */
  who?(): string | null;
  /** Finish in an ordinary tab: the steps, ready for the person's words (empty if they clicked nothing). */
  onFinish?(steps: RecordingSteps): void;
  /** Finish in a tab with a link, once the save has been tried. */
  onSaved?(result: { saved: S } | { error: unknown }): void;
  /** Cancel was pressed: nothing was recorded. */
  onCancel?(): void;
}

const LABELS: RecorderBarLabels = {
  bar: 'Recording a walkthrough',
  ready: 'Ready to record',
  readyHint: 'Go to the page where it begins, then press Start recording.',
  start: 'Start recording',
  cancel: 'Cancel',
  recording: 'Recording',
  recordingHint: 'Click through it as you would. Everything you click really happens.',
  undo: 'Undo last',
  finish: 'Finish',
  paths: 'This has paths',
  pathHint: 'Click through this path. Then press Next path, or End paths if that’s the last.',
  nextPath: 'Next path',
  paused: 'Paused',
  pausedHint: 'Nothing is being recorded. Go back, switch the choice, then press Record path.',
  recordPath: 'Record path',
  endPaths: 'End paths',
  stopped: 'Recording stopped',
  stoppedHint: 'This recording link no longer works, so it can’t be saved here. Download the steps, then upload them in your admin.',
  stoppedEmptyHint: 'This recording link no longer works. Start the recording again from your admin.',
  download: 'Download steps',
  steps: (count) => (count === 1 ? '1 step' : `${count} steps`),
  path: (number) => `path ${number}`,
  recordingAs: (name) => ` as ${name}`,
};

/**
 * The default recording bar, for a product with no bar of its own (level 1 and 2 of the design
 * levels; level 3 is your own bar, drawn from `session.view`). It follows a `RecordingSession`: up
 * while `view.busy`, down otherwise, so recording in the same tab and from a recording link both
 * work, reload and a dead link included. `createFlinders` mounts it for you. Returns a function to
 * remove it; that leaves a recording running, so stop the session too if it is.
 */
export function mountRecorderBar<S = unknown>(session: RecordingSession<S>, options: RecorderBarOptions<S> = {}): () => void {
  const labels = { ...LABELS, ...options.labels };
  const { classes, unstyled } = options;

  const bar = document.createElement('div');
  bar.className = names('flinders-recorder', !unstyled && 'flinders-recorder-styled', classes?.card);
  // Clicks on this bar aren't steps.
  bar.setAttribute('data-flinders-recorder', '');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', labels.bar);
  const text = document.createElement('p');
  text.className = 'flinders-recorder-text';
  text.setAttribute('role', 'status');
  const heading = document.createElement('b');
  const count = document.createElement('span');
  const note = document.createElement('span');
  text.append(heading, count, note);
  const actions = document.createElement('span');
  actions.className = 'flinders-recorder-actions';
  bar.append(text, actions);

  const button = (label: string, primary: boolean, onClick: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = names('flinders-button', primary ? 'flinders-primary' : 'flinders-secondary', primary ? classes?.primary : classes?.secondary);
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  };

  const finish = async () => {
    if (!session.view.fromLink) return options.onFinish?.(session.stop());
    const result = await session.saveDraft();
    if (result) options.onSaved?.(result);
  };
  const cancel = () => {
    session.cancel();
    options.onCancel?.();
  };

  const stageButtons = (stage: string): HTMLButtonElement[] => {
    const undo = () => button(labels.undo, false, () => session.undo());
    const end = () => button(labels.endPaths, false, () => session.endPaths());
    const done = (primary: boolean) => button(labels.finish, primary, () => void finish());
    switch (stage) {
      case 'ready':
        return [
          button(labels.cancel, false, cancel),
          button(labels.start, true, () => {
            session.start();
            // The button pressed has gone: focus stays on the bar, not lost to the page.
            actions.querySelector<HTMLElement>('.flinders-primary')?.focus({ preventScroll: true });
          }),
        ];
      case 'stranded':
        return [button(labels.cancel, false, cancel), button(labels.download, true, () => session.downloadSteps())];
      case 'stranded-empty':
        return [button(labels.cancel, true, cancel)];
      case 'paused':
        return [undo(), end(), done(false), button(labels.recordPath, true, () => session.recordPath())];
      case 'path':
        return [undo(), button(labels.nextPath, false, () => session.nextPath()), end(), done(true)];
      default:
        return [undo(), button(labels.paths, false, () => session.startPaths()), done(true)];
    }
  };

  // Redrawn only when the buttons change, so the one pressed keeps its focus. When it has gone,
  // focus moves to the bar's main button, never lost to the page.
  let drawn = '';
  const showButtons = (stage: string) => {
    if (stage === drawn) return;
    drawn = stage;
    const hadFocus = actions.contains(document.activeElement);
    actions.replaceChildren(...stageButtons(stage));
    if (hadFocus) actions.querySelector<HTMLElement>('.flinders-primary')?.focus({ preventScroll: true });
  };

  const say = (title: string, counted: string, words: string, warning: boolean) => {
    heading.textContent = title;
    count.textContent = counted;
    note.textContent = words;
    note.className = warning ? 'flinders-recorder-warning' : 'flinders-recorder-hint';
  };

  const stepsAndPath = (state: RecorderState) => {
    const fork = openFork(state);
    return ` · ${labels.steps(state.steps.length)}${fork ? ` · ${labels.path(fork.paths.length)}` : ''}`;
  };

  const draw = (view: RecordingView) => {
    if (!view.busy) {
      drawn = '';
      bar.remove();
      return;
    }
    const name = view.fromLink ? options.who?.() : null;
    const as = name ? labels.recordingAs(name) : '';
    const state = view.recorder;
    if (view.stranded) {
      say(labels.stopped, ` · ${labels.steps(view.stranded.length)}`, view.stranded.length ? labels.stoppedHint : labels.stoppedEmptyHint, true);
      showButtons(view.stranded.length ? 'stranded' : 'stranded-empty');
    } else if (view.ready) {
      say(`${labels.ready}${as}`, '', labels.readyHint, false);
      showButtons('ready');
    } else {
      const fork = openFork(state);
      say(`${state.paused ? labels.paused : labels.recording}${as}`, stepsAndPath(state), state.warning ?? (state.paused ? labels.pausedHint : fork ? labels.pathHint : labels.recordingHint), !!state.warning);
      showButtons(state.paused ? 'paused' : fork ? 'path' : 'steps');
    }
    if (!bar.isConnected) (options.container ?? document.body).append(bar);
  };

  const stopListening = session.subscribe(draw);
  draw(session.view);
  return () => {
    stopListening();
    bar.remove();
  };
}

const names = (...list: (string | false | undefined)[]) => list.filter(Boolean).join(' ');

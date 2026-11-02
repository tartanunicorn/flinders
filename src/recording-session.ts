import { recordingFile } from './editor.js';
import { Recorder, type RecorderState } from './recorder.js';
import { RecordingTab } from './recording-tab.js';
import { downloadJson } from './admin.js';

/** A link with less than this left is renewed the next time a step is added. */
const RENEW_WITHIN_MS = 10 * 60 * 1000;

export type RecordingSteps = RecorderState['steps'];

/** Your API's answer about a link. A good one comes with a fresh link and when it runs out. */
export interface RecordingLinkAnswer {
  valid: boolean;
  reason?: 'invalid' | 'expired' | 'not_allowed';
  link?: string;
  expires_at?: string;
}

/** Your API's answer to Finish. `linkRefused` = the link is what's wrong, so saving again won't help. */
export type RecordingSaveAnswer<S> = { saved: S } | { error: unknown; linkRefused: boolean };

/** What a recording session needs from the product it runs in. */
export interface RecordingSessionHost<S> {
  url(): string;
  /** `/projects/123` → `/projects/:projectId`, from the product's own routes. */
  routePattern(url: string): string | null;
  /** Asks your API about a recording link. Null = no answer; the tab keeps the link. Throwing = the API is away. Without it, a link is never used. */
  checkLink?(link: string): Promise<RecordingLinkAnswer | null>;
  /** Saves a link's recording as a draft. Without it, a link is never used. */
  saveDraft?(link: string, steps: RecordingSteps): Promise<RecordingSaveAnswer<S>>;
  /** False = the recording tab stays open after Finish, rather than closing back to the tab that opened it. */
  jumpBack?: boolean;
  /** Called whenever the view changes, so a product can keep it in its own state. */
  onChange?(view: RecordingView): void;
  /** The attribute that holds a step's anchor; `data-testid` by default. */
  anchorAttribute?: string;
}

/** What a recording bar draws from. */
export interface RecordingView {
  recorder: RecorderState;
  /** The bar is up and the person is finding where to begin: nothing is captured yet. */
  ready: boolean;
  /** The link stopped working with a recording in this tab: its steps can only be downloaded now. */
  stranded: RecordingSteps | null;
  /** This tab was opened with a valid recording link. */
  fromLink: boolean;
  /** Getting ready or recording: walkthroughs aren't offered. */
  busy: boolean;
}

/**
 * One recording, with no framework: the `Recorder`, the bar's stages, and a tab holding a recording
 * link (`RecordingTab`), whose steps are kept in the tab and whose clock is kept running while the
 * person works. `getReady()` only puts the bar up: the person goes where it begins, then `start()`.
 */
export class RecordingSession<S = unknown> {
  private readonly listeners = new Set<(view: RecordingView) => void>();
  private readonly tab = new RecordingTab();
  private state: RecorderState = { recording: false, steps: [], warning: null, forks: [], paused: false };
  private ready = false;
  private stranded: RecordingSteps | null = null;
  private fromLink = false;
  private saving = false;
  private renewing = false;
  private expiresAt: string | undefined;

  private readonly recorder: Recorder;

  constructor(private readonly host: RecordingSessionHost<S>) {
    this.recorder = new Recorder({
      url: () => host.url(),
      routePattern: (url) => host.routePattern(url),
      ...(host.anchorAttribute ? { anchorAttribute: host.anchorAttribute } : {}),
      onChange: (state) => {
        this.state = state;
        this.changed();
        if (this.fromLink && state.recording) {
          this.tab.saveSteps(state.steps, state);
          // Extended on use: a long recording never runs out while the person is working.
          if (this.expiresAt && Date.parse(this.expiresAt) - Date.now() < RENEW_WITHIN_MS) void this.renew();
        }
      },
    });
  }

  get view(): RecordingView {
    return {
      recorder: this.state,
      ready: this.ready,
      stranded: this.stranded,
      fromLink: this.fromLink,
      busy: this.ready || this.state.recording || this.stranded !== null,
    };
  }

  /** Tells a listener of every change, as `onChange` does; returns how to stop listening. */
  subscribe(listener: (view: RecordingView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const view = this.view;
    this.host.onChange?.(view);
    this.listeners.forEach((listener) => listener(view));
  }

  /**
   * Call once someone is signed in. A normal tab holds no link, so nothing happens and nothing is
   * sent. A tab with a valid link puts the bar up, carrying on if it was recording before a reload.
   * A bad link says why (the tab goes back to normal), unless it holds steps: the bar then offers
   * them. If the check can't be made, the tab keeps the link.
   */
  async resumeFromLink(): Promise<{ reason: 'invalid' | 'expired' | 'not_allowed' | null }> {
    const link = this.tab.link;
    if (!link || !this.host.checkLink) return { reason: null };
    const steps = this.tab.steps;
    try {
      const data = await this.host.checkLink(link);
      if (!data) return { reason: null };
      if (!data.valid) {
        if (steps?.length) {
          this.strand(steps);
          return { reason: null };
        }
        this.tab.end();
        return { reason: data.reason ?? 'invalid' };
      }
      this.use(data);
    } catch {
      return { reason: null };
    }
    this.fromLink = true;
    this.changed();
    if (steps) this.recorder.start(steps, this.tab.progress);
    else this.setReady(true);
    return { reason: null };
  }

  /** Asks for more time: each check hands back a fresh link. One that's no longer good ends the recording here. */
  private async renew(): Promise<void> {
    const link = this.tab.link;
    if (!link || this.renewing || !this.host.checkLink) return;
    this.renewing = true;
    try {
      const data = await this.host.checkLink(link);
      if (!data || !this.fromLink) return;
      if (data.valid) this.use(data);
      else this.strand(this.recorder.stop());
    } catch {
      /* The API is away: the save at the end will say if the link has gone. */
    } finally {
      this.renewing = false;
    }
  }

  private use(check: { link?: string; expires_at?: string }): void {
    if (check.link) this.tab.renew(check.link);
    this.expiresAt = check.expires_at;
  }

  private strand(steps: RecordingSteps): void {
    this.fromLink = true;
    this.ready = false;
    this.stranded = steps;
    this.changed();
  }

  private setReady(ready: boolean): void {
    this.ready = ready;
    this.changed();
  }

  /** The stranded steps as a walkthrough file, to upload in the admin. */
  downloadSteps(): void {
    const steps = this.stranded;
    if (!steps?.length) return;
    downloadJson('recorded-walkthrough.json', recordingFile(steps));
  }

  /**
   * Finish in a tab with a link: saves the steps as a draft, at most once. If that fails they stay
   * on the bar, to try again; if the link is what's wrong, to download. With nothing recorded, it
   * goes back to ready. Null = nothing was tried. A failure is `{ error }`, to word as you like.
   */
  async saveDraft(): Promise<{ saved: S } | { error: unknown } | null> {
    if (this.saving) return null;
    const link = this.tab.link;
    const steps = this.recorder.stop();
    if (!link || !steps.length || !this.host.saveDraft) {
      this.setReady(true);
      return null;
    }
    this.saving = true;
    try {
      const answer = await this.host.saveDraft(link, steps);
      if ('saved' in answer) {
        this.tab.finish();
        this.fromLink = false;
        this.changed();
        if (this.host.jumpBack !== false) this.tab.close();
        return { saved: answer.saved };
      }
      if (answer.linkRefused) this.strand(steps);
      else this.recorder.start(steps, this.state);
      return { error: answer.error };
    } catch (error) {
      this.recorder.start(steps, this.state);
      return { error };
    } finally {
      this.saving = false;
    }
  }

  /** Puts the bar up, so the person can go where the walkthrough begins. */
  getReady(): void {
    this.setReady(true);
  }

  /** Captures clicks from here on. */
  start(): void {
    this.setReady(false);
    this.recorder.start();
    // The link's clock runs from here, not from when the admin made it.
    if (this.fromLink) void this.renew();
  }

  /** Takes the bar down without recording anything. */
  cancel(): void {
    this.ready = false;
    this.stranded = null;
    this.tab.end();
    this.fromLink = false;
    this.changed();
  }

  undo(): void {
    this.recorder.undo();
  }

  startPaths(): void {
    this.recorder.startPaths();
  }

  nextPath(): void {
    this.recorder.nextPath();
  }

  recordPath(): void {
    this.recorder.recordPath();
  }

  endPaths(): void {
    this.recorder.endPaths();
  }

  stop(): RecordingSteps {
    return this.recorder.stop();
  }
}

import type { RecorderProgress } from './recorder.js';
import type { WalkthroughStep } from './types.js';

/** The query parameter a recording link arrives in. */
export const RECORDING_LINK_PARAM = 'flinders_record';

const STORAGE_KEY = 'flinders-recording';

/** What a recording tab needs from the browser; a test can pass its own. */
export interface RecordingTabOptions {
  /** The query parameter to read; `flinders_record` by default. */
  param?: string;
  /** The `sessionStorage` key to keep it under. */
  storageKey?: string;
  window?: Pick<Window, 'location' | 'history' | 'sessionStorage'> & Partial<Pick<Window, 'close'>>;
}

interface Kept {
  link: string;
  /** Null until recording starts. */
  steps: WalkthroughStep[] | null;
  /** Which of those steps are paths, and where the recording had got to. */
  progress?: RecorderProgress;
  /** The link as it arrived: `link` changes as it's renewed, and this is what a used link is known by. */
  first: string;
}

/**
 * The browser's half of recording when admin and the app are on different sites. Create one before
 * the app's router reads the URL: it takes the recording link out of the address bar and keeps it
 * in this tab's `sessionStorage`, so moves, reloads and a sign-in page all keep it, and no other tab
 * has it. Without a link, `active` is false and nothing else happens. Holding a link proves
 * nothing: ask your API whether it is valid before showing anything.
 */
export class RecordingTab {
  private readonly win: NonNullable<RecordingTabOptions['window']>;
  private readonly key: string;
  private readonly usedKey: string;
  private kept: Kept | null;

  constructor(options: RecordingTabOptions = {}) {
    this.win = options.window ?? window;
    this.key = options.storageKey ?? STORAGE_KEY;
    this.usedKey = `${this.key}-used`;
    this.kept = this.load();
    const url = new URL(this.win.location.href);
    const param = options.param ?? RECORDING_LINK_PARAM;
    // After the `#`, where browsers don't send it; a query still works, and leaves the URL just the same.
    const inHash = new RegExp(`^#(.*&)?${param}=([^&]*)(&(.*))?$`).exec(url.hash);
    const link = inHash?.[2] ?? url.searchParams.get(param);
    if (link === null) return;
    url.searchParams.delete(param);
    if (inHash) url.hash = [inHash[1]?.slice(0, -1), inHash[4]].filter(Boolean).join('&');
    this.win.history.replaceState(this.win.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (link && link !== this.used()) this.keep({ link, steps: null, first: link });
  }

  /** Whether this tab was opened with a recording link. */
  get active(): boolean {
    return this.kept !== null;
  }

  get link(): string | null {
    return this.kept?.link ?? null;
  }

  /** The steps so far, to carry on after a reload; null when recording hasn't started. */
  get steps(): WalkthroughStep[] | null {
    return this.kept?.steps ?? null;
  }

  /** Where the paths had got to, to carry on after a reload. */
  get progress(): RecorderProgress | undefined {
    return this.kept?.progress;
  }

  /** A renewed link takes over from the old one. */
  renew(link: string): void {
    if (this.kept) this.keep({ ...this.kept, link });
  }

  /** Keeps the steps so far. They hold element ids and pages, never anything typed. */
  saveSteps(steps: WalkthroughStep[], progress?: RecorderProgress): void {
    if (this.kept) this.keep({ ...this.kept, steps, ...(progress ? { progress: { forks: progress.forks, paused: progress.paused } } : {}) });
  }

  /** A draft was saved: a normal tab again, and this link can't save another here. */
  finish(): void {
    if (this.kept) {
      try {
        this.win.sessionStorage.setItem(this.usedKey, this.kept.first);
      } catch {
        // Storage is blocked: nothing survives a reload here, the link included.
      }
    }
    this.end();
  }

  /**
   * Back to the tab it was opened from. Browsers only close a tab a page opened, so one reached any
   * other way just stays, with the bar's saved message.
   */
  close(): void {
    this.win.close?.();
  }

  /** Cancelled, or the link is no good: this is a normal tab again. */
  end(): void {
    this.kept = null;
    try {
      this.win.sessionStorage.removeItem(this.key);
    } catch {
      // Storage is blocked: nothing was kept.
    }
  }

  private keep(kept: Kept): void {
    this.kept = kept;
    try {
      this.win.sessionStorage.setItem(this.key, JSON.stringify(kept));
    } catch {
      // Storage is blocked: the link lasts until this page reloads.
    }
  }

  private used(): string | null {
    try {
      return this.win.sessionStorage.getItem(this.usedKey);
    } catch {
      return null;
    }
  }

  private load(): Kept | null {
    try {
      const raw = this.win.sessionStorage.getItem(this.key);
      const kept = raw ? (JSON.parse(raw) as Partial<Kept>) : null;
      return typeof kept?.link === 'string' ? { link: kept.link, steps: Array.isArray(kept.steps) ? kept.steps : null, first: kept.first ?? kept.link, ...(kept.progress ? { progress: kept.progress } : {}) } : null;
    } catch {
      return null;
    }
  }
}

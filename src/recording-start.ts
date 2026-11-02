/**
 * The admin's half of recording when admin and the app are on different sites: opening the app in a
 * new tab, and spotting the draft when the person comes back. The words and what happens next are
 * the product's own.
 */

/** `here` = the link is for this site, so no tab opened. `tab` = it opened. `blocked` = the browser stopped it. */
export type RecordingStart = 'here' | 'tab' | 'blocked';

/** Opens a recording link's `url` in a new tab with nothing tying it to this one, unless it's this same site. */
export function startRecording(url: string): RecordingStart {
  const address = new URL(url, location.href);
  if (address.origin === location.origin) return 'here';
  // It came from your API, but a `javascript:` address must never open, whoever sent it.
  if (address.protocol !== 'https:' && address.protocol !== 'http:') return 'blocked';
  const tab = window.open(url, '_blank');
  if (!tab) return 'blocked';
  tab.opener = null;
  return 'tab';
}

export interface WatchForRecordingOptions<T extends { walkthrough_id: string }> {
  /** The admin list as it stood before recording: a row that isn't in it is the new draft. */
  known: readonly T[];
  /** The admin list now, fresh from the API. Throwing = look again next time. */
  list(): Promise<readonly T[]>;
  /** The draft has arrived. Watching has already stopped. */
  onDraft(draft: T): void | Promise<void>;
}

/**
 * Looks for the new draft each time the person comes back to this tab, until it arrives. Returns how
 * to stop sooner: call it when the page goes away or a new recording starts.
 */
export function watchForRecording<T extends { walkthrough_id: string }>(options: WatchForRecordingOptions<T>): () => void {
  const known = new Set(options.known.map((w) => w.walkthrough_id));
  let stopped = false;
  let looking = false;

  const look = async () => {
    if (stopped || looking || document.visibilityState !== 'visible') return;
    looking = true;
    let list: readonly T[];
    try {
      list = await options.list();
    } catch {
      return;
    } finally {
      looking = false;
    }
    const draft = list.find((w) => !known.has(w.walkthrough_id));
    if (!draft || stopped) return;
    stop();
    await options.onDraft(draft);
  };
  const onFocus = () => void look();
  const stop = () => {
    stopped = true;
    window.removeEventListener('focus', onFocus);
  };

  window.addEventListener('focus', onFocus);
  return stop;
}

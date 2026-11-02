/** The most steps a walkthrough can hold. */
export const MAX_WALKTHROUGH_STEPS = 30;

/** The most articles a walkthrough, or one step, can name. */
export const MAX_ARTICLE_HINTS = 5;

/** One step of a walkthrough: the same shape in the file, the database and the player. */
export interface WalkthroughStep {
  /** The element's `data-testid`; null = a centred card with nothing highlighted. */
  anchor: string | null;
  /** Route pattern the step is on (`/projects/:projectId/settings`). Absent = wherever the last step was. */
  route?: string;
  title: string;
  /** Plain text; `**bold**` is the only mark-up. */
  body: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** appear = wait while the page is still loading (until it settles, at most 4 s); person = wait as long as it takes for the person to act. */
  wait_for?: 'appear' | 'person';
  /** The person clicks the real control to go on. A step never clicks for them. */
  advance_on_click?: boolean;
  /** In a guide walkthrough, the step moves on when this happens, and Next is hidden. Ignored in show. */
  done_when?: DoneWhen;
  /** What's highlighted can be used, and the person still presses Next. `done_when` wins if a file has both. */
  optional?: boolean;
  /** On a step with `done_when`: seconds before the card offers "Can't find it?". 3 by default. */
  help_after?: number;
  /** Things that stop a person doing this step: when one shows, the card says this instead, and Next stays. */
  blocked?: { anchor: string; title?: string; body: string }[];
  /** A fork: the step applies only while this element, or any of these, is on screen. Otherwise it is skipped, in the direction of travel. */
  only_if?: string | string[];
  /** Phones and touch screens: different element or copy, or skip the step. */
  phone?: 'skip' | { anchor?: string | null; title?: string; body?: string; side?: 'top' | 'bottom' | 'left' | 'right' };
  /** The articles most relevant to this step: a url, an id or a slug. Flinders only passes them to the product's chat. */
  articles?: string[];
  /** When the element isn't there: another element (with its own copy), a centred card, or end. */
  missing: 'centred' | 'end' | { alt?: string; body?: string };
}

/** show = the person reads and presses Next; guide = they do the real thing on the real screen. */
export type WalkthroughMode = 'show' | 'guide';

/** What finishes a guide step: the step's element clicked, filled or chosen, another element showing, or a page reached. */
export type DoneWhen =
  | { kind: 'clicked' | 'filled' | 'chosen' }
  | { kind: 'appears'; anchor: string }
  | { kind: 'route'; route: string };

/** How a person left a step: Next, Back, by doing it, or past it with "Can't find it?". */
export type StepHow = 'next' | 'back' | 'done' | 'skipped';

export type WalkthroughStatus = 'draft' | 'live' | 'inactive';
export type ProgressStatus = 'started' | 'paused' | 'completed' | 'dismissed';
/** Where a walkthrough was started from (recorded with its events). */
export type WalkthroughFrom = 'offer' | 'article' | 'checklist' | 'chat' | 'list' | 'dev';

/** The words around a walkthrough. A product can change any of them. */
export interface WalkthroughLabels {
  /** The button that starts a Show me. */
  show: string;
  /** The button that starts a Guide me. */
  guide: string;
  /** The card's title when `showMe` is given none. */
  showMeTitle: string;
  /** Said when what an answer points at can't be found. */
  notOnThisPage: string;
  /** The warning before going to another page, with its buttons. */
  onAnotherPage: string;
  stay: string;
  go: string;
  /** Added when `hasUnsavedWork` says so. */
  mayLoseWork: string;
  /** Added when the page needs an id this one doesn't give, so there is no Go. */
  openItFirst: string;
  /** The line on an offer. */
  offerMessage: string;
  notNow: string;
  /** On Not now: how to get it back, or turn these off. Only a product knows where its switch is. */
  offerHint?: string;
  /** Said when the player didn't load (offline, or a new version of the app was deployed). */
  couldNotStart: string;
  /** Said when a recording link won't do: a tab opened with one that's run out, or someone else's. */
  linkExpired: string;
  linkNotAllowed: string;
  linkInvalid: string;
  /** Said when the browser stopped the recording tab opening. */
  allowPopups: string;
  /** Said when a recording couldn't start, or has been saved, or couldn't be. */
  recordingRefused: string;
  recordingSaved: string;
  recordingNotSaved: string;
}

export const WALKTHROUGH_LABELS: WalkthroughLabels = {
  show: 'Show me',
  guide: 'Guide me',
  showMeTitle: 'It’s here',
  notOnThisPage: 'This isn’t on this page.',
  onAnotherPage: 'This is on another page.',
  stay: 'Stay',
  go: 'Go',
  mayLoseWork: 'Going there may lose what you haven’t saved.',
  openItFirst: 'Open what it belongs to first, then try again.',
  offerMessage: 'A short walkthrough of this page.',
  notNow: 'Not now',
  couldNotStart: 'The walkthrough couldn’t load. Reload the page and try again.',
  linkExpired: 'That recording link has expired. Start the recording again.',
  linkNotAllowed: 'That recording link only works for the person who made it.',
  linkInvalid: 'That recording link doesn’t work. Start the recording again.',
  allowPopups: 'Your browser stopped the new tab. Allow pop-ups for this site, then try again.',
  recordingRefused: 'Recording couldn’t start. Try again.',
  recordingSaved: 'Saved as a draft.',
  recordingNotSaved: 'The recording wasn’t saved. Try again.',
};

/** A walkthrough people can be shown: its served version. */
export interface Walkthrough {
  walkthrough_id: string;
  /** Its identity for people and files, the same on every version. */
  number: number;
  /** `<number>-<slug>`: how it is named and found (by the number). */
  handle: string;
  version: number;
  slug: string;
  title: string;
  mode: WalkthroughMode;
  permission: string | null;
  offer_on: string | null;
  /** The version a person must have seen not to be offered it again. */
  reoffer_from: number;
  article_slug: string | null;
  /** The articles most relevant to it, as written in the file. A server older than this leaves it out. */
  articles?: string[];
  steps: WalkthroughStep[];
}

/** What a person did with one walkthrough. */
export interface WalkthroughProgress {
  /** The version they saw. */
  v: number;
  status: ProgressStatus;
  step: number;
  at: string;
}

export interface SavedVersion {
  walkthrough_id: string;
  number: number;
  /** `<number>-<slug>` of the version saved. */
  handle: string;
  version: number;
  status: WalkthroughStatus;
  /** False when `skipIfSame` found the newest version already the same (nothing saved). */
  saved: boolean;
}

export interface AdminWalkthrough {
  walkthrough_id: string;
  number: number;
  /** `<number>-<slug>` of its newest version. */
  handle: string;
  slug: string;
  title: string;
  mode: WalkthroughMode;
  latest_version: number;
  latest_status: WalkthroughStatus;
  /** The version people get, or null when none is live. */
  live_version: number | null;
  article_slug: string | null;
  article_title: string | null;
  permission: string | null;
  offer_on: string | null;
  reoffer_from: number;
  steps_count: number;
  updated_at: string;
  updated_by: string | null;
  /** What is wrong with the live version in this build. Non-empty = Needs update. */
  problems: string[];
}

export interface AdminWalkthroughVersion {
  version: number;
  status: WalkthroughStatus;
  slug: string;
  title: string;
  mode: WalkthroughMode;
  article_slug: string | null;
  articles?: string[];
  permission: string | null;
  offer_on: string | null;
  reoffer_from: number;
  steps: unknown;
  created_at: string;
  created_by: string | null;
  /** What is wrong with this version in this build (empty = fine). */
  problems: string[];
}

/** How far people got. `reached[2]` = how many got as far as the third step. */
export interface WalkthroughStats {
  people: number;
  finished: number;
  reached: number[];
  /** Steps people did themselves, across everyone (guide). */
  actions_done: number;
}

export interface AdminWalkthroughDetail {
  walkthrough_id: string;
  number: number;
  /** `<number>-<slug>` of its newest version. */
  handle: string;
  versions: AdminWalkthroughVersion[];
  stats: WalkthroughStats;
}

import type { Driver, PopoverDOM } from 'driver.js';

import type { WalkthroughContext } from './context.js';
import { forkAround, pathAround, samePath, stepPlaces } from './paths.js';
import { buildRoute, matchRoute, paramsFromUrl, type ReservedParams } from './routes.js';
import type { DoneWhen, StepHow, WalkthroughMode, WalkthroughStep } from './types.js';

export { buildRoute, matchRoute, paramsFromUrl };
export type { ReservedParams };

/** What the player needs from the product it runs in. */
export interface PlayerHost {
  /** The current URL (path and query). */
  url(): string;
  /** Goes to a URL; false when it couldn't. */
  navigate(url: string): Promise<boolean>;
  /** Called after each navigation; returns how to stop listening. */
  onNavigated(listener: (url: string) => void): () => void;
  /** Called whenever the walkthrough on screen changes (null = none). */
  onActive?(active: ActiveWalkthrough | null): void;
  /** Opens the product's chat about this step. Without it, the card has no "Ask about this". The walkthrough holds; call `hold(false)` when the chat closes. */
  askAbout?(context: WalkthroughContext): void;
  /** `/projects/123` to `/projects/:projectId`, for a context on a step with no route of its own. */
  routePattern?(url: string): string | null;
  /** The card's words, each with a default. */
  labels?: Partial<PlayerLabels>;
  /** Design level 2: your own class names, added to ours. */
  classes?: PlayerClasses;
  /** Design level 2: drops our look, keeping only layout. */
  unstyled?: boolean;
  /**
   * Design level 3: draw the card yourself. Driver.js still dims the page and places it. Return a
   * function to clear up, if you need one.
   */
  renderCard?: (container: HTMLElement, card: PlayerCard) => void | (() => void);
  /** What marks things on your page, where they differ from the defaults. */
  markers?: Partial<PlayerMarkers>;
  /** The attribute that holds a step's anchor; `data-testid` by default. */
  anchorAttribute?: string;
  /** The switch to the phone layout; COMPACT_QUERY by default. */
  compactQuery?: string;
  /** Values a `:param` must never capture, so a route never matches a page that reserves them (`{ templateId: ['company-style'] }`). */
  reservedParams?: ReservedParams;
  /**
   * Called as a walkthrough starts, before its first page opens or its first card is drawn (not for
   * `showMe` and `confirm` cards). `createFlinders` uses it to take down an offer it has overtaken.
   */
  onStart?(walkthrough: PlayableWalkthrough): void;
  /**
   * "Can't find it?" on a step the person has to do. `'skip'` (the default): the link skips the step.
   * `'help'`: it says what's missing (the step's `missing.body` when it has one) and offers a
   * labelled Skip this step. `false`: never shown.
   */
  cantFind?: false | 'skip' | 'help';
  /**
   * On (the default): a card drawn without its element (a list still loading) keeps looking, and
   * points at the element as soon as it appears. False: it stays as drawn.
   */
  lateElements?: boolean;
  /** On (the default): after Next or Back, while the next step's page or element is on its way, the card says "Looking for …" and its buttons wait. */
  lookingNote?: boolean;
  /** A numbered anchor (`row-3`) that isn't on the page falls back to a visible one with the same base name (`row-1`, `row`). Off by default. */
  lookAlike?: boolean;
  /** A new card waits, hidden, until its element has stopped moving (the page is still laying out): still for 300 ms, at most 3 s. Off by default. */
  settle?: boolean;
}

export interface PlayerLabels {
  next: string;
  back: string;
  done: string;
  finishLater: string;
  learnMore: string;
  askAbout: string;
  waiting: string;
  cantFind: string;
  /** "Can't find it?" in `'help'` mode: what the card says instead of the step's words. */
  cantSee(title: string): string;
  /** The button that skips a step, in `'help'` mode. */
  skipStep: string;
  /** On the card while the next step's page or element is on its way. */
  looking(title: string): string;
  /** Added to the words of an optional step. */
  optional: string;
  /** "2 of 5" on the card. */
  progress(step: number, total: number): string;
  /** What a screen reader hears at each step. */
  announce(step: number, total: number, title: string): string;
}

export interface PlayerClasses {
  card?: string;
  primary?: string;
  secondary?: string;
  link?: string;
}

/** Everything needed to draw the card: what to show, and what its buttons call. */
export interface PlayerCard {
  title: string;
  /** Plain text with `**bold**`. */
  body: string;
  /** The same, as safe HTML. */
  bodyHtml: string;
  step: number;
  total: number;
  /** "2 of 5". */
  progress: string;
  canGoBack: boolean;
  /** False on a Do step: the person's own action moves it on. */
  showNext: boolean;
  nextLabel: string;
  /** A warning's Stay. A walkthrough's Back has its word in `labels`. */
  backLabel?: string;
  /** On the last step of a walkthrough with an article: ends it and opens the article. */
  learnMore?: () => void;
  learnMoreLabel?: string;
  /** Only when the product has a chat to open. */
  askAbout?: () => void;
  askAboutLabel?: string;
  next(): void;
  back(): void;
  finishLater(): void;
}

export interface PlayerMarkers {
  /** Sticky or fixed bars the card and highlight must clear. */
  bar: string;
  /** A pop-out's title bar and action bar, inside `dialog`. */
  barHeader: string;
  barActions: string;
  /** A phone's bottom bar. */
  bottomBar: string;
}

const MARKERS: PlayerMarkers = { bar: '[data-flinders-bar]', barHeader: '[data-flinders-bar="header"]', barActions: '[data-flinders-bar="actions"]', bottomBar: '[data-flinders-bottom-bar]' };

const LABELS: PlayerLabels = { next: 'Next', back: 'Back', done: 'Done', finishLater: 'Finish later', learnMore: 'Learn more', askAbout: 'Ask about this', waiting: 'Waiting…', cantFind: 'Can’t find it?', cantSee: (title) => `We can’t see “${title}” on this page.`, skipStep: 'Skip this step', looking: (title) => `Looking for “${title}”…`, optional: 'You can try it, then press Next.', progress: (step, total) => `${step} of ${total}`, announce: (step, total, title) => `Step ${step} of ${total}: ${title}` };

export interface PlayableWalkthrough {
  /** The walkthrough's original id (the same for every version). */
  id: string;
  version: number;
  title: string;
  /** show (the default) or guide. */
  mode?: WalkthroughMode;
  steps: WalkthroughStep[];
  /** The articles most relevant to it, after the step's own in `context()`. */
  articles?: string[];
  /** Opens the walkthrough's article; adds "Learn more" on the last step. The walkthrough ends first, then this runs. */
  learnMore?: () => void;
  /** One card on the spot (`showMe`, `confirm`): its own buttons, no count, no chat, no context. @internal */
  spot?: { next?: string; back?: string };
}

/** started · paused (✕ Finish later, Esc, or the person went elsewhere) · completed (Done). */
export type PlayerEvent = 'started' | 'paused' | 'completed' | 'dismissed';

/** left = the person went to a page the walkthrough isn't on, so it may want to offer a way back. */
export type PlayerStopReason = 'left';

export interface PlayerStartOptions {
  /** Pick up where the person left off. */
  startAt?: number;
  /** The ids the walkthrough's routes need (`projectId`, …): a run's own, to carry on where it was left. */
  startParams?: Record<string, string>;
  /** Told about every start, pause and finish, so the app can save progress. With `left`, the run's ids, for `startParams`. */
  onEvent?: (event: PlayerEvent, step: number, reason?: PlayerStopReason, params?: Record<string, string>) => void;
  /**
   * Told about every move, once it lands: the step they reached and how they left the one before.
   * A step skipped on the way is never reported. The last step, done, reports itself.
   */
  onStep?: (step: number, how: StepHow) => void;
}

export interface ActiveWalkthrough {
  id: string;
  title: string;
  step: number;
  total: number;
}

/** Phones and touch screens: where `forScreen` uses a step's phone copy. */
export const COMPACT_QUERY = '(pointer: coarse), (max-width: 479.98px)';
/** A card on the spot: never saved, and never a walkthrough anyone can look up. */
const SPOT_ID = 'flinders-spot';
/** Longest wait for an element while the page is still loading (it usually settles far sooner). */
const APPEAR_WAIT_MS = 4000;
/** No change on the page for this long = it has finished drawing; a missing element isn't coming. */
const SETTLED_MS = 400;
/** A guide step offers a way on after this many seconds, unless the step says otherwise. */
const HELP_AFTER_SECONDS = 3;
/** What moves on a step with `advance_on_click`. */
const CLICKED: DoneWhen = { kind: 'clicked' };
/** How often a guide step looks to see whether it's done. */
const DONE_POLL_MS = 200;
/** How often a card drawn without its element looks again, besides watching the page change. */
const LATE_POLL_MS = 250;
/** `settle`: an element still for this long has finished moving. */
const STILL_MS = 300;
/** `settle`: the longest a new card waits for its element to stop moving. */
const STILL_MAX_MS = 3000;
/** The narrowest a card docked beside a pop-out may get before it goes above, below or inside instead. */
const MIN_DOCKED_WIDTH = 240;
/** Between a docked card and the pop-out or element it clears. */
const DOCK_GAP = 12;
/** The closest a docked card comes to the window's edge or a pop-out's bars. */
const DOCK_MARGIN = 8;
/** The highlight's ring reaches this far outside the element (stagePadding, and its outline). */
const RING = 8;
/** What the person may need in a pop-out, so a docked card keeps off it. */
const PANEL_CONTROLS = 'button, input, select, textarea, a[href], [role="button"]';
/** What can hold a person's answer. */
const FIELDS = 'input:not([type="search"]), textarea, select';
/** A list opened from the step's element: part of what the card mustn't cover. */
const OPEN_LISTS = '[role="group"], [role="listbox"], [role="menu"]';

/** A box on screen: a DOMRect fits. @internal */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** @internal */
export interface DockLayout {
  /** The card's size. */
  card: { width: number; height: number };
  /** What the step is about. */
  element: Rect;
  panel: Rect;
  /** The pop-out's buttons, fields and links. */
  controls: Rect[];
  /** The pop-out's title bar and action bar, when it has them. */
  head?: Rect;
  foot?: Rect;
  viewport: { width: number; height: number };
}

/** @internal */
export interface DockSpot {
  spot: 'above' | 'below' | 'inside-top' | 'inside-bottom' | 'above-element' | 'below-element';
  left: number;
  top: number;
}

interface Run {
  walkthrough: PlayableWalkthrough;
  opts: PlayerStartOptions;
  driver: Driver;
  index: number;
  /** The line from a card placed away from its element back to it. */
  leader: SVGSVGElement | null;
  /** Places the card again (and its line) while a step is docked. */
  refit: (() => void) | null;
  /** The product's chat is open: the card waits hidden, on this step, until `hold(false)`. */
  held: boolean;
  /** The steps done so far, by position. */
  done: Set<number>;
  /** What the card says now, for `context()`. */
  /** Steps shown on this run and not gone back past: which path of a fork the person is on. */
  seen: Set<number>;
  shown: { title: string; body: string; element: string | null };
  /** Picking up part-way: the step's element may be in a pop-out that's no longer open. */
  resuming: boolean;
  /** Bumped on every move, so a step still waiting for its element knows it has been overtaken. */
  token: number;
  /** Route params seen so far (`projectId`, …), to build the next step's URL. */
  params: Record<string, string>;
  /** How the move under way began, until it lands on a step (or the walkthrough ends first). */
  how: StepHow | null;
  /** The route pattern the run is on (a step without a route stays where the last one was), or the path it started on. */
  place: string;
  /** Set while the service itself navigates, so its own navigation never pauses the walkthrough. */
  navigating: boolean;
  /** The person has just done this Do step's click: the page that click opens isn't them leaving. */
  acting: boolean;
  popover: PopoverDOM | null;
  /** "Can't find it?" is due on this step; the card adds it as soon as it's drawn. */
  wayOn: boolean;
  /** "Can't find it?" was pressed in `'help'` mode: the card says what's missing, and redraws keep it. */
  helping: boolean;
  /** A move is under way (after Next or Back): the card on screen says so, and its buttons wait. */
  looking: boolean;
  /** The element the current step highlights, if any (focus goes back to it at the end). */
  element: HTMLElement | null;
  /** The pop-out the highlighted element sits in, if any: the card docks beside it (fix 8). */
  panel: HTMLElement | null;
  live: HTMLElement;
  stepCleanup: (() => void)[];
  cleanup: (() => void)[];
}

/**
 * Plays walkthroughs over a product's real screens, with no framework:
 * the product passes a `PlayerHost`. Sticky bars and pop-outs are found through markers any product
 * can add: `[data-flinders-bar]`, `[data-flinders-bottom-bar]`, `[role="dialog"][aria-modal="true"]`.
 * Built on Driver.js (MIT), imported only when a walkthrough starts, so it never weighs on the
 * first page load. Each step is shown with `highlight()`, so this service decides the order,
 * the waiting and the navigation; Driver.js draws the dimmed page, the cut-out and the card.
 *
 * What it adds to Driver.js :
 * 1. Esc ends the walkthrough only: caught first, so the pop-out under it stays open.
 * 2. The highlight follows inner scrolling (a scrolling column), not only the page's.
 * 3. No animation or smooth scrolling when the person has asked for reduced motion.
 * 4. A polite live region announces each step ("Step 2 of 5: …") for screen readers.
 * 5. A sticky bar ([data-flinders-bar]) never covers the highlighted element: it scrolls clear.
 * 6. The card is styled from variables (`flinders-card`, player.css): light and dark, phone width.
 * 7. The card ends above a phone's bottom bar ([data-flinders-bottom-bar]) on phones and touch screens.
 * 8. A step inside a pop-out: the card docks beside the pop-out, never over the control the step is
 *    about (a picker's list opens under it); the page isn't dimmed twice (the pop-out already dims
 *    it); and the cut-out follows the element as it grows (a list opening, a field appearing).
 */
export class WalkthroughPlayer {
  private run: Run | null = null;
  /** Bumped by every start and by the person stopping: an older start still loading then gives way. */
  private attempt = 0;
  private readonly labels: PlayerLabels;
  private readonly markers: PlayerMarkers;
  /** Starts still loading Driver.js, before there is a run. */
  private opening = 0;

  constructor(private readonly host: PlayerHost) {
    this.labels = { ...LABELS, ...host.labels };
    this.markers = { ...MARKERS, ...host.markers };
  }

  /**
   * Starts a walkthrough (one at a time: a running one is paused first). False when it couldn't
   * start: no steps, Driver.js didn't load (offline, or a new app version deployed), or it stopped
   * before showing anything (a page it couldn't get to), so the caller can say so instead of nothing
   * happening. Overtaken by a newer start, or stopped by the person, isn't a failure: true.
   */
  async start(walkthrough: PlayableWalkthrough, opts: PlayerStartOptions = {}): Promise<boolean> {
    if (this.run) this.end('paused');
    if (!walkthrough.spot) this.host.onStart?.(walkthrough);
    this.opening++;
    try {
      return await this.begin(walkthrough, opts);
    } finally {
      this.opening--;
    }
  }

  /**
   * A walkthrough is starting or on screen: from the moment `start()` is called, not only once its
   * first card is drawn (its first page may take a while to open). Offers wait for this.
   */
  get busy(): boolean {
    return !!this.run || this.opening > 0;
  }

  private async begin(walkthrough: PlayableWalkthrough, opts: PlayerStartOptions): Promise<boolean> {
    const attempt = ++this.attempt;
    if (!walkthrough.steps.length) return false;
    let driver: typeof import('driver.js').driver;
    try {
      ({ driver } = await import('driver.js'));
    } catch {
      return false;
    }
    // Two starts at once: only the newest goes on, or the older run would leak.
    if (attempt !== this.attempt) return true;
    const reduce = media('(prefers-reduced-motion: reduce)');
    const root = getComputedStyle(document.documentElement);
    const d = driver({
      animate: !reduce,
      smoothScroll: !reduce,
      allowClose: true,
      // Our own keys only (Esc below): Driver's arrow keys would fight the fields in a pop-out.
      allowKeyboardControl: false,
      // A stray click on the dimmed page doesn't lose the walkthrough.
      overlayClickBehavior: 'none',
      overlayColor: root.getPropertyValue('--flinders-overlay').trim() || 'rgba(0, 0, 0, 0.35)',
      overlayOpacity: 1,
      stagePadding: 6,
      stageRadius: 8,
      popoverClass: [this.host.unstyled ? '' : 'flinders-card', this.host.classes?.card ?? ''].join(' ').trim(),
      popoverOffset: 12,
      closeBtnLabel: this.labels.finishLater,
    });

    const live = document.createElement('div');
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('data-flinders-live', '');
    document.body.appendChild(live);

    const run: Run = {
      walkthrough,
      opts,
      driver: d,
      index: -1,
      leader: null,
      refit: null,
      held: false,
      // Picking up part-way: the steps before it were done on an earlier run. A fork's may not have been.
      done: new Set(walkthrough.steps.flatMap((step, at) => (at < (opts.startAt ?? 0) && !step.only_if ? [at] : []))),
      seen: new Set(),
      shown: { title: '', body: '', element: null },
      resuming: (opts.startAt ?? 0) > 0,
      token: 0,
      // Ids the current page already gives the walkthrough's routes (started on a project → its settings).
      params: Object.assign({}, opts.startParams, ...walkthrough.steps.flatMap((s) => (s.route ? [paramsFromUrl(s.route, this.host.url(), this.host.reservedParams)] : []))),
      how: null,
      place: this.host.url().split(/[?#]/)[0] ?? '',
      navigating: false,
      acting: false,
      popover: null,
      wayOn: false,
      helping: false,
      looking: false,
      element: null,
      panel: null,
      live,
      stepCleanup: [],
      cleanup: [],
    };
    this.run = run;
    this.listen(run);
    const startAt = Math.min(Math.max(opts.startAt ?? 0, 0), walkthrough.steps.length - 1);
    opts.onEvent?.('started', startAt);
    await this.go(startAt, 1);
    return run.index >= 0 || attempt !== this.attempt;
  }

  /**
   * One card pointing at something, on the spot: found, scrolled to and placed like any step, but
   * with no count, nothing saved and nothing started until it's found, so a walkthrough on screen
   * carries on when it isn't. False when it isn't there. `showMe` on `createFlinders` adds the rest.
   */
  async showMe(name: string, card: { title?: string; body?: string } = {}): Promise<boolean> {
    const element = await waitForElement(name, APPEAR_WAIT_MS, () => false, this.host.anchorAttribute);
    if (!element) return false;
    const step: WalkthroughStep = { anchor: name, title: card.title ?? '', body: card.body ?? '', missing: 'end' };
    return this.start({ id: SPOT_ID, version: 0, title: step.title, steps: [step], spot: { next: this.labels.done } });
  }

  /** A centred card with Stay and, if given, Go. Resolves true only when Go was pressed. Esc and the close button are Stay. */
  confirm(card: { title: string; body?: string; stay: string; go?: string }): Promise<boolean> {
    const step: WalkthroughStep = { anchor: null, title: card.title, body: card.body ?? '', missing: 'centred' };
    return new Promise((resolve) => {
      const onEvent = (event: PlayerEvent) => {
        if (event !== 'started') resolve(event === 'completed');
      };
      void this.start({ id: SPOT_ID, version: 0, title: card.title, steps: [step], spot: { back: card.stay, ...(card.go ? { next: card.go } : {}) } }, { onEvent }).then((ok) => ok || resolve(false));
    });
  }

  /** Next step, or Done on the last. */
  next(how: StepHow = 'next'): void {
    const run = this.run;
    if (!run) return;
    run.how = how;
    if (run.index >= run.walkthrough.steps.length - 1) {
      this.stop('completed');
      return;
    }
    void this.go(run.index + 1, 1);
  }

  back(): void {
    const run = this.run;
    if (run?.walkthrough.spot) return this.stop('paused');
    if (!run || run.index <= 0) return;
    run.how = 'back';
    void this.go(run.index - 1, -1);
  }

  /**
   * Where the person is, as plain JSON for the product's chat: see `WalkthroughContext`. Null with
   * nothing on screen. Built only from the walkthrough's own words, never from the page.
   */
  context(): WalkthroughContext | null {
    const run = this.run;
    if (!run || run.index < 0 || run.walkthrough.spot) return null;
    const { walkthrough, shown } = run;
    const place = this.placeOf(run, run.index);
    return {
      version: 1,
      walkthrough: { id: walkthrough.id, title: walkthrough.title, mode: walkthrough.mode ?? 'show' },
      step: { number: place.step, total: place.total, title: shown.title, body: shown.body.replace(/\*\*/g, ''), element: shown.element },
      page: walkthrough.steps.some((s) => s.route === run.place) ? run.place : (this.host.routePattern?.(this.host.url()) ?? null),
      done: [...run.done].sort((a, b) => a - b).map((at) => ({ number: this.placeOf(run, at).step, title: walkthrough.steps[at]?.title ?? '' })),
      articles: [...new Set([...(walkthrough.steps[run.index]?.articles ?? []), ...(walkthrough.articles ?? [])])],
    };
  }

  /**
   * The product's chat opened (true) or closed (false). The walkthrough stays on this step: its card
   * hides, the dimmed page stays, Esc and Tab belong to the chat. Elements marked `data-flinders-keep`
   * sit above it and take clicks at any time. Closed, the card comes back where it was.
   */
  hold(on: boolean): void {
    const run = this.run;
    if (!run || run.held === on) return;
    run.held = on;
    document.documentElement.classList.toggle('flinders-held', on);
    if (!on) run.popover?.wrapper.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  /** Ends the walkthrough: completed (Done), or paused (Finish later, Esc, the person went elsewhere). */
  stop(event: Exclude<PlayerEvent, 'started'> = 'paused', reason?: PlayerStopReason): void {
    this.attempt++;
    this.end(event, reason);
  }

  private end(event: Exclude<PlayerEvent, 'started'>, reason?: PlayerStopReason): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.token++;
    run.stepCleanup.forEach((fn) => fn());
    run.cleanup.forEach((fn) => fn());
    run.driver.destroy();
    run.live.remove();
    document.documentElement.classList.remove('flinders-in-dialog', 'flinders-held');
    // Focus goes back where the person was working, never to the page body (a pop-out under the
    // walkthrough keeps its focus inside it).
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const target = run.element?.isConnected ? run.element : document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      target?.focus({ preventScroll: true });
    });
    this.host.onActive?.(null);
    run.leader?.remove();
    // The move never landed (the last step, or only skipped steps after it): what they did still counts.
    if (run.how) run.opts.onStep?.(Math.max(run.index, 0), run.how);
    // Nothing shown yet: the step it was going to pick up from stays the place to come back to.
    run.opts.onEvent?.(event, run.index >= 0 ? run.index : (run.opts.startAt ?? 0), reason, reason ? { ...run.params } : undefined);
  }

  // ── steps ──────────────────────────────────────────────────────────────────

  /** `settled`: the step before was skipped by `only_if` a moment ago, so the page has already been waited for. */
  private async go(index: number, direction: 1 | -1, settled = false): Promise<void> {
    const run = this.run;
    if (!run) return;
    const token = ++run.token;
    run.stepCleanup.forEach((fn) => fn());
    run.stepCleanup = [];

    const raw = run.walkthrough.steps[index];
    if (!raw) {
      this.end('completed');
      return;
    }
    const step = this.forScreen(raw);
    if (step === 'skip') {
      await this.skip(run, index, direction, settled);
      return;
    }

    const turn = this.pathTurn(run, index);
    if (turn === 'pass') {
      await this.skip(run, pathEdge(run.walkthrough.steps, index, direction), direction, settled);
      return;
    }

    // Something to wait for (another page, an element not there yet): the card on screen says so, and its buttons wait.
    const anchors = step.anchor ? [step.anchor, ...(step.blocked ?? []).map((b) => b.anchor)] : [];
    if ((step.route && !matchRoute(step.route, this.host.url())) || (anchors.length && !anchors.some((a) => findElement(a, this.host.anchorAttribute)))) this.lookFor(run, step.title);

    if (!(await this.toRoute(run, step.route))) {
      if (this.run === run && run.token === token) this.end('paused');
      return;
    }
    if (run.token !== token) return;
    if (step.route) run.place = step.route;

    if (turn === 'look') {
      // A fork: give an element just opened by the last step time to appear, then skip if none did.
      const shown = await waitForElement(step.only_if!, settled && !step.route ? 0 : APPEAR_WAIT_MS, () => run.token !== token, this.host.anchorAttribute);
      if (run.token !== token) return;
      if (!shown && run.resuming) {
        // Paused inside a pop-out that has since closed: start again rather than show nothing.
        run.resuming = false;
        await this.go(0, 1);
        return;
      }
      if (!shown) {
        await this.skip(run, pathEdge(run.walkthrough.steps, index, direction), direction, true);
        return;
      }
    }

    let element: HTMLElement | null = null;
    let body = step.body;
    if (step.anchor) {
      // A resumed step never waits for the person: there is no card on screen yet to say so.
      const wait = step.wait_for === 'person' && !run.resuming ? Infinity : APPEAR_WAIT_MS;
      // Waiting for the person to act: the card still on screen says so. Otherwise there is no
      // visible wait: once the page settles without the element, the step falls back at once.
      const slow = step.wait_for === 'person' ? setTimeout(() => this.waiting(run, true), 300) : undefined;
      // A blocker showing ends the wait too: the person may never be able to do what's waited for.
      element = await waitForElement(anchors, wait, () => run.token !== token, this.host.anchorAttribute);
      clearTimeout(slow);
      if (run.token !== token) return;
      // A numbered duplicate (`row-3`) that isn't here: one with the same base name that is.
      if (!element && this.host.lookAlike) element = findLookAlike(step.anchor, this.host.anchorAttribute);
      const fallback = !element && typeof step.missing === 'object' ? step.missing : null;
      if (fallback?.alt) {
        element = await waitForElement(fallback.alt, APPEAR_WAIT_MS, () => run.token !== token, this.host.anchorAttribute);
        if (run.token !== token) return;
      }
      if (!element && run.resuming) {
        // Paused inside a pop-out that has since closed: start again rather than show nothing.
        run.resuming = false;
        await this.go(0, 1);
        return;
      }
      if (!element && step.missing === 'end') {
        this.end('paused');
        return;
      }
      // Words about the alternate element only make sense with it on screen.
      if (fallback && (element || !fallback.alt)) body = fallback.body ?? body;
    }

    if (element && this.host.settle) {
      // The page is still laying out: the card waits, hidden, until its element stops moving.
      run.popover?.wrapper.style.setProperty('visibility', 'hidden');
      run.looking = true;
      await untilStill(element, () => run.token !== token);
      if (run.token !== token) return;
    }

    run.resuming = false;
    if (run.how === 'back') for (const at of run.done) if (at >= index) run.done.delete(at);
    // Back before a fork can change the choice, so it may be another path this time.
    if (run.how === 'back') for (const at of run.seen) if (at > index) run.seen.delete(at);
    run.seen.add(index);
    if (run.index >= 0 && (run.how === 'next' || run.how === 'done')) run.done.add(run.index);
    run.index = index;
    // Something stops the person doing this step: the card says so, and they can carry on.
    const blocked = this.blockerOf(step);
    if (blocked) element = findElement(blocked.anchor, this.host.anchorAttribute);
    run.element = element;
    const shown: WalkthroughStep = blocked ? { ...step, title: blocked.title ?? step.title, done_when: undefined, advance_on_click: false } : step;
    const words = blocked?.body ?? (step.optional && element ? `${body} ${this.labels.optional}` : body);
    run.shown = { title: shown.title, body: words, element: element ? (blocked?.anchor ?? step.anchor ?? null) : null };
    this.host.onActive?.({ id: run.walkthrough.id, title: run.walkthrough.title, step: index, total: run.walkthrough.steps.length });
    this.show(run, shown, element, words, index, direction < 0);
    if (step.blocked?.length) this.watchBlocked(run, step, blocked, index, direction);
    // Drawn without its element (still loading): keep looking, and point at it once it's there.
    if (step.anchor && !element && this.host.lateElements !== false) this.watchLate(run, step, index, direction);
    const place = this.placeOf(run, index);
    run.live.textContent = run.walkthrough.spot ? `${step.title} ${words}`.trim() : this.labels.announce(place.step, place.total, step.title);
    if (run.how) run.opts.onStep?.(index, run.how);
    run.how = null;
  }

  /**
   * A fork plays one path. `look`: nothing of this fork has played, so it's down to `only_if`. Once a
   * path has, the rest of it plays whatever is on screen now (its first step may have closed or be on
   * another page), and the fork's other paths are passed without going to their pages.
   */
  private pathTurn(run: Run, index: number): 'look' | 'play' | 'pass' | null {
    const { steps } = run.walkthrough;
    const step = steps[index]!;
    if (!step.only_if) return null;
    const { first, last } = forkAround(steps, index);
    const played = [...run.seen].filter((at) => at >= first && at <= last);
    if (!played.length) return run.resuming && samePath(steps[index - 1], step) ? 'play' : 'look';
    return played.some((at) => samePath(steps[at], step)) ? 'play' : 'pass';
  }

  /** Past a step that doesn't apply, the way the person was going. Back with nowhere to go stays on the step they were on. */
  private async skip(run: Run, index: number, direction: 1 | -1, settled: boolean): Promise<void> {
    const to = index + direction;
    if (to >= run.walkthrough.steps.length) this.end('completed');
    else if (to >= 0) await this.go(to, direction, settled);
    else if (run.index >= 0) await this.go(run.index, 1, true);
    else this.end('paused');
  }

  /** What's stopping the person doing this step, if anything is on screen. */
  private blockerOf(step: WalkthroughStep): NonNullable<WalkthroughStep['blocked']>[number] | undefined {
    return step.blocked?.find((b) => findElement(b.anchor, this.host.anchorAttribute));
  }

  /** A blocker can come or go while the step shows (a section loading): the step is shown again to match. */
  private watchBlocked(run: Run, step: WalkthroughStep, shown: ReturnType<WalkthroughPlayer['blockerOf']>, index: number, direction: 1 | -1): void {
    const poll = setInterval(() => {
      if (this.run !== run || this.blockerOf(step)?.anchor === shown?.anchor) return;
      clearInterval(poll);
      void this.go(index, direction, true);
    }, DONE_POLL_MS);
    run.stepCleanup.push(() => clearInterval(poll));
  }

  /** A card drawn without its element: once the element (or its alternate) appears, the step is shown again, pointing at it. Stops when the run moves on. */
  private watchLate(run: Run, step: WalkthroughStep, index: number, direction: 1 | -1): void {
    const attribute = this.host.anchorAttribute;
    const alt = typeof step.missing === 'object' ? step.missing.alt : undefined;
    const found = () => !!findElement(step.anchor!, attribute) || (!!alt && !!findElement(alt, attribute)) || (!!this.host.lookAlike && !!findLookAlike(step.anchor!, attribute));
    const stop = () => {
      observer.disconnect();
      clearInterval(poll);
    };
    const check = () => {
      if (this.run !== run || run.index !== index) return stop();
      if (!found()) return;
      stop();
      void this.go(index, direction, true);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    // Layout can change without a DOM mutation (a panel sliding in).
    const poll = setInterval(check, LATE_POLL_MS);
    run.stepCleanup.push(stop);
  }

  /** The card on screen while the next step's page or element is on its way: says so, and its buttons wait so a second press can't skip a step. */
  private lookFor(run: Run, title: string): void {
    const popover = run.popover;
    if (this.host.lookingNote === false || !popover?.wrapper.isConnected) return;
    run.looking = true;
    for (const button of Array.from(popover.wrapper.querySelectorAll<HTMLButtonElement>('button'))) if (button !== popover.closeButton) button.disabled = true;
    let note = popover.wrapper.querySelector<HTMLElement>('[data-flinders-looking]');
    if (!note) {
      note = document.createElement('p');
      note.className = 'flinders-looking';
      note.setAttribute('data-flinders-looking', '');
      note.setAttribute('role', 'status');
      popover.description.after(note);
    }
    note.textContent = this.labels.looking(title);
    popover.wrapper.setAttribute('aria-busy', 'true');
    requestAnimationFrame(() => {
      if (this.run === run) run.driver.refresh();
    });
  }

  /** Is there a step before this one for Back to land on? A step on another page can't be seen from here, so it counts. */
  private canGoBack(run: Run, index: number): boolean {
    const url = this.host.url();
    let route: string | undefined;
    return run.walkthrough.steps.slice(0, index).some((raw, at) => {
      route = raw.route ?? route;
      const step = this.forScreen(raw);
      if (step === 'skip') return false;
      const turn = this.pathTurn(run, at);
      if (turn === 'pass') return false;
      if (!step.only_if || turn === 'play' || (route && !matchRoute(route, url, this.host.reservedParams))) return true;
      return [step.only_if].flat().some((anchor) => findElement(anchor, this.host.anchorAttribute));
    });
  }

  /** Is every step after this one sure to be skipped? A fork not reached yet isn't: it depends on what's on screen when the person gets there. */
  private isLast(run: Run, index: number): boolean {
    return run.walkthrough.steps.every((raw, at) => at <= index || this.forScreen(raw) === 'skip' || this.pathTurn(run, at) === 'pass');
  }

  private show(run: Run, step: WalkthroughStep, element: HTMLElement | null, body: string, index: number, cameBack: boolean): void {
    const place = this.placeOf(run, index);
    const last = this.isLast(run, index);
    const canGoBack = this.canGoBack(run, index);
    // The person's own action moves it on, and Next would leave it undone. With the element gone there is nothing to act on, so Next stays.
    const wanted = (run.walkthrough.mode === 'guide' ? step.done_when : undefined) ?? (step.advance_on_click && !step.optional ? CLICKED : undefined);
    // Back onto a step already done: it would bounce straight forward again, so it waits for Next.
    const already = cameBack && !!wanted && wanted.kind !== 'clicked' && doneWhenMet(wanted, element, this.host.url(), this.host.anchorAttribute);
    const done = already ? undefined : wanted;
    const guided = !!done && (!!element || done.kind === 'appears' || done.kind === 'route');
    const { spot } = run.walkthrough;
    // The new card comes after the old one has moved: until then there is no footer to add to.
    run.popover = null;
    run.wayOn = false;
    run.helping = false;
    run.looking = false;
    run.panel = element?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]:not(.driver-popover)') ?? null;
    document.documentElement.classList.toggle('flinders-in-dialog', !!run.panel);
    if (element) this.followSize(run, element);
    if (spot && element) this.closeOnUse(run, element);
    run.driver.highlight({
      element: element ?? undefined,
      popover: {
        title: escapeHtml(step.title),
        description: markup(body),
        ...placed(step),
        showButtons: spot ? [...(spot.back ? (['previous'] as const) : []), ...(spot.next ? (['next'] as const) : []), 'close'] : guided ? ['previous', 'close'] : ['next', 'previous', 'close'],
        disableButtons: canGoBack || spot ? [] : ['previous'],
        // Driver sets these as HTML.
        nextBtnText: escapeHtml(spot?.next ?? (last ? this.labels.done : this.labels.next)),
        prevBtnText: escapeHtml(spot?.back ?? this.labels.back),
        showProgress: !spot,
        progressText: this.labels.progress(place.step, place.total),
        // While the next step is on its way, a second press waits too (a product's own card has no disabled buttons).
        onNextClick: () => run.looking || this.next(),
        onPrevClick: () => run.looking || this.back(),
        onCloseClick: () => this.stop('paused'),
        onPopoverRender: (popover) => {
          this.decorate(run, popover, last, guided, guided || !!step.optional || !!step.advance_on_click || (!!spot && !!element));
          if (this.host.renderCard) this.drawCard(run, popover, { step, body, index, showNext: spot ? !!spot.next : !guided, last, canGoBack: spot ? !!spot.back : canGoBack });
        },
      },
      onHighlighted: () => {
        // A refresh during Driver's move is ignored, so a long scroll can leave the card where the element was.
        if (this.run === run) {
          run.driver.refresh();
          run.refit?.();
        }
        this.clearStickyBars(run, element);
      },
    });

    if (guided) this.watch(run, done, element, step.help_after ?? HELP_AFTER_SECONDS);
  }

  /** The person used what the card points at: it has done its job, and mustn't sit over what opens. */
  private closeOnUse(run: Run, element: HTMLElement): void {
    const close = () => this.stop('completed');
    element.addEventListener('click', close, { once: true });
    run.stepCleanup.push(() => element.removeEventListener('click', close));
  }

  /** Design level 3: the product's own card, in Driver's place. */
  private drawCard(run: Run, popover: PopoverDOM, card: { step: WalkthroughStep; body: string; index: number; showNext: boolean; last: boolean; canGoBack: boolean }): void {
    const box = document.createElement('div');
    box.setAttribute('data-flinders-own-card', '');
    for (const child of Array.from(popover.wrapper.children)) if (child !== popover.arrow) (child as HTMLElement).style.display = 'none';
    popover.wrapper.append(box);
    const place = this.placeOf(run, card.index);
    const { spot } = run.walkthrough;
    const clear = this.host.renderCard?.(box, {
      title: card.step.title,
      body: card.body,
      bodyHtml: markup(card.body),
      step: place.step,
      total: place.total,
      progress: spot ? '' : this.labels.progress(place.step, place.total),
      canGoBack: card.canGoBack,
      showNext: card.showNext,
      nextLabel: spot?.next ?? (card.last ? this.labels.done : this.labels.next),
      ...(spot?.back ? { backLabel: spot.back } : {}),
      ...(card.last && run.walkthrough.learnMore ? { learnMore: () => this.learnMore(run, !card.showNext), learnMoreLabel: this.labels.learnMore } : {}),
      ...(this.host.askAbout && !spot ? { askAbout: () => this.askAbout(run), askAboutLabel: this.labels.askAbout } : {}),
      next: () => run.looking || this.next(),
      back: () => run.looking || this.back(),
      finishLater: () => this.stop('paused'),
    });
    if (clear) run.stepCleanup.push(clear);
    // The card's size is the product's now: place it again.
    requestAnimationFrame(() => {
      if (this.run === run) run.driver.refresh();
    });
  }

  /** A Do step: moves on when the person has done the thing, and never does it for them. */
  private watch(run: Run, done: DoneWhen, element: HTMLElement | null, helpAfter: number): void {
    const finish = () => queueMicrotask(() => this.next('done'));
    if (done.kind === 'clicked' && element) {
      // A router can finish moving before `finish` runs, so the click is noted ahead of the app's own handler.
      const acting = () => {
        run.acting = true;
      };
      element.addEventListener('click', acting, { once: true, capture: true });
      element.addEventListener('click', finish, { once: true });
      run.stepCleanup.push(() => {
        run.acting = false;
        element.removeEventListener('click', acting, { capture: true });
        element.removeEventListener('click', finish);
      });
    } else {
      const poll = setInterval(() => {
        if (this.run !== run || !doneWhenMet(done, element, this.host.url(), this.host.anchorAttribute)) return;
        clearInterval(poll);
        finish();
      }, DONE_POLL_MS);
      run.stepCleanup.push(() => clearInterval(poll));
    }
    if (this.host.cantFind === false) return;
    // Switched off, it can't be done yet: the way on is offered at once rather than after a wait.
    const offNow = element?.matches(':disabled, [aria-disabled="true"]');
    const offer = setTimeout(() => this.offerWayOn(run), offNow ? 0 : helpAfter * 1000);
    run.stepCleanup.push(() => clearTimeout(offer));
  }

  /**
   * A Do step isn't a trap: after a while the card offers a way past it, once (a redraw adds it
   * again, and only then). `cantFind: false` never offers it; `'help'` says what's missing first.
   */
  private offerWayOn(run: Run): void {
    const mode = this.host.cantFind ?? 'skip';
    if (this.run !== run || mode === false) return;
    run.wayOn = true;
    const footer = run.popover?.footerButtons;
    if (!footer?.isConnected) return;
    if (run.helping) return this.drawHelp(run);
    if (footer.querySelector('[data-flinders-cant-find]')) return;
    const link = this.footerButton(this.labels.cantFind, 'link', () => (mode === 'help' ? this.helpFind(run) : this.next('skipped')));
    link.setAttribute('data-flinders-cant-find', '');
    footer.prepend(link);
    this.refitSoon(run);
  }

  /** "Can't find it?" in `'help'` mode: the card says what's missing, with a clearly labelled Skip this step. */
  private helpFind(run: Run): void {
    if (this.run !== run) return;
    run.helping = true;
    this.drawHelp(run);
    run.live.textContent = run.popover?.description.textContent ?? '';
  }

  private drawHelp(run: Run): void {
    const popover = run.popover;
    if (!popover?.wrapper.isConnected) return;
    const raw = run.walkthrough.steps[run.index];
    const missing = raw && typeof raw.missing === 'object' ? raw.missing.body : undefined;
    popover.wrapper.querySelector('[data-flinders-cant-find]')?.remove();
    popover.description.innerHTML = markup([this.labels.cantSee(run.shown.title), missing].filter(Boolean).join(' '));
    popover.description.style.display = 'block';
    if (!popover.footerButtons.querySelector('[data-flinders-skip]')) {
      const skip = this.footerButton(this.labels.skipStep, 'secondary', () => this.next('skipped'));
      skip.setAttribute('data-flinders-skip', '');
      popover.footerButtons.prepend(skip);
    }
    this.refitSoon(run);
  }

  private footerButton(text: string, kind: 'link' | 'secondary', onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ['driver-popover-footer-btn', `flinders-${kind}`, (kind === 'link' ? this.host.classes?.link : this.host.classes?.secondary) ?? ''].join(' ').trim();
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  /** The card has just grown, maybe by a row of its own: placed for its old size, it can cover the element. */
  private refitSoon(run: Run): void {
    requestAnimationFrame(() => {
      if (this.run !== run) return;
      run.driver.refresh();
      run.refit?.();
    });
  }

  private get compact(): boolean {
    return media(this.host.compactQuery ?? COMPACT_QUERY);
  }

  /** Where a step sits on this screen, for the card's "2 of 5". */
  private placeOf(run: Run, index: number): { step: number; total: number } {
    return stepPlace(run.walkthrough.steps, index, this.compact);
  }

  /** The phone version of a step, and sides that fit a narrow screen. */
  private forScreen(step: WalkthroughStep): WalkthroughStep | 'skip' {
    if (!this.compact) return step;
    if (step.phone === 'skip') return 'skip';
    const merged: WalkthroughStep = { ...step, ...(step.phone ?? {}) } as WalkthroughStep;
    // No room beside an element on a phone: above or below it.
    if (merged.side === 'left' || merged.side === 'right') merged.side = 'bottom';
    return merged;
  }

  /** Navigates to the step's route when the page isn't on it. False when the URL can't be built. */
  private async toRoute(run: Run, pattern: string | undefined): Promise<boolean> {
    if (!pattern) return true;
    const here = matchRoute(pattern, this.host.url(), this.host.reservedParams);
    if (here) {
      Object.assign(run.params, here);
      return true;
    }
    const url = buildRoute(pattern, run.params);
    if (!url) return false;
    run.navigating = true;
    try {
      const ok = await this.host.navigate(url);
      const params = ok ? matchRoute(pattern, this.host.url(), this.host.reservedParams) : null;
      if (params) Object.assign(run.params, params);
      return !!params;
    } finally {
      run.navigating = false;
    }
  }

  // ── the card ───────────────────────────────────────────────────────────────

  /** `usesPage`: the person works on the page as well as the card, so a screen reader mustn't be told the card is all there is. */
  private decorate(run: Run, popover: PopoverDOM, last: boolean, guided: boolean, usesPage: boolean): void {
    run.popover = popover;
    if (run.wayOn) this.offerWayOn(run);
    popover.wrapper.setAttribute('aria-modal', String(!usesPage));
    popover.wrapper.setAttribute('data-flinders', run.walkthrough.id);
    popover.closeButton.setAttribute('title', this.labels.finishLater);
    popover.previousButton.classList.add('flinders-secondary', ...classList(this.host.classes?.secondary));
    popover.nextButton.classList.add('flinders-primary', ...classList(this.host.classes?.primary));
    if (run.panel) this.dockBesidePanel(run, popover.wrapper, run.panel);
    else this.keepAboveBottomBar(run, popover.wrapper);
    if (last && run.walkthrough.learnMore) {
      const learn = document.createElement('button');
      learn.type = 'button';
      learn.className = ['driver-popover-footer-btn flinders-link', this.host.classes?.link ?? ''].join(' ').trim();
      learn.textContent = this.labels.learnMore;
      learn.addEventListener('click', () => this.learnMore(run, guided));
      popover.footerButtons.prepend(learn);
    }
    if (this.host.askAbout && !run.walkthrough.spot) {
      const ask = document.createElement('button');
      ask.type = 'button';
      ask.className = ['driver-popover-footer-btn flinders-link', this.host.classes?.link ?? ''].join(' ').trim();
      ask.textContent = this.labels.askAbout;
      ask.addEventListener('click', () => this.askAbout(run));
      popover.footerButtons.prepend(ask);
    }
  }

  /** The walkthrough holds, and the product opens its chat on this step. */
  private askAbout(run: Run): void {
    const context = this.context();
    if (this.run !== run || !context) return;
    this.hold(true);
    this.host.askAbout?.(context);
  }

  /**
   * Learn more ends the walkthrough, then hands over: the card sits over everything and the page
   * under it takes no clicks, so whatever the product opens could not be read beneath it. On the
   * last card that's Done. A guide step still waiting for the person is a pause, as it isn't done.
   */
  private learnMore(run: Run, waiting: boolean): void {
    const open = run.walkthrough.learnMore;
    if (this.run !== run || !open) return;
    if (waiting) this.stop('paused');
    else this.next();
    open();
  }

  /**
   * 7. The card never sits on a phone's bottom bar. Driver.js keeps it
   * inside the window but doesn't know about the bar, so an element taller than the screen (a
   * grid shown as cards) leaves the card over the bar. Driver places the card again
   * on every refresh and resize, so each placement is checked as it happens.
   */
  private keepAboveBottomBar(run: Run, card: HTMLElement): void {
    const fit = () => {
      if (this.run !== run || !card.isConnected) return;
      const floor = bottomBarTop(this.markers.bottomBar);
      const box = card.getBoundingClientRect();
      const lift = floor !== null && box.bottom > floor;
      const top = `${Math.max(8, (floor ?? 0) - box.height)}px`;
      // Still where we lifted it (this check runs again after our own write): still lifted.
      const lifted = floor !== null && card.style.top === top && card.style.bottom === 'auto';
      // The arrow would point from the wrong place once the card has moved: hidden while lifted.
      card.classList.toggle('flinders-lifted', lift || lifted);
      // Driver anchors some placements by `bottom`: that goes too, or the card would stretch.
      if (lift && (card.style.top !== top || card.style.bottom !== 'auto')) {
        card.style.top = top;
        card.style.bottom = 'auto';
      }
    };
    // Our own write is a change too: it then fits (or is already there), so nothing is written again.
    const observer = new MutationObserver(fit);
    observer.observe(card, { attributes: true, attributeFilter: ['style'] });
    run.stepCleanup.push(() => observer.disconnect());
    requestAnimationFrame(fit);
  }

  /**
   * 8. Inside a pop-out the card sits beside it (right, else left), level with the element. With no
   * room beside it (a narrow window, a phone's full-screen pop-out) dockClearOfControls picks the
   * spot that hides the least. Driver places the card on every refresh, so each placement is
   * corrected as it happens (as in keepAboveBottomBar).
   */
  private dockBesidePanel(run: Run, card: HTMLElement, panel: HTMLElement): void {
    const gap = DOCK_GAP;
    const fit = () => {
      if (this.run !== run || !card.isConnected || !panel.isConnected) return;
      const p = panel.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const el = withOpenLists(run.element) ?? p;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clampTop = (t: number) => Math.min(Math.max(8, t), Math.max(8, vh - c.height - 8));
      let left: number;
      let top: number;
      // Beside the pop-out, narrowing the card (not below MIN_DOCKED_WIDTH) when the room is a little short.
      const right = vw - p.right - 2 * gap;
      const leftRoom = p.left - 2 * gap;
      const width = Math.min(c.width, Math.max(right, leftRoom));
      const narrow = width < c.width && width >= MIN_DOCKED_WIDTH;
      if (narrow && card.style.width !== `${Math.floor(width)}px`) {
        card.style.width = `${Math.floor(width)}px`;
        card.style.minWidth = '0';
        return; // the style change runs fit again with the card's new size
      }
      if (right >= c.width) {
        left = p.right + gap;
        top = clampTop(el.top);
      } else if (leftRoom >= c.width) {
        left = p.left - gap - c.width;
        top = clampTop(el.top);
      } else {
        ({ left, top } = dockClearOfControls({
          card: c,
          element: el,
          panel: p,
          // Only what's on show: a control scrolled out of the pop-out's body can't be covered.
          controls: Array.from(panel.querySelectorAll<HTMLElement>(PANEL_CONTROLS))
            .map((control) => control.getBoundingClientRect())
            .filter((box) => overlapArea(box, p) > 0),
          head: panel.querySelector<HTMLElement>(this.markers.barHeader)?.getBoundingClientRect(),
          foot: panel.querySelector<HTMLElement>(this.markers.barActions)?.getBoundingClientRect(),
          viewport: { width: vw, height: vh },
        }));
      }
      card.classList.add('flinders-docked');
      const want = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
      if (card.style.left !== want.left || card.style.top !== want.top || card.style.right !== 'auto' || card.style.bottom !== 'auto') {
        Object.assign(card.style, { ...want, right: 'auto', bottom: 'auto' });
      }
      this.drawLeader(run, card, panel);
    };
    run.refit = fit;
    const observer = new MutationObserver(fit);
    observer.observe(card, { attributes: true, attributeFilter: ['style'] });
    // A list opening or closing in the element moves the card off it or back.
    if (run.element) observer.observe(run.element, { childList: true, subtree: true });
    run.stepCleanup.push(() => {
      observer.disconnect();
      run.refit = null;
      run.leader?.style.setProperty('display', 'none');
      // The next step's card starts at its own width.
      card.style.width = '';
      card.style.minWidth = '';
      card.classList.remove('flinders-docked');
    });
    requestAnimationFrame(fit);
  }

  /**
   * A card docked away from its element gets a line back to it, under the card (player.css). Not when
   * the card sits on the pop-out itself (a phone): the line would run across the pop-out's text.
   */
  private drawLeader(run: Run, card: HTMLElement, panel: HTMLElement): void {
    const element = run.element;
    if (!element?.isConnected) return;
    run.leader ??= createLeader();
    const box = card.getBoundingClientRect();
    const ends = overlapArea(box, panel.getBoundingClientRect()) ? null : leaderEnds(box, element.getBoundingClientRect());
    if (!ends) return void run.leader.style.setProperty('display', 'none');
    const line = run.leader.querySelector('line')!;
    const dot = run.leader.querySelector('circle')!;
    line.setAttribute('x1', String(ends.x1));
    line.setAttribute('y1', String(ends.y1));
    line.setAttribute('x2', String(ends.x2));
    line.setAttribute('y2', String(ends.y2));
    dot.setAttribute('cx', String(ends.x2));
    dot.setAttribute('cy', String(ends.y2));
    run.leader.style.display = '';
  }

  /** 8. The cut-out (and the card) follow the element as it changes size: a list opening in it. */
  private followSize(run: Run, element: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let first = true;
    const observer = new ResizeObserver(() => {
      // The first call is the observer starting, not a change.
      if (first) return void (first = false);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (this.run === run) run.driver.refresh();
      });
    });
    observer.observe(element);
    run.stepCleanup.push(() => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  }

  /** While the next step waits for its element, the card on screen says so. */
  private waiting(run: Run, on: boolean): void {
    const next = run.popover?.nextButton;
    if (!next || !next.isConnected) return;
    next.disabled = on;
    if (on) next.textContent = this.labels.waiting;
  }

  // ── fixes 1, 2, 5 and navigation ──────────────────────────────────────────

  private listen(run: Run): void {
    // 1. Esc: caught before a pop-out's own document listener, so an open pop-out stays open.
    const onKey = (event: KeyboardEvent) => {
      // Held, the keys are the chat's: Driver's own Tab handler would pull focus back to the hidden card.
      if (run.held && event.key === 'Tab') event.stopImmediatePropagation();
      if (event.key !== 'Escape' || this.run !== run || run.held) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.stop('paused');
    };
    window.addEventListener('keydown', onKey, true);
    run.cleanup.push(() => window.removeEventListener('keydown', onKey, true));

    // 2. Any scroll (inner columns too) moves the cut-out and the card with the element.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (this.run !== run) return;
        run.driver.refresh();
        run.refit?.();
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    run.cleanup.push(() => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    });

    // The person went somewhere the walkthrough isn't: pause it, never show it on the wrong page.
    const unlisten = this.host.onNavigated((url) => {
      if (run.navigating || run.acting || this.run !== run) return;
      const steps = run.walkthrough.steps;
      const done = steps[run.index]?.done_when;
      // A step with no route of its own is on the last page the run knew. Only the path counts: a changed query isn't leaving.
      const here = [steps[run.index]?.route ?? run.place, steps[run.index + 1]?.route, done?.kind === 'route' ? done.route : undefined].filter((r): r is string => !!r);
      const match = here.find((r) => matchRoute(r, url, this.host.reservedParams));
      if (match) run.place = match;
      else this.end('paused', 'left');
    });
    run.cleanup.push(unlisten);
  }

  /** 5. A sticky header, tab bar or section bar covering the element's top: scroll it clear. */
  private clearStickyBars(run: Run, element: HTMLElement | null): void {
    if (!element) return;
    requestAnimationFrame(() => {
      if (this.run !== run) return;
      const box = element.getBoundingClientRect();
      let cover = 0;
      for (const bar of Array.from(document.querySelectorAll<HTMLElement>(this.markers.bar))) {
        if (bar.contains(element) || element.contains(bar)) continue;
        const position = getComputedStyle(bar).position;
        if (position !== 'sticky' && position !== 'fixed') continue;
        const b = bar.getBoundingClientRect();
        const overlapsSideways = b.left < box.right && b.right > box.left;
        if (overlapsSideways && b.top <= box.top && b.bottom > box.top) cover = Math.max(cover, b.bottom - box.top);
      }
      if (!cover) return;
      scrollParent(element).scrollBy({ top: -(cover + 8) });
      run.driver.refresh();
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** The first visible element with this `data-testid`, if any. */
function findElement(anchor: string, attribute = 'data-testid'): HTMLElement | null {
  // Anchors are kebab-case testids (checked by the schema); quotes are escaped regardless.
  const selector = `[${attribute}="${anchor.replace(/["\\]/g, '\\$&')}"]`;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return el;
  }
  return null;
}

/**
 * A visible element that looks like a numbered anchor's duplicate: for `row-3`, `row` or `row-<n>`.
 * Null when the anchor isn't numbered, or there is none.
 * @internal
 */
export function findLookAlike(anchor: string, attribute = 'data-testid'): HTMLElement | null {
  const base = /^(.+)-\d+$/.exec(anchor)?.[1];
  if (!base) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`))) {
    const name = el.getAttribute(attribute) ?? '';
    if (name === anchor || (name !== base && !(name.startsWith(`${base}-`) && /^\d+$/.test(name.slice(base.length + 1))))) continue;
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return el;
  }
  return null;
}

/** Resolves once the element has kept still for STILL_MS (or at STILL_MAX_MS, or when cancelled). */
function untilStill(element: HTMLElement, cancelled: () => boolean): Promise<void> {
  const where = () => {
    const box = element.getBoundingClientRect();
    return `${box.left},${box.top},${box.width},${box.height}`;
  };
  return new Promise((resolve) => {
    const began = Date.now();
    let last = where();
    let since = began;
    const poll = setInterval(() => {
      const now = where();
      if (now !== last) {
        last = now;
        since = Date.now();
      }
      if (cancelled() || !element.isConnected || Date.now() - since >= STILL_MS || Date.now() - began >= STILL_MAX_MS) {
        clearInterval(poll);
        resolve();
      }
    }, 50);
  });
}

/**
 * Has a guide step been done? Only ever asks whether a field has a value, never what it is. A custom
 * picker says so with `data-has-value="true"` on itself or inside the step's element.
 * @internal
 */
export function doneWhenMet(done: DoneWhen, element: HTMLElement | null, url: string, attribute?: string): boolean {
  if (done.kind === 'route') return !!matchRoute(done.route, url);
  if (done.kind === 'appears') return !!findElement(done.anchor, attribute);
  if (!element) return false;
  if (element.matches('[data-has-value="true"]') || element.querySelector('[data-has-value="true"]')) return true;
  // A dropdown's search box isn't an answer: typing in it has chosen nothing.
  const field = element.matches(FIELDS) ? element : element.querySelector(FIELDS);
  return !!(field as HTMLInputElement | null)?.value?.trim();
}

/**
 * Where a step sits for the card's "2 of 5" (`stepPlaces`): a fork counts as its longest path, and
 * a number can't look ahead further, as a fork's elements may not be on screen until the person
 * gets there. `compact`: a step a phone skips isn't there to count.
 * @internal
 */
export function stepPlace(steps: readonly WalkthroughStep[], index: number, compact = false): { step: number; total: number } {
  const shown = steps.flatMap((step, at) => (compact && step.phone === 'skip' ? [] : [{ step, at }]));
  const { places, total } = stepPlaces(shown.map(({ step }) => step));
  return { step: places[shown.filter(({ at }) => at <= index).length - 1] ?? 0, total };
}

/** The end of a step's path, the way the person is going: past it is the next thing to try. */
const pathEdge = (steps: readonly WalkthroughStep[], index: number, direction: 1 | -1) => {
  const { first, last } = pathAround(steps, index);
  return direction > 0 ? last : first;
};

/**
 * The first visible element with this `data-testid` (or any of these). Waits while the page is still changing (a
 * pop-out opening, data loading), up to `timeout` ms; gives up as soon as the page has been still
 * for SETTLED_MS without it. `Infinity` = wait as long as it takes (for the person to act).
 * @internal
 */
export function waitForElement(anchor: string | readonly string[], timeout: number, cancelled: () => boolean, attribute?: string): Promise<HTMLElement | null> {
  const anchors = typeof anchor === 'string' ? [anchor] : anchor;
  const find = () => anchors.map((a) => findElement(a, attribute)).find(Boolean) ?? null;
  const hit = find();
  if (hit || timeout <= 0) return Promise.resolve(hit);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    let changedAt = Date.now();
    const check = () => {
      if (cancelled()) return finish(null);
      const el = find();
      if (el) return finish(el);
      if (Number.isFinite(timeout) && Date.now() - changedAt >= SETTLED_MS) finish(null);
    };
    const observer = new MutationObserver(() => {
      changedAt = Date.now();
      check();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    // Layout can change without a DOM mutation (a panel sliding in): look again every 100 ms too.
    const poll = setInterval(check, 100);
    const timer = Number.isFinite(timeout) ? setTimeout(() => finish(null), timeout) : null;
  });
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text with `**bold**`: everything else is escaped, so copy can never inject markup. */
export function markup(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Where a step's card sits. A file's left and right, start and end follow the page's direction. */
function placed(step: WalkthroughStep): { side: NonNullable<WalkthroughStep['side']>; align: NonNullable<WalkthroughStep['align']> } {
  const side = step.side ?? 'bottom';
  const align = step.align ?? 'start';
  if (getComputedStyle(document.documentElement).direction !== 'rtl') return { side, align };
  return { side: side === 'left' ? 'right' : side === 'right' ? 'left' : side, align: align === 'start' ? 'end' : align === 'end' ? 'start' : align };
}

/**
 * The highest a card may end on screen when a phone's bottom bar shows: 8px above the bar and
 * above anything raised out of it. Null when there is no bottom bar (computers).
 * @internal
 */
export function bottomBarTop(marker = MARKERS.bottomBar): number | null {
  const bar = document.querySelector<HTMLElement>(marker);
  if (!bar) return null;
  const tops = [bar, ...Array.from(bar.children)].map((el) => el.getBoundingClientRect()).filter((b) => b.height > 0).map((b) => b.top);
  return tops.length ? Math.min(...tops) - 8 : null;
}

/** How much of two boxes overlaps, in square pixels. @internal */
export function overlapArea(a: Rect, b: Rect): number {
  const wide = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const high = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return wide > 0 && high > 0 ? wide * high : 0;
}

/**
 * Where a card goes with no room beside a pop-out: the spot that covers the element least and, among
 * those, the fewest controls (counted as how much of each is hidden, so a button lost whole outweighs
 * the edge of a wide field). On a tie the earliest wins: outside the pop-out, then inside it at the
 * end away from the element, then right up against the element, for when both ends would cover it.
 * @internal
 */
export function dockClearOfControls({ card, element, panel, controls, head, foot, viewport }: DockLayout): DockSpot {
  const left = Math.min(Math.max(DOCK_MARGIN, (panel.left + panel.right - card.width) / 2), Math.max(DOCK_MARGIN, viewport.width - card.width - DOCK_MARGIN));
  const clampTop = (top: number) => Math.min(Math.max(DOCK_MARGIN, top), Math.max(DOCK_MARGIN, viewport.height - card.height - DOCK_MARGIN));
  const insideTop = { spot: 'inside-top', top: (head?.bottom ?? panel.top) + DOCK_MARGIN } as const;
  const insideBottom = { spot: 'inside-bottom', top: (foot?.top ?? panel.bottom) - DOCK_MARGIN - card.height } as const;
  const elementLow = (element.top + element.bottom) / 2 > viewport.height / 2;
  const ring = { left: element.left - RING, top: element.top - RING, right: element.right + RING, bottom: element.bottom + RING };
  const aboveTop = panel.top - DOCK_GAP - card.height;
  const belowTop = panel.bottom + DOCK_GAP;
  let best: DockSpot | null = null;
  let bestScore = [Infinity, Infinity];
  for (const { spot, top: wanted } of [
    // Above and below only count where they fit: pushed back into the window they'd just be inside.
    ...(aboveTop >= DOCK_MARGIN ? [{ spot: 'above', top: aboveTop } as const] : []),
    ...(belowTop + card.height <= viewport.height - DOCK_MARGIN ? [{ spot: 'below', top: belowTop } as const] : []),
    ...(elementLow ? [insideTop, insideBottom] : [insideBottom, insideTop]),
    { spot: 'above-element', top: ring.top - DOCK_MARGIN - card.height },
    { spot: 'below-element', top: ring.bottom + DOCK_MARGIN },
  ] as const) {
    const top = clampTop(wanted);
    const box = { left, top, right: left + card.width, bottom: top + card.height };
    const hidden = overlapArea(box, ring);
    const covered = controls.reduce((sum, c) => sum + overlapArea(box, c) / Math.max(1, (c.right - c.left) * (c.bottom - c.top)), 0);
    if (hidden < bestScore[0]! || (hidden === bestScore[0] && covered < bestScore[1]!)) {
      best = { spot, left, top };
      bestScore = [hidden, covered];
    }
  }
  return best!;
}

/** An element's box, taking in any list open from it (a dropdown's list hangs outside its field). */
function withOpenLists(element: HTMLElement | null): Rect | null {
  if (!element) return null;
  const { left, top, right, bottom } = element.getBoundingClientRect();
  const box = { left, top, right, bottom };
  for (const list of Array.from(element.querySelectorAll<HTMLElement>(OPEN_LISTS))) {
    const r = list.getBoundingClientRect();
    box.left = Math.min(box.left, r.left);
    box.top = Math.min(box.top, r.top);
    box.right = Math.max(box.right, r.right);
    box.bottom = Math.max(box.bottom, r.bottom);
  }
  return box;
}

/** The line from a card back to its element, edge to edge; null when the card touches or covers it. @internal */
export function leaderEnds(card: Rect, element: Rect): { x1: number; y1: number; x2: number; y2: number } | null {
  if (overlapArea(card, element) > 0) return null;
  const clamp = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
  const x1 = clamp((element.left + element.right) / 2, card.left, card.right);
  const y1 = clamp((element.top + element.bottom) / 2, card.top, card.bottom);
  return { x1, y1, x2: clamp(x1, element.left, element.right), y2: clamp(y1, element.top, element.bottom) };
}

function createLeader(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'flinders-leader');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(document.createElementNS(ns, 'line'), document.createElementNS(ns, 'circle'));
  svg.querySelector('circle')!.setAttribute('r', '3');
  document.body.append(svg);
  return svg;
}

const classList = (names: string | undefined) => (names ?? '').split(/\s+/).filter(Boolean);

function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function media(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

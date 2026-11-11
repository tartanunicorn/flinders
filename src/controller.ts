import { checklistFor, findWalkthrough, matchWalkthroughs, modeLabel, offerSeen, resumeStep, walkthroughToOffer } from './logic.js';
import type { PlayableWalkthrough, PlayerEvent, PlayerStartOptions } from './player.js';
import { matchRoute, type ReservedParams } from './routes.js';
import type { StepHow, Walkthrough, WalkthroughFrom, WalkthroughLabels, WalkthroughProgress } from './types.js';
import { WALKTHROUGH_LABELS } from './types.js';

/** The fields of a served walkthrough the controller works from: a product's own type may hold more. */
export type ServedWalkthrough = Pick<
  Walkthrough,
  'walkthrough_id' | 'number' | 'version' | 'slug' | 'title' | 'mode' | 'permission' | 'offer_on' | 'reoffer_from' | 'article_slug' | 'articles' | 'steps'
>;

/** A person's walkthroughs: their offers switch and their progress, keyed by original id. */
export interface PersonWalkthroughs {
  offer_walkthroughs: boolean;
  progress: Readonly<Record<string, WalkthroughProgress>>;
}

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** What goes on an offer: a title, one line, and the buttons' words. */
export interface WalkthroughOffer {
  title: string;
  message: string;
  acceptLabel: string;
  /** The page's other kind, beside the first ("Show me" beside "Guide me"). */
  alternativeLabel?: string;
  dismissLabel: string;
  /** How to get it back, or turn these off. */
  dismissHint?: string;
}

/** true = accepted, 'alternative' = the second yes, false = Not now, null = gone unanswered. */
export type OfferAnswer = boolean | 'alternative' | null;

export interface WalkthroughEventBody {
  event: PlayerEvent | 'step';
  version: number;
  step: number;
  from: WalkthroughFrom;
  how?: StepHow;
}

/** What the controller needs from the product it runs in. */
export interface WalkthroughHost<W extends ServedWalkthrough> {
  /** The product's API. Null = it answered with no data; throwing = it couldn't be reached. */
  api: {
    list(): Promise<W[] | null>;
    mine(): Promise<PersonWalkthroughs | null>;
    setOffers(on: boolean): Promise<PersonWalkthroughs | null>;
    record(walkthroughId: string, event: WalkthroughEventBody): Promise<PersonWalkthroughs | null>;
  };
  /** The person may see something behind this permission. */
  can(permission: string): boolean;
  /** Plays a walkthrough, with the product's player. False when it couldn't start. */
  play(walkthrough: PlayableWalkthrough, options?: PlayerStartOptions): Promise<boolean>;
  /** Puts an offer on screen and resolves with the answer. */
  showOffer(offer: WalkthroughOffer): Promise<OfferAnswer>;
  /** Takes an offer down unanswered, so `showOffer` resolves null. */
  clearOffer(): void;
  /** Opens a walkthrough's article. Without it, no walkthrough shows Learn more. */
  learnMore?(articleSlug: string): void;
  /** Says something to the person. */
  toast(message: string): void;
  /** Nothing is offered while this is true: a walkthrough is playing, one is being recorded, nobody is signed in yet. */
  offersPaused(): boolean;
  /** Values a `:param` must never capture, so a route never matches a page that reserves them (`{ templateId: ['company-style'] }`). */
  reservedParams?: ReservedParams;
  /** Called whenever the view changes, so a product can keep it in its own state. */
  onChange?(view: WalkthroughsView<W>): void;
  /** The controller's words, each with a default. */
  labels?: Partial<WalkthroughLabels>;
  /** True: a walkthrough left part-way is offered again; only Done and Not now stop it. See `offerSeen`. */
  reofferUnfinished?: boolean;
  /**
   * On (the default): a walkthrough started part-way through its work (a later page, a pop-out open,
   * a step already done) starts at the step for what's on screen, never back at its first page.
   * False: it starts at its first step, or where the person paused.
   */
  startFromHere?: boolean;
}

/** What a product draws from. */
export interface WalkthroughsView<W> {
  list: readonly W[];
  mine: PersonWalkthroughs | null;
  state: LoadState;
  /** Where the person's own data has got to: loaded once it's here, whatever happened since. */
  mineState: LoadState;
  /** The offers switch: on until they turn it off. */
  offers: boolean;
  /** The walkthrough the person left part-way by going to another page, until it's finished. */
  left: W | null;
}

/**
 * Everything a product's walkthrough state does, with no framework: loading, starting and resuming,
 * offers (one answer settling both kinds), leaving part-way and previews. A product wraps it in its
 * own state, passes a small host and draws what `view` says.
 *
 * - `start()` is for things the person asked for: it ignores the offers switch.
 * - `offerFor()` runs on each page change: it offers a walkthrough for that page once per version,
 *   only with offers on and the walkthrough's permission. An offer left unanswered is offered again.
 */
export class WalkthroughController<W extends ServedWalkthrough> {
  private readonly labels: WalkthroughLabels;
  private list: W[] = [];
  private mine: PersonWalkthroughs | null = null;
  private state: LoadState = 'idle';
  private loading: Promise<void> | null = null;
  /** Counts `offerFor` calls, so one that waited on the list knows if a newer page overtook it. */
  private offerPage = 0;
  private leftRun: { walkthrough: W; params: Record<string, string> } | null = null;
  /** An offer is on screen (one at a time; each page's walkthrough is still offered the first time). */
  private offering = false;
  /** A preview waiting for the person to open its page. */
  private pendingPreview: PlayableWalkthrough | null = null;
  /** Starts under way: a walkthrough counts as playing from `start()`, not from its first card. */
  private starting = 0;

  constructor(private readonly host: WalkthroughHost<W>) {
    this.labels = { ...WALKTHROUGH_LABELS, ...host.labels };
  }

  get view(): WalkthroughsView<W> {
    const w = this.leftRun?.walkthrough;
    const seen = w && this.mine?.progress[w.walkthrough_id];
    return {
      list: this.list,
      mine: this.mine,
      state: this.state,
      mineState: this.mine ? 'loaded' : this.state,
      offers: this.mine?.offer_walkthroughs ?? true,
      left: seen?.status === 'completed' && seen.v >= w!.version ? null : (w ?? null),
    };
  }

  private changed(): void {
    this.host.onChange?.(this.view);
  }

  /** The person's list from this URL: one row per task, ticked as they finish. Empty until their progress has loaded, and once nothing startable is left to do. */
  checklist(url: string) {
    return this.mine ? checklistFor(this.list, this.mine.progress, (permission) => this.host.can(permission), url, this.host.reservedParams) : [];
  }

  /** Loads the live walkthroughs and the person's progress. A failure leaves walkthroughs off, never breaks a page. */
  load(): Promise<void> {
    // One at a time: a page opened while the list is on its way waits for that same answer.
    this.loading ??= this.fetchAll().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async fetchAll(): Promise<void> {
    this.state = 'loading';
    this.changed();
    try {
      const [list, mine] = await Promise.all([this.host.api.list(), this.host.api.mine()]);
      if (list) this.list = list;
      if (mine) this.mine = mine;
      this.state = list && mine ? 'loaded' : 'error';
    } catch {
      this.state = 'error';
    }
    this.changed();
  }

  /** Back into the walkthrough the person left, on the same page or record. */
  async continueLeft(): Promise<void> {
    const left = this.leftRun;
    if (!left) return;
    const id = left.walkthrough.walkthrough_id;
    // start() has said so already unless the walkthrough has gone.
    if (!(await this.start(id, 'chat', { startParams: left.params })) && !findWalkthrough(this.list, id)) this.host.toast(this.labels.couldNotStart);
  }

  /** The person doesn't want to carry on with it: the note goes. */
  dismissLeft(): void {
    this.leftRun = null;
    this.changed();
  }

  /** The offers switch. */
  async setOffers(on: boolean): Promise<boolean> {
    try {
      const mine = await this.host.api.setOffers(on);
      if (mine) this.setMine(mine);
      return !!mine;
    } catch {
      return false;
    }
  }

  /**
   * Starts a walkthrough the person asked for, by its handle, number or original id: found by the
   * number, so a renamed one still starts. False if there is no such live one, or it couldn't start
   * (it says so). It starts at the step for what's on screen when the person is part-way through
   * (`startFromHere`), else where they paused, else at the start. `fromStart` ignores where they paused.
   */
  async start(ref: string, from: WalkthroughFrom, opts: { fromStart?: boolean; startParams?: Record<string, string> } = {}): Promise<boolean> {
    // Playing from now: its first page may take a while to open, and no offer goes up beside it.
    this.starting++;
    this.host.clearOffer();
    try {
      return await this.startNow(ref, from, opts);
    } finally {
      this.starting--;
    }
  }

  private async startNow(ref: string, from: WalkthroughFrom, opts: { fromStart?: boolean; startParams?: Record<string, string> }): Promise<boolean> {
    // Not loaded yet, or the last load failed (the API was briefly away): load again, so a failed
    // load never leaves Show me doing nothing for the rest of the visit.
    if (this.state !== 'loaded') await this.load();
    const w = findWalkthrough(this.list, ref);
    if (!w) return false;
    const left = this.leftRun;
    this.leftRun = null;
    this.changed();
    // Paused part-way through this version: pick up where they left off.
    const startAt = opts.fromStart ? 0 : resumeStep(w, this.mine?.progress[w.walkthrough_id]);
    const started = await this.play(this.definition(w), {
      startAt,
      ...(this.host.startFromHere === false ? {} : { fromHere: true }),
      startParams: opts.startParams,
      onEvent: (event, step, reason, params) => {
        void this.record(w, event, step, from);
        if (reason === 'left') {
          this.leftRun = { walkthrough: w, params: params ?? {} };
          this.changed();
        }
      },
      onStep: (step, how) => void this.record(w, 'step', step, from, how),
    });
    // It never ran: whatever the person had left, they still have.
    if (!started && !this.leftRun) {
      this.leftRun = left;
      this.changed();
    }
    return started;
  }

  /** Plays a walkthrough that isn't saved anywhere; nothing is recorded. */
  async preview(definition: PlayableWalkthrough): Promise<void> {
    await this.play(definition);
  }

  /**
   * Plays a version (any status) without recording anything. When its first step is on a page with
   * an id in it (`/projects/:projectId`), the preview waits until the person opens such a page;
   * otherwise it opens the page now. Returns the page it waits for.
   */
  previewOnItsPage(definition: PlayableWalkthrough, navigate: (url: string) => void): string | null {
    const route = definition.steps.find((s) => s.route)?.route ?? null;
    this.pendingPreview = definition;
    if (route && !route.includes(':')) navigate(route);
    return route;
  }

  /** Starts a waiting preview once the person is on its page. True when it started. */
  private async startPendingPreview(url: string): Promise<boolean> {
    const pending = this.pendingPreview;
    if (!pending) return false;
    const route = pending.steps.find((s) => s.route)?.route;
    if (route && !matchRoute(route, url, this.host.reservedParams)) return false;
    this.pendingPreview = null;
    await this.play(pending);
    return true;
  }

  /** Offers this page's walkthrough, if there is one the person hasn't seen in this version. */
  async offerFor(url: string): Promise<void> {
    const page = ++this.offerPage;
    if (await this.startPendingPreview(url)) return;
    if (this.offering || this.paused()) return;
    if (this.state === 'idle' || this.state === 'loading') await this.load();
    // They moved on while it loaded, or started something: only the page they're on now gets an offer, and only when nothing is playing.
    if (page !== this.offerPage || this.offering || this.paused()) return;
    if (!(this.mine?.offer_walkthroughs ?? true)) return;
    const w = walkthroughToOffer(this.list, url, { progress: this.mine?.progress ?? {}, can: (permission) => this.host.can(permission) }, { reofferUnfinished: this.host.reofferUnfinished, reservedParams: this.host.reservedParams });
    if (!w) return;
    // The same page's other kind goes beside it, if it hasn't been seen either: Guide me is the main button, as people here came to work.
    const other = this.list.find((x) => x.walkthrough_id !== w.walkthrough_id && x.offer_on === w.offer_on && x.mode !== w.mode && this.unseen(x) && (!x.permission || this.host.can(x.permission)));
    const [main, second] = other?.mode === 'guide' ? [other, w] : [w, other];
    let answer: OfferAnswer;
    // Only while the offer is up: a walkthrough can wait on the person for as long as it likes.
    this.offering = true;
    try {
      answer = await this.host.showOffer({
        title: main.title,
        message: this.labels.offerMessage,
        acceptLabel: modeLabel(main.mode, this.labels),
        alternativeLabel: second ? modeLabel(second.mode, this.labels) : undefined,
        dismissLabel: this.labels.notNow,
        dismissHint: this.labels.offerHint,
      });
    } finally {
      this.offering = false;
    }
    if (answer === null) return;
    // One answer settles the offer for both kinds, once the one chosen has really started.
    const chosen = answer === 'alternative' ? second : main;
    if (answer === false) await this.record(main, 'dismissed', 0, 'offer');
    else if (!chosen || !(await this.start(chosen.walkthrough_id, 'offer'))) return;
    const rest = answer === false ? second : chosen === main ? second : main;
    if (rest && this.unseen(rest)) await this.record(rest, 'dismissed', 0, 'offer');
  }

  /**
   * Not seen, for offers (`offerSeen`): no progress at or past the version the person must have seen,
   * or with `reofferUnfinished`, none that finished or said Not now.
   */
  private unseen(w: W): boolean {
    return !offerSeen(w, this.mine?.progress[w.walkthrough_id], { reofferUnfinished: this.host.reofferUnfinished });
  }

  /** Offers wait while the product says so, and while a walkthrough is starting. */
  private paused(): boolean {
    return this.starting > 0 || this.host.offersPaused();
  }

  /** Takes this page's offer down unanswered (the person moved to another page). */
  clearOffer(): void {
    this.host.clearOffer();
  }

  /** The walkthroughs for a chat request: see `matchWalkthroughs`. Loads first if it has to. */
  async matching(url: string, topic: string): Promise<{ walkthrough: W; here: boolean }[]> {
    if (this.state !== 'loaded') await this.load();
    return matchWalkthroughs(this.list, url, topic, this.host.reservedParams);
  }

  /** Plays a walkthrough; says so when it couldn't start, rather than nothing happening. An offer still up has been overtaken. */
  private async play(definition: PlayableWalkthrough, opts?: PlayerStartOptions): Promise<boolean> {
    this.host.clearOffer();
    const started = await this.host.play(definition, opts);
    if (!started) this.host.toast(this.labels.couldNotStart);
    return started;
  }

  private definition(w: W): PlayableWalkthrough {
    const article = w.article_slug;
    const learnMore = article && this.host.learnMore ? { learnMore: () => this.host.learnMore?.(article) } : {};
    // The single article counts last among the hints.
    const articles = [...(w.articles ?? []), ...(article ? [article] : [])];
    return { id: w.walkthrough_id, version: w.version, title: w.title, mode: w.mode, steps: w.steps, ...(articles.length ? { articles } : {}), ...learnMore };
  }

  private setMine(mine: PersonWalkthroughs): void {
    this.mine = mine;
    this.changed();
  }

  private async record(w: W, event: PlayerEvent | 'step', step: number, from: WalkthroughFrom, how?: StepHow): Promise<void> {
    try {
      const mine = await this.host.api.record(w.walkthrough_id, { event, version: w.version, step, from, how });
      if (mine) this.setMine(mine);
    } catch {
      /* progress is a convenience: a failed save never interrupts the person */
    }
  }
}

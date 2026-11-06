import { errorCode } from './contract.js';
import type { FlindersElement, WalkthroughContext } from './context.js';
import { WalkthroughController, type OfferAnswer, type WalkthroughHost, type WalkthroughOffer, type WalkthroughsView } from './controller.js';
import { recordingFile } from './editor.js';
import { createFlindersClient, type DefaultFlindersTypes, type FlindersClient, type FlindersHttp, type FlindersResult, type FlindersTypes } from './http.js';
import { WalkthroughPlayer, type PlayableWalkthrough, type PlayerHost, type PlayerStartOptions } from './player.js';
import { mountRecorderBar, type RecorderBarOptions } from './recorder-bar.js';
import { RecordingSession, type RecordingSteps, type RecordingView } from './recording-session.js';
import { startRecording, watchForRecording, type RecordingStart } from './recording-start.js';
import { readElements, runShowMe, type ShowMeOptions, type ShowMeResult } from './show-me.js';
import { WALKTHROUGH_LABELS, type StepHow, type WalkthroughFrom, type WalkthroughLabels } from './types.js';

/** How long a page gets to open before its walkthrough is offered. */
const OFFER_DELAY_MS = 600;

/** The product's router. `routePattern` turns `/projects/123` into `/projects/:projectId`; recording needs it. */
export interface FlindersRouter {
  url(): string;
  navigate(url: string): Promise<boolean>;
  onNavigated(listener: (url: string) => void): () => void;
  routePattern?(url: string): string | null;
}

/** Who's signed in, and what they can see. */
export interface FlindersIdentity {
  /** The person may see something behind this permission. */
  can(permission: string): boolean;
  /** Resolves once someone is signed in. Left out = they already are. Offers and recording links wait for it. */
  signedIn?(): Promise<unknown>;
  /**
   * Who is signed in, or null for nobody. Read on each page change: a tab that signs out and in as
   * someone else gets that person's progress, not the last person's, and nothing is offered to nobody.
   */
  id?(): string | null;
  /** Their name, shown on the recording bar in a tab opened from a link. */
  name?(): string | null;
}

/** What a product's analytics or logs get. */
export interface FlindersEvent {
  type: 'walkthrough';
  walkthrough_id: string;
  version: number;
  event: 'started' | 'paused' | 'completed' | 'dismissed' | 'step';
  step: number;
  from: WalkthroughFrom;
  how?: StepHow;
}

/** How an offer gets on screen: the product's own. */
export interface FlindersOffers {
  /** Puts it up, and resolves with the person's answer. */
  show(offer: WalkthroughOffer): Promise<OfferAnswer>;
  /** Takes it down. Its `show` needs no answer after this. */
  clear(): void;
}

/** A player the product made itself, for when it wraps one in its own state. */
export interface FlindersPlayer {
  start(walkthrough: PlayableWalkthrough, options?: PlayerStartOptions): Promise<boolean>;
  hold?(on: boolean): void;
  context?(): WalkthroughContext | null;
  /** Without these two, `flinders.showMe` finds nothing. */
  showMe?(name: string, card?: { title?: string; body?: string }): Promise<boolean>;
  confirm?(card: { title: string; body?: string; stay: string; go?: string }): Promise<boolean>;
  anchorAttribute?: string;
}

/** Recording, past what the connectors already give it. Every part has a default. */
export interface FlindersRecording<D = { walkthrough_id: string }> {
  /** The default bar's look and words, or false to draw your own from `onRecordingChange`. */
  bar?: false | Pick<RecorderBarOptions, 'container' | 'labels' | 'classes' | 'unstyled'>;
  /** Finish in the same tab. Default: saves the steps as a draft through the admin routes and says so. */
  onFinish?(steps: RecordingSteps): void;
  /** The draft from a recording in another tab has arrived: open your step editor on it. */
  onDraft?(draft: D): void;
  /** False = a recording in a new tab stays open after Finish. Default: it closes, back to the tab that opened it. */
  jumpBack?: boolean;
}

export interface FlindersConfig<T extends FlindersTypes = DefaultFlindersTypes> {
  /** The backend: where it is, or the product's own request function. Without it, nothing loads or saves. */
  http?: FlindersHttp;
  /** The router. Without it, there's no player and no recording. */
  router?: FlindersRouter;
  /** Without it, a walkthrough behind a permission is never shown. */
  identity?: FlindersIdentity;
  /** Where events go. Without it, none are sent. A failure here never reaches the person. */
  events?: (event: FlindersEvent) => void;
  /** Puts an offer on screen. Without it, nothing is offered; starting by hand still works. */
  offers?: FlindersOffers;
  /** The player's look and words (`PlayerHost` less the router), or a player the product already has. */
  player?: Omit<PlayerHost, 'url' | 'navigate' | 'onNavigated'> | FlindersPlayer;
  /** Recording's bar and what happens on Finish. */
  recording?: FlindersRecording<T['adminWalkthrough']>;
  /** Says something to the person. Without it, nothing is said. */
  toast?(message: string): void;
  /** Opens a walkthrough's article. Without it, no walkthrough shows Learn more. */
  learnMore?(articleSlug: string): void;
  /** There's something on this page a move could lose. `showMe` says so before offering Go. */
  hasUnsavedWork?(): boolean;
  /** Your words for names whose own words are vague, for `elements()`. */
  meanings?: Record<string, string>;
  /** Nothing is offered while this is true. Offers already wait for a walkthrough (from the moment it starts) or a recording to finish. */
  pauseOffers?(): boolean;
  /**
   * True: a walkthrough the person left part-way (Finish later, Esc, another page) is offered again
   * on its page. Only Done and Not now stop it. False (the default): anything they did counts as seen.
   */
  reofferUnfinished?: boolean;
  /** Called whenever what the controller shows changes. */
  onChange?(view: WalkthroughsView<T['walkthrough']>): void;
  /** Called whenever what the recording bar shows changes. */
  onRecordingChange?(view: RecordingView): void;
  labels?: Partial<WalkthroughLabels>;
  /**
   * On (the default): once someone is signed in, a recording link is picked up and each page's
   * walkthrough is offered as the person moves about. False: the product runs these itself, with
   * `controller.offerFor` and `recorder.resumeFromLink`.
   */
  auto?: boolean;
}

export interface Flinders<T extends FlindersTypes = DefaultFlindersTypes> {
  /** Null without a router, or the product's own player. */
  player: WalkthroughPlayer | FlindersPlayer | null;
  /** Null without `http`. */
  controller: WalkthroughController<T['walkthrough']> | null;
  /** Null without `router.routePattern`. */
  recorder: RecordingSession<T['saved']> | null;
  /** Every route, as a call. Null without `http`. */
  api: FlindersClient<T> | null;
  /** Starts a walkthrough the person asked for, by its handle, number or id. False when it couldn't. */
  start(ref: string, from?: WalkthroughFrom): Promise<boolean>;
  /**
   * What a Record button calls. Puts the bar up here or, when your app is on another site, opens it
   * there in a new tab and calls `recording.onDraft` once the draft is back. `off` = no recording;
   * `refused` = your API said no; `blocked` = the browser stopped the tab. Those last two are said
   * to the person.
   */
  record(): Promise<RecordingStart | 'off' | 'refused'>;
  /** The product's chat opened (true) or closed (false): the walkthrough holds its step. */
  hold(on: boolean): void;
  /** Where the person is in a walkthrough, for your chat. Null with none on screen. */
  context(): WalkthroughContext | null;
  /** The names on screen now, with short labels, for your AI. Works with or without a walkthrough. */
  elements(): FlindersElement[];
  /** Shows something on the spot; on another page, asks first. See docs/show-me-where.md. */
  showMe(name: string, options?: ShowMeOptions): Promise<ShowMeResult>;
  /** What's on, by name. */
  features: { play: boolean; load: boolean; offers: boolean; recording: boolean; recordingLinks: boolean; events: boolean; messages: boolean };
  /** What's off and why, one plain line each. */
  off: string[];
  /** Takes everything down: for a page that goes away, or hot reload. */
  destroy(): void;
}

/**
 * One object for everything in the browser. Each connector is one small thing the product already
 * has; what's left out turns that feature off, and `off` says so. Call it where your app starts,
 * before your router: a tab opened from a recording link then loses the link from its URL first.
 */
export function createFlinders<T extends FlindersTypes = DefaultFlindersTypes>(config: FlindersConfig<T>): Flinders<T> {
  const { http, router, identity, events, offers } = config;
  const browser = typeof window !== 'undefined';
  const labels = { ...WALKTHROUGH_LABELS, ...config.labels };
  const toast = (message: string) => config.toast?.(message);
  const api = http ? createFlindersClient<T>(http) : null;

  const own = config.player && 'start' in config.player ? config.player : null;
  const look = config.player && !('start' in config.player) ? config.player : {};
  /** A card is on screen. */
  let playing = false;
  /** Starts under way, before their first card: a first page can take a while to open. */
  let starting = 0;
  const built =
    !own && router
      ? new WalkthroughPlayer({
          url: () => router.url(),
          navigate: (url) => router.navigate(url),
          onNavigated: (listener) => router.onNavigated(listener),
          ...(router.routePattern ? { routePattern: (url: string) => router.routePattern!(url) } : {}),
          ...look,
          onActive: (active) => {
            playing = !!active;
            look.onActive?.(active);
          },
          // Started by hand (`flinders.player.start`) as well as from the controller: an offer up now has been overtaken.
          onStart: (walkthrough) => {
            controller?.clearOffer();
            look.onStart?.(walkthrough);
          },
        })
      : null;
  const player: WalkthroughPlayer | FlindersPlayer | null = own ?? built;

  const linksOn = !!(api?.serves('checkRecordingLink') && api.serves('saveRecording'));
  const recorder =
    browser && router?.routePattern
      ? new RecordingSession<T['saved']>({
          url: () => router.url(),
          routePattern: router.routePattern.bind(router),
          ...(linksOn && api ? { checkLink: (link: string) => api.checkLink(link), saveDraft: (link: string, steps: RecordingSteps) => api.saveDraft(link, steps) } : {}),
          ...(config.onRecordingChange ? { onChange: (view: RecordingView) => config.onRecordingChange?.(view) } : {}),
          ...(look.anchorAttribute ? { anchorAttribute: look.anchorAttribute } : {}),
          ...(config.recording?.jumpBack === false ? { jumpBack: false } : {}),
        })
      : null;

  /** An offer taken down has no answer coming: this ends its wait, so the next can be offered. */
  let settleOffer: ((answer: OfferAnswer) => void) | null = null;

  const host = (client: FlindersClient<T>): WalkthroughHost<T['walkthrough']> => ({
    api: {
      list: () => client.list(),
      mine: () => client.mine(),
      setOffers: (on) => client.setOffers(on),
      record: (id, event) => {
        try {
          events?.({ type: 'walkthrough', walkthrough_id: id, ...event });
        } catch {
          /* someone else's analytics never interrupts the person */
        }
        return client.record(id, event);
      },
    },
    can: (permission) => identity?.can(permission) ?? false,
    play: async (walkthrough, options) => {
      if (!player) return false;
      starting++;
      try {
        return await player.start(walkthrough, options);
      } finally {
        starting--;
      }
    },
    showOffer: (offer) =>
      new Promise((resolve) => {
        settleOffer = resolve;
        void (offers?.show(offer) ?? Promise.resolve(null)).then(resolve, () => resolve(null));
      }),
    clearOffer: () => {
      offers?.clear();
      settleOffer?.(null);
      settleOffer = null;
    },
    toast,
    ...(config.learnMore ? { learnMore: (slug: string) => config.learnMore?.(slug) } : {}),
    offersPaused: () => !offers || playing || starting > 0 || !!built?.busy || !!recorder?.view.busy || !!config.pauseOffers?.(),
    ...(config.onChange ? { onChange: (view: WalkthroughsView<T['walkthrough']>) => config.onChange?.(view) } : {}),
    ...(config.labels ? { labels: config.labels } : {}),
    ...(config.reofferUnfinished ? { reofferUnfinished: true } : {}),
  });
  const controller = api ? new WalkthroughController<T['walkthrough']>(host(api)) : null;

  const stops: (() => void)[] = [];
  let stopped = false;
  let stopWatching: (() => void) | null = null;
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  stops.push(() => clearTimeout(offerTimer));

  /** Finish in the same tab: the product's own next step, or a draft through the admin routes. */
  const finished = async (steps: RecordingSteps) => {
    if (config.recording?.onFinish) return config.recording.onFinish(steps);
    if (!api || !steps.length) return;
    toast((await api.admin.upload(recordingFile(steps))).ok ? labels.recordingSaved : labels.recordingNotSaved);
  };

  if (recorder && config.recording?.bar !== false) {
    stops.push(
      mountRecorderBar(recorder, {
        ...config.recording?.bar,
        ...(identity?.name ? { who: () => identity.name?.() ?? null } : {}),
        onFinish: (steps) => void finished(steps),
        onSaved: (result) => toast('saved' in result ? labels.recordingSaved : labels.recordingNotSaved),
      }),
    );
  }

  /** Someone new: a recording link waiting for them is picked up, and their own progress loaded. */
  let person: string | null | undefined;
  const notice = async (): Promise<boolean> => {
    const who = identity?.id ? identity.id() : 'someone';
    if (who === person) return !!who;
    const first = person === undefined;
    person = who;
    if (!who) return false;
    const refused = (await recorder?.resumeFromLink())?.reason;
    if (refused === 'expired') toast(labels.linkExpired);
    if (refused === 'not_allowed') toast(labels.linkNotAllowed);
    if (refused === 'invalid') toast(labels.linkInvalid);
    if (!first || identity?.id) await controller?.load();
    return true;
  };

  /** A new page: the last page's offer goes unanswered, and this page's comes once it has opened. */
  const offerHere = (url: string) => {
    controller?.clearOffer();
    clearTimeout(offerTimer);
    offerTimer = setTimeout(() => {
      void notice().then((someone) => {
        if (someone && !stopped) void controller?.offerFor(url);
      });
    }, OFFER_DELAY_MS);
  };

  const begin = async () => {
    try {
      await identity?.signedIn?.();
    } catch {
      return;
    }
    if (stopped) return;
    await notice();
    if (stopped || !router || !controller) return;
    stops.push(router.onNavigated(offerHere));
    offerHere(router.url());
  };
  if (browser && config.auto !== false) void begin();

  /** The bar comes up in this tab. */
  const here = (): RecordingStart | 'off' => {
    if (!recorder) return 'off';
    recorder.getReady();
    return 'here';
  };

  async function record(): Promise<RecordingStart | 'off' | 'refused'> {
    if (!recorder && !api) return 'off';
    controller?.clearOffer();
    const [link, known] = api?.serves('adminCreateRecordingLink') ? await Promise.all([api.admin.recordingLink(), api.admin.list()]) : [null, null];
    // No recording links here: the bar comes up in this tab.
    if (!link || (!link.ok && errorCode(link.error) === 'feature_off')) return here();
    if (!link.ok) {
      toast(labels.recordingRefused);
      return 'refused';
    }
    const started = startRecording((link.data as { url: string }).url);
    if (started === 'here') return here();
    if (started === 'blocked') toast(labels.allowPopups);
    if (started === 'tab' && api) {
      type Row = { walkthrough_id: string };
      const rows = (result: FlindersResult<unknown> | null) => (result?.ok ? (result.data as Row[]) : []);
      stopWatching?.();
      stopWatching = watchForRecording<Row>({ known: rows(known), list: async () => rows(await api.admin.list()), onDraft: (draft) => config.recording?.onDraft?.(draft as T['adminWalkthrough']) });
    }
    return started;
  }

  const attribute = config.player?.anchorAttribute;
  const elements = () => readElements({ ...(attribute ? { attribute } : {}), ...(config.meanings ? { meanings: config.meanings } : {}) });

  const features = {
    play: !!player,
    load: !!api,
    offers: !!(api && offers),
    recording: !!recorder,
    recordingLinks: !!recorder && linksOn,
    events: !!events,
    messages: !!config.toast,
  };
  const off = [
    ...(http ? [] : ['Loading and saving are off: no http connector.']),
    ...(player ? [] : ['Playing is off: no router connector.']),
    ...(identity ? [] : ['Walkthroughs behind a permission are off: no identity connector.']),
    ...(features.offers ? [] : ['Offers are off: needs http and offers connectors.']),
    ...(recorder ? [] : ['Recording is off: needs router.routePattern.']),
    ...(features.recordingLinks ? [] : ['Recording from another site is off: needs http, router.routePattern and the recording routes.']),
    ...(events ? [] : ['Events are off: no events connector.']),
    ...(config.toast ? [] : ['Messages to the person are off: no toast connector.']),
  ];

  return {
    player,
    controller,
    recorder,
    api,
    start: async (ref, from = 'list') => (await controller?.start(ref, from)) ?? false,
    record,
    hold: (on) => player?.hold?.(on),
    context: () => {
      const context = player?.context?.() ?? null;
      return context && { ...context, elements: elements() };
    },
    elements,
    showMe: (name, options) =>
      runShowMe(
        {
          url: () => router?.url() ?? '',
          navigate: async (url) => (await router?.navigate(url)) ?? false,
          point: async (element, card) => (await player?.showMe?.(element, card)) ?? false,
          warn: async (card) => (await player?.confirm?.(card)) ?? false,
          ...(config.hasUnsavedWork ? { hasUnsavedWork: () => config.hasUnsavedWork!() } : {}),
          labels,
          toast,
        },
        name,
        options,
      ),
    features,
    off,
    destroy() {
      stopped = true;
      stopWatching?.();
      stops.forEach((stop) => stop());
    },
  };
}

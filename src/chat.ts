import { modeLabel, walkthroughFirstRoute, walkthroughRoutes } from './logic.js';
import { matchRoute, type ReservedParams } from './routes.js';
import type { Walkthrough, WalkthroughLabels } from './types.js';
import { WALKTHROUGH_LABELS } from './types.js';

/** What someone asked for: the words that pick a walkthrough, and whether they want to do it themselves. */
export interface WalkthroughRequest {
  /** Empty = this page's, then all. A number or handle names one. */
  topic: string;
  mode?: 'guide';
}

/** A walkthrough a chat offers: a button that starts it from the beginning. */
export interface WalkthroughOption {
  id: string;
  title: string;
  /** Show me or Guide me. */
  label: string;
  /** Every route pattern the walkthrough visits (and where it's offered). */
  routes: string[];
  /** The first page it needs, or null when it can start anywhere. */
  firstRoute: string | null;
}

/** A chat's answer: what to say, and the buttons. No options = nothing matched, and `text` says so. */
export interface WalkthroughAnswer {
  text: string;
  options: WalkthroughOption[];
}

const REQUESTS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^(?:please\s+)?(?:(?:show me|start|restart|replay|play|open|run|give me)\s+(?:the\s+)?)?(?:walk ?through|tour|demo)\s+(?:#|no\.?\s*|number\s+)?(\d+(?:-[a-z0-9]+)*)(?:\s+again)?$/i,
    (m) => m[1] ?? '',
  ],
  [
    /^(?:please\s+)?(?:show me|start|restart|replay|play|open|run|give me)\s+(?:the\s+|a\s+)?(?:walk ?through|tour|demo)s?(?:\s+again)?(?:\s+(?:for|of|on|about)\s+(.+))?$/i,
    (m) => m[1] ?? '',
  ],
  [/^(?:please\s+)?(?:walk ?throughs?|tours?|demos?)(?:\s+(?:for|of|on|about)\s+(.+))?$/i, (m) => m[1] ?? ''],
  [/^(?:please\s+)?(?:show me|show me around|show me again|help me)$/i, () => ''],
  [/^(?:please\s+)?show me how (?:to|do i|i)\s+(.+)$/i, (m) => m[1] ?? ''],
];

const GUIDE = /^(?:please\s+)?guide me(?:\s+(?:through|to|on))?(?:\s+(?:the|a|an|how to))?(?:\s+(.+))?$/i;

function clean(text: string | undefined): string {
  return (text ?? '')
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
}

/**
 * A chat message asking for a walkthrough, or null: "show me", "walkthrough", "demo", "restart the
 * walkthrough", "show me how to add a note", "guide me through adding a note", or one by its number
 * or handle: "walkthrough 4", "start walkthrough 4-add-a-note" (the topic is then the number, which
 * picks it). May end in "?". Check it before anything else, so "show me" never means something else.
 */
export function parseWalkthroughRequest(text: string): WalkthroughRequest | null {
  const asked = text.trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
  const guide = asked.match(GUIDE);
  if (guide) return { topic: clean(guide[1]), mode: 'guide' };
  for (const [re, topic] of REQUESTS) {
    const m = asked.match(re);
    if (m) return { topic: clean(topic(m)) };
  }
  return null;
}

/** One walkthrough as a chat's button. */
export function walkthroughOption(
  w: Pick<Walkthrough, 'handle' | 'title' | 'mode' | 'offer_on' | 'steps'>,
  labels: Pick<WalkthroughLabels, 'show' | 'guide'> = WALKTHROUGH_LABELS,
): WalkthroughOption {
  return { id: w.handle, title: w.title, label: modeLabel(w.mode, labels), routes: walkthroughRoutes(w), firstRoute: walkthroughFirstRoute(w) };
}

/** The option is about this page. Worked out from the page the person is on now, so moving changes it. */
export function optionIsHere(option: Pick<WalkthroughOption, 'routes'>, url: string, reserved?: ReservedParams): boolean {
  return option.routes.some((r) => !!matchRoute(r, url, reserved));
}

/**
 * A chat's answer to a request, from `matchWalkthroughs`: "Guide me" asks for the doing kind, and
 * only when there's none does the reading kind answer.
 */
export function walkthroughAnswer<T extends Pick<Walkthrough, 'handle' | 'title' | 'mode' | 'offer_on' | 'steps'>>(
  matched: readonly { walkthrough: T; here: boolean }[],
  request: WalkthroughRequest,
  labels: Pick<WalkthroughLabels, 'show' | 'guide'> = WALKTHROUGH_LABELS,
): WalkthroughAnswer {
  const { topic, mode } = request;
  const guided = matched.filter((m) => m.walkthrough.mode === 'guide');
  const found = mode && guided.length ? guided : matched;
  if (!found.length) {
    return { text: topic ? `There’s no walkthrough about “${topic}” yet. Say “show me” to see them all.` : 'There are no walkthroughs yet.', options: [] };
  }
  const options = found.map(({ walkthrough }) => walkthroughOption(walkthrough, labels));
  const onPage = found.some((f) => f.here);
  return { options, text: `${options.length === 1 ? 'Here’s the walkthrough.' : topic ? 'Best match first.' : onPage ? 'This page’s walkthrough first.' : 'Here they are.'} It starts from the beginning.` };
}

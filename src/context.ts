/**
 * Chatting during a walkthrough. Flinders draws no chat, searches nothing and calls no AI: it says
 * where the person is, as plain JSON (`WalkthroughContext`). The product's chat does the rest.
 */
import type { WalkthroughMode } from './types.js';

/** A place on screen a chat can point at, and the words on it (`readElements`). */
export interface FlindersElement {
  name: string;
  /** Empty when the page has no safe words for it. */
  label: string;
}

/**
 * Where someone is in a walkthrough. Plain JSON, and the shape is a promise: `version` goes up if a
 * field changes meaning. It holds only the walkthrough's own authored words and route patterns, so
 * no personal data: it can't hold what anyone typed. `elements` alone comes from the page, and only
 * from buttons, links and `aria-label`s, added by `flinders.context()`.
 */
export interface WalkthroughContext {
  version: 1;
  walkthrough: { id: string; title: string; mode: WalkthroughMode };
  step: {
    /** As the card counts it: "2 of 5". */
    number: number;
    total: number;
    title: string;
    /** What the card says now, in plain text. */
    body: string;
    /** The anchor of the element highlighted; null when nothing is. */
    element: string | null;
  };
  /** The route pattern (`/projects/:projectId`), never a URL with ids; null when it isn't known. */
  page: string | null;
  /** The steps the person has done, in order. A step they skipped isn't here. */
  done: { number: number; title: string }[];
  /** The names on screen now, for `flindersshowme:`. */
  elements?: FlindersElement[];
  /** The articles most relevant here, as written in the file: this step's, then the walkthrough's, each once. */
  articles: string[];
}

import { createHmac, timingSafeEqual } from 'node:crypto';

import { RECORDING_LINK_PARAM } from './recording-tab.js';

/**
 * The server's half of recording when admin and the app are on different sites: a signed,
 * short-lived link that says one thing, "this person may record a walkthrough". It holds who created
 * it, when it expires and its purpose. It never signs anyone in, and it works only for the person
 * who created it (`checkRecordingLinkFor`), while they may still record.
 */

const PURPOSE = 'walkthrough-recording';
/** A link lasts 30 minutes. */
export const RECORDING_LINK_TTL_MS = 30 * 60 * 1000;
const MAX_LENGTH = 1024;

export interface RecordingLinkOptions {
  /** A server-side secret of your own. Never send it to a browser. */
  secret: string;
  /** Now, in milliseconds; for tests. */
  now?: number;
}

export interface RecordingLink {
  link: string;
  /** ISO timestamp. */
  expires_at: string;
}

/** not_allowed = genuine, but not this person's, or they may no longer record. */
export type RecordingLinkCheck = { valid: true; created_by: string; expires_at: string } | { valid: false; reason: 'invalid' | 'expired' | 'not_allowed' };

/** Who is asking. `mayRecord` is the product's own check, made on every use: created_by alone says who they were. */
export interface RecordingPerson {
  id: string;
  mayRecord(id: string): boolean | Promise<boolean>;
}

function sign(payload: string, secret: string): Buffer {
  if (!secret) throw new Error('A recording link needs a secret.');
  return createHmac('sha256', secret).update(`${PURPOSE}.${payload}`).digest();
}

/** A link for `createdBy` (an id, never a name or an email). */
export function createRecordingLink(createdBy: string, options: RecordingLinkOptions): RecordingLink {
  const expires = (options.now ?? Date.now()) + RECORDING_LINK_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ by: createdBy, exp: expires, purpose: PURPOSE })).toString('base64url');
  return { link: `${payload}.${sign(payload, options.secret).toString('base64url')}`, expires_at: new Date(expires).toISOString() };
}

/** Whether a link is genuine and in date, and who created it. */
export function checkRecordingLink(link: string, options: RecordingLinkOptions): RecordingLinkCheck {
  const invalid = { valid: false, reason: 'invalid' } as const;
  if (link.length > MAX_LENGTH) return invalid;
  const [payload, signature, extra] = link.split('.');
  if (!payload || !signature || extra !== undefined) return invalid;
  const expected = sign(payload, options.secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return invalid;
  let claims: { by?: unknown; exp?: unknown; purpose?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claims;
  } catch {
    return invalid;
  }
  if (claims.purpose !== PURPOSE || typeof claims.by !== 'string' || typeof claims.exp !== 'number') return invalid;
  if ((options.now ?? Date.now()) >= claims.exp) return { valid: false, reason: 'expired' };
  return { valid: true, created_by: claims.by, expires_at: new Date(claims.exp).toISOString() };
}

/** As `checkRecordingLink`, and only for the person who created the link, while they may still record. */
export async function checkRecordingLinkFor(link: string, person: RecordingPerson, options: RecordingLinkOptions): Promise<RecordingLinkCheck> {
  const check = checkRecordingLink(link, options);
  if (!check.valid) return check;
  return check.created_by === person.id && (await person.mayRecord(person.id)) ? check : { valid: false, reason: 'not_allowed' };
}

/**
 * A fresh link for someone a check just passed, so the clock runs from when they use it, not from
 * when Admin made it. Safe because a link only ever works for the person who created it.
 */
export function renewRecordingLink(check: Extract<RecordingLinkCheck, { valid: true }>, options: RecordingLinkOptions): RecordingLink {
  return createRecordingLink(check.created_by, options);
}

/** Whether this person may use a link now and, if so, a fresh one: what a tab's check hands back. */
export async function checkAndRenewRecordingLink(link: string, person: RecordingPerson, options: RecordingLinkOptions): Promise<RecordingLinkCheck & { link?: string }> {
  const check = await checkRecordingLinkFor(link, person, options);
  return check.valid ? { ...check, ...renewRecordingLink(check, options) } : check;
}

/**
 * The address to open in a new tab: `webUrl` with the link after the `#`. Browsers never send that
 * part, so the link stays out of web server and CDN logs.
 */
export function recordingLinkUrl(webUrl: string, link: string): string {
  const url = new URL(webUrl);
  url.hash = `${RECORDING_LINK_PARAM}=${link}`;
  return url.toString();
}

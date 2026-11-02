import { describe, expect, it } from 'vitest';

import { checkRecordingLink, checkRecordingLinkFor, createRecordingLink, fillRecordedWords, recordingFile, recordingLinkUrl, renewRecordingLink, RECORDING_LINK_TTL_MS } from '../src/server.js';

const secret = 'test-secret';
const now = Date.UTC(2026, 9, 30, 1, 0, 0);

describe('recording links', () => {
  it('says who created a genuine link, and when it expires, 30 minutes on', () => {
    const { link, expires_at } = createRecordingLink('person-1', { secret, now });
    expect(expires_at).toBe('2026-10-30T01:30:00.000Z');
    expect(checkRecordingLink(link, { secret, now: now + 60_000 })).toEqual({ valid: true, created_by: 'person-1', expires_at });
  });

  it('carries who, expiry and purpose, and nothing else', () => {
    const { link } = createRecordingLink('person-1', { secret, now });
    const claims = JSON.parse(Buffer.from(link.split('.')[0]!, 'base64url').toString()) as object;
    expect(Object.keys(claims).sort()).toEqual(['by', 'exp', 'purpose']);
  });

  it('refuses an expired link, at the exact moment too', () => {
    const { link } = createRecordingLink('person-1', { secret, now });
    expect(checkRecordingLink(link, { secret, now: now + RECORDING_LINK_TTL_MS })).toEqual({ valid: false, reason: 'expired' });
  });

  it('refuses another secret, a changed link, and rubbish', () => {
    const { link } = createRecordingLink('person-1', { secret, now });
    const [payload, signature] = link.split('.');
    const forged = Buffer.from(JSON.stringify({ by: 'person-2', exp: now + 1e9, purpose: 'walkthrough-recording' })).toString('base64url');
    for (const bad of [`${forged}.${signature}`, `${payload}.`, `.${signature}`, `${link}.x`, 'rubbish', '', 'a'.repeat(5000)]) {
      expect(checkRecordingLink(bad, { secret, now }), bad.slice(0, 20)).toEqual({ valid: false, reason: 'invalid' });
    }
    expect(checkRecordingLink(link, { secret: 'another', now })).toEqual({ valid: false, reason: 'invalid' });
  });

  it('works only for the person who created it, while they may still record', async () => {
    const { link, expires_at } = createRecordingLink('person-1', { secret, now });
    const options = { secret, now };
    expect(await checkRecordingLinkFor(link, { id: 'person-1', mayRecord: () => true }, options)).toEqual({ valid: true, created_by: 'person-1', expires_at });
    expect(await checkRecordingLinkFor(link, { id: 'person-2', mayRecord: () => true }, options)).toEqual({ valid: false, reason: 'not_allowed' });
    expect(await checkRecordingLinkFor(link, { id: 'person-1', mayRecord: async () => false }, options)).toEqual({ valid: false, reason: 'not_allowed' });
    expect(await checkRecordingLinkFor('rubbish', { id: 'person-1', mayRecord: () => true }, options)).toEqual({ valid: false, reason: 'invalid' });
  });

  it('a renewed link runs from now, for the same person', () => {
    const { link } = createRecordingLink('person-1', { secret, now });
    const later = now + 20 * 60 * 1000;
    const check = checkRecordingLink(link, { secret, now: later });
    if (!check.valid) throw new Error('should be valid');
    const renewed = renewRecordingLink(check, { secret, now: later });
    expect(renewed.expires_at).toBe('2026-10-30T01:50:00.000Z');
    expect(checkRecordingLink(renewed.link, { secret, now: later })).toMatchObject({ valid: true, created_by: 'person-1' });
  });

  it('won’t sign without a secret', () => {
    expect(() => createRecordingLink('person-1', { secret: '' })).toThrow();
  });

  it('puts the link after the #, which browsers never send to a server', () => {
    expect(recordingLinkUrl('https://app.example.test', 'a.b')).toBe('https://app.example.test/#flinders_record=a.b');
  });

  it('makes a file that uploads like any other, from recorded steps', () => {
    expect(recordingFile([{ title: '', body: '' }])).toEqual({ slug: 'recorded-walkthrough', title: 'Recorded walkthrough', mode: 'guide', steps: [{ title: 'Untitled step', body: 'Say what to do here.' }] });
  });

  it('fills blank words so a recorded step can be saved, and keeps written ones', () => {
    expect(fillRecordedWords([{ title: '', body: '' }, { title: 'Mine', body: 'Said' }])).toEqual([
      { title: 'Untitled step', body: 'Say what to do here.' },
      { title: 'Mine', body: 'Said' },
    ]);
  });
});

/**
 * The conformance kit against the reference server, on real Postgres: it needs
 * FLINDERS_TEST_DATABASE_URL, and those are skipped without it. The kit is proved both ways: the
 * reference passes everything, and a backend that breaks a rule fails that rule.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { REFERENCE_SECRET, signIn, startReferenceServer, type ReferenceOptions } from '../conformance/reference/server.js';
import { formatReport, parseCli } from '../conformance/cli.js';
import { RULES, runConformance, type ConformanceReport } from '../conformance/runner.js';
import { responseProblem } from './contract.js';

const url = process.env['FLINDERS_TEST_DATABASE_URL'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function against(tamper?: ReferenceOptions['tamper'], only?: string[]): Promise<ConformanceReport> {
  const server = await startReferenceServer({ databaseUrl: url!, ...(tamper ? { tamper } : {}) });
  try {
    return await runConformance({ url: server.url, signIn, recordingSecret: REFERENCE_SECRET, ...(only ? { only } : {}) });
  } finally {
    await server.close();
  }
}

const failedIn = (report: ConformanceReport) => report.results.filter((r) => r.status === 'failed').map((r) => r.id);

describe.skipIf(!url)('the reference server', () => {
  it('passes every rule, and every answer fits the contract', async () => {
    const server = await startReferenceServer({ databaseUrl: url! });
    const problems: string[] = [];
    const seen = new Set<string>();
    try {
      const report = await runConformance({
        url: server.url,
        signIn,
        recordingSecret: REFERENCE_SECRET,
        onResponse: (route, status, body) => {
          seen.add(route);
          const problem = responseProblem(route, status, body);
          if (problem) problems.push(problem);
        },
      });
      expect(formatReport(report)).toBe(`${RULES.length} passed, 0 failed, 0 skipped.`);
    } finally {
      await server.close();
    }
    expect([...new Set(problems)]).toEqual([]);
    expect(seen.size).toBe(12);
  }, 60_000);

  it('follows a backend’s own paths, and one with no stats route', async () => {
    const server = await startReferenceServer({ databaseUrl: url!, rewrite: (path) => (path === '/tours' ? '/walkthroughs' : path === '/me' ? '/progress' : path) });
    try {
      const report = await runConformance({ url: server.url, signIn, paths: { listWalkthroughs: '/tours', getMyProgress: '/me', adminStats: null }, only: ['progress.one-row', 'list', 'stats'] });
      expect(report).toMatchObject({ ok: true, passed: 4 });
    } finally {
      await server.close();
    }
  });

  it('runs from the command line', async () => {
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.conformance.json'], { cwd: ROOT, stdio: 'pipe' });
    const server = await startReferenceServer({ databaseUrl: url! });
    try {
      const users = (['admin', 'person', 'person2'] as const).flatMap((user) => ['--user', `${user}=authorization: Bearer ${user}`]);
      const args = ['bin/flinders-conformance.mjs', '--url', server.url, ...users, '--user', 'other-admin=authorization: Bearer otherAdmin', '--recording-secret', REFERENCE_SECRET];
      const run = await promisify(execFile)(process.execPath, args, { cwd: ROOT }).catch((err: { stdout: string }) => err);
      expect(run.stdout.trim()).toBe(`${RULES.length} passed, 0 failed, 0 skipped.`);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('skips what it has no way to check, and says why', async () => {
    const server = await startReferenceServer({ databaseUrl: url! });
    try {
      const report = await runConformance({ url: server.url, signIn: (user) => (user === 'otherAdmin' ? null : signIn(user)), only: ['numbering.per-owner', 'owners', 'recording.expired'] });
      expect(report.results.map((r) => [r.id, r.status, r.detail])).toEqual([
        ['numbering.per-owner', 'skipped', 'needs the otherAdmin test user'],
        ['owners.no-leak', 'skipped', 'needs the otherAdmin test user'],
        ['recording.expired', 'skipped', 'needs recordingSecret or expireLink'],
      ]);
      expect(report.ok).toBe(true);
    } finally {
      await server.close();
    }
  });

  describe('fails a backend that breaks a rule', () => {
    /** Each: the rules to run, how the backend misbehaves, and the rule that must catch it. */
    const broken: [string, string[], NonNullable<ReferenceOptions['tamper']>, string][] = [
      ['nobody signed in gets an answer', ['auth'], (_q, a) => (a.status === 401 ? { status: 200, body: {} } : a), 'auth.signed-in'],
      ['anyone can use admin', ['auth'], (_q, a) => (a.status === 403 ? { status: 200, body: {} } : a), 'auth.admin-only'],
      [
        'finishing is taken back by Not now',
        ['progress.completed-stays'],
        (q, a) => {
          if (!(q.body as { event?: string } | undefined)?.event || (q.body as { event: string }).event !== 'dismissed') return a;
          const body = structuredClone(a.body) as { progress: Record<string, { status: string }> };
          for (const row of Object.values(body.progress)) row.status = 'dismissed';
          return { ...a, body };
        },
        'progress.completed-stays',
      ],
      [
        'a stack trace in an error',
        ['validation.file'],
        (_q, a) => (a.status === 400 ? { ...a, body: { error: { code: 'validation_failed', message: 'ZodError: at parse (server.js:10:2)' } } } : a),
        'validation.file',
      ],
      ['a newer file is saved', ['format.newer'], (q, a) => ((q.body as { format_version?: number } | undefined)?.format_version === 2 ? { status: 201, body: {} } : a), 'format.newer'],
      ['a draft is served', ['upload'], (q, a) => (q.path === '/admin/walkthroughs' && q.method === 'POST' ? { ...a, body: { ...(a.body as object), status: 'live' } } : a), 'upload.always-draft'],
      ['stats miscount', ['stats'], (q, a) => (q.path.endsWith('/stats') ? { ...a, body: { ...(a.body as object), people: 3 } } : a), 'stats.counts'],
      [
        'an expired link is good',
        ['recording.expired'],
        (_q, a) => ((a.body as { reason?: string }).reason === 'expired' ? { ...a, body: { valid: true } } : a),
        'recording.expired',
      ],
      [
        'placeholders go live',
        ['placeholders'],
        (q, a) => (q.path.endsWith('/versions') && a.status === 400 ? { status: 201, body: {} } : a),
        'placeholders.not-live',
      ],
    ];
    it.each(broken)('%s', async (_name, only, tamper, rule) => {
      expect(failedIn(await against(tamper, only))).toContain(rule);
    });
  });
});

describe('the kit on its own', () => {
  it('reports a backend it can’t reach as failed, rule by rule, and doesn’t stop', async () => {
    const report = await runConformance({ url: 'http://127.0.0.1:1/flinders', signIn: () => ({}), only: ['numbering'] });
    expect(report.ok).toBe(false);
    expect(report.failed).toBeGreaterThan(1);
  });

  it('reads a command line', () => {
    expect(
      parseCli(['--url', 'http://localhost:3000/flinders', '--user', 'admin=Authorization: Bearer a', '--user', 'other-admin=x-user: b', '--recording-secret', 's', '--permission', 'edit_templates', '--offer-on', '/home', '--only', 'recording', '--json']),
    ).toEqual({
      url: 'http://localhost:3000/flinders',
      json: true,
      users: { admin: { Authorization: 'Bearer a' }, otherAdmin: { 'x-user': 'b' } },
      recordingSecret: 's',
      permission: 'edit_templates',
      offerOn: '/home',
      only: ['recording'],
    });
  });

  it('says what’s wrong with a command line', () => {
    expect(() => parseCli([])).toThrow('--url is required');
    expect(() => parseCli(['--url', 'x'])).toThrow('Say how to sign in');
    expect(() => parseCli(['--url', 'x', '--user', 'boss=a: b'])).toThrow('--user takes');
    expect(() => parseCli(['--nonsense'])).toThrow('Unknown option');
  });

  it('prints failures with why, then the count', () => {
    const report: ConformanceReport = {
      ok: false,
      passed: 1,
      failed: 1,
      skipped: 0,
      results: [
        { id: 'a.b', title: 'Holds', status: 'passed' },
        { id: 'c.d', title: 'Doesn’t', status: 'failed', detail: 'expected 1, got 2' },
      ],
    };
    expect(formatReport(report)).toBe('FAIL  c.d: Doesn’t\n      expected 1, got 2\n\n1 passed, 1 failed, 0 skipped.');
  });
});

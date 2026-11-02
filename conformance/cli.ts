/** `flinders-conformance`: the kit on the command line. Exits 0 when the backend passes, 1 when it doesn't, 2 when it couldn't run. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runConformance, type ConformanceOptions, type ConformanceReport, type TestUser } from './runner.js';

const USAGE = `Usage: flinders-conformance --url <base> (--user <name>="<header>: <value>" ... | --sign-in <file.mjs>)

  --url <base>              The backend, base included: http://localhost:3000/flinders
  --user <name>=<header>    A request header that signs in a test user: admin, person,
                            person2, other-admin. Repeatable.
  --sign-in <file.mjs>      Or a module whose default export is async (user) => headers.
  --paths <file.json>       The backend's own paths, by route name.
  --recording-secret <s>    Its recording secret, on a test server: checks link expiry.
  --permission <name>       A permission it accepts, if it checks them against its own list.
  --offer-on <page>         A page it accepts as offer_on, if it checks them against its routes.
  --only <prefix>           Only rules starting with this. Repeatable.
  --json                    The report as JSON.
`;

const USER_NAMES: Record<string, TestUser> = { admin: 'admin', person: 'person', person2: 'person2', 'other-admin': 'otherAdmin' };

export interface CliOptions extends Omit<ConformanceOptions, 'signIn'> {
  json: boolean;
  users: Partial<Record<TestUser, Record<string, string>>>;
  signInModule?: string;
}

class UsageError extends Error {}

/** The options a command line gives. Throws a message for anything it can't read. */
export function parseCli(args: readonly string[]): CliOptions {
  const options: CliOptions = { url: '', json: false, users: {} };
  const only: string[] = [];
  const value = (i: number): string => {
    const next = args[i + 1];
    if (next === undefined) throw new UsageError(`${args[i]} needs a value`);
    return next;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--url') options.url = value(i++);
    else if (arg === '--sign-in') options.signInModule = value(i++);
    else if (arg === '--recording-secret') options.recordingSecret = value(i++);
    else if (arg === '--permission') options.permission = value(i++);
    else if (arg === '--offer-on') options.offerOn = value(i++);
    else if (arg === '--only') only.push(value(i++));
    else if (arg === '--paths') options.paths = JSON.parse(readFileSync(value(i++), 'utf8')) as ConformanceOptions['paths'];
    else if (arg === '--user') {
      const m = /^([a-z0-9-]+)=([^:]+):\s*(.*)$/.exec(value(i++));
      const user = m && USER_NAMES[m[1]!];
      if (!m || !user) throw new UsageError(`--user takes admin, person, person2 or other-admin, as name="header: value"`);
      options.users[user] = { ...options.users[user], [m[2]!.trim()]: m[3]! };
    } else throw new UsageError(`Unknown option: ${arg}`);
  }
  if (!options.url) throw new UsageError('--url is required');
  if (!options.signInModule && !Object.keys(options.users).length) throw new UsageError('Say how to sign in: --user or --sign-in');
  return { ...options, ...(only.length ? { only } : {}) };
}

/** The report as a person reads it: failures with why, and what wasn't checked. */
export function formatReport(report: ConformanceReport): string {
  const lines = report.results.filter((r) => r.status !== 'passed').map((r) => `${r.status === 'failed' ? 'FAIL' : 'skip'}  ${r.id}: ${r.title}\n      ${r.detail}`);
  return [...lines, ...(lines.length ? [''] : []), `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped.`].join('\n');
}

export async function main(args: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCli(args);
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : err}\n\n${USAGE}`);
    return 2;
  }
  const { json, users, signInModule, ...rest } = options;
  try {
    const module = signInModule ? ((await import(pathToFileURL(resolve(signInModule)).href)) as { default: ConformanceOptions['signIn'] }) : null;
    const report = await runConformance({ ...rest, signIn: module ? module.default : (user) => users[user] ?? null });
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.ok ? 0 : 1;
  } catch (err) {
    console.error(`The kit couldn’t run: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
}

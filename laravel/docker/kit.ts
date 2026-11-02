/**
 * Runs the conformance kit against the Laravel test app, checks every answer against the contract,
 * and then checks what the kit can't: the same refusal words as the TypeScript schema, numbering
 * under load, and the database's own append-only rule.
 */
import { formatReport } from '../../conformance/cli.js';
import { runConformance, RULES } from '../../conformance/runner.js';
import { createFileSchema, describeSchemaError } from '../../src/repository.js';
import { responseProblem } from '../../test/contract.js';

const url = process.argv[2]!;
const signIn = (user: string) => ({ authorization: `Bearer ${user}` });
const say = (what: string, good: boolean, detail = '') => {
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${what}${detail && !good ? `: ${detail}` : ''}`);
  if (!good) process.exitCode = 1;
};

const seen = new Set<string>();
const problems: string[] = [];
const report = await runConformance({
  url,
  signIn,
  recordingSecret: 'conformance-secret',
  onResponse: (route, status, body) => {
    seen.add(route);
    const problem = responseProblem(route, status, body);
    if (problem) problems.push(problem);
  },
});
console.log(formatReport(report));
say(`all ${RULES.length} rules passed, none skipped`, report.passed === RULES.length);
say('every answer fits contract/openapi.yaml', problems.length === 0, [...new Set(problems)].slice(0, 5).join('\n'));
say('all 12 routes were called', seen.size === 12, String(seen.size));

const post = (body: unknown, path = '/admin/walkthroughs') =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...signIn('admin') }, body: JSON.stringify(body) });

// The same words as the TypeScript schema, for a bad file of every kind.
const step = { anchor: null, title: 'T', body: 'B', missing: 'centred' };
const file = (over: object) => ({ slug: 'a', title: 'A', steps: [step], ...over });
const stepWith = (over: object) => file({ steps: [{ ...step, ...over }] });
const bad: unknown[] = [
  {}, [], 'text', null, { slug: 5 }, { slug: 'a' }, file({ title: '   ' }), file({ title: 'x'.repeat(121) }), file({ steps: {} }), file({ steps: new Array(31).fill(step) }),
  file({ slug: 'a\n' }), file({ mode: 'x' }), file({ mode: 5 }), file({ number: 1.5 }), file({ format_version: 'x' }), file({ format_version: 0 }), file({ offer_on: 'x' }),
  stepWith({ anchor: 'BAD' }), stepWith({ anchor: 5 }), stepWith({ title: '' }), stepWith({ side: 'x' }), stepWith({ help_after: 0 }), stepWith({ help_after: 1.5 }), stepWith({ extra: 1 }),
  stepWith({ done_when: 'x' }), stepWith({ done_when: {} }), stepWith({ done_when: { kind: 'x' } }), stepWith({ done_when: { kind: 'appears' } }), stepWith({ done_when: { kind: 'clicked', anchor: 'a' } }),
  stepWith({ only_if: 5 }), stepWith({ only_if: 'BAD' }), stepWith({ only_if: [] }), stepWith({ only_if: ['BAD'] }), stepWith({ only_if: ['a', 'b', 'c', 'd', 'e', 'f'] }),
  stepWith({ phone: 'x' }), stepWith({ phone: { title: '' } }), stepWith({ phone: { x: 1 } }), stepWith({ phone: { side: 'x' } }), stepWith({ phone: [] }),
  stepWith({ missing: 'x' }), stepWith({ missing: { alt: 'BAD' } }), stepWith({ missing: { x: 1 } }), stepWith({ missing: [] }), stepWith({ missing: null }),
  stepWith({ blocked: [{ anchor: 'a' }] }), stepWith({ blocked: {} }), stepWith({ title: 'é'.repeat(81) }), stepWith({ title: '😀'.repeat(41) }),
];
const schema = createFileSchema();
const differ: string[] = [];
for (const each of bad) {
  const expected = schema.safeParse(each);
  const answer = (await (await post(each)).json()) as { error?: { message: string } };
  const want = expected.success ? '(saved)' : describeSchemaError(expected.error);
  if ((answer.error?.message ?? '(saved)') !== want) differ.push(`${JSON.stringify(each).slice(0, 80)}\n   node: ${want}\n   php:  ${answer.error?.message}`);
}
say(`the same refusal as TypeScript for ${bad.length} bad files`, differ.length === 0, `\n${differ.join('\n')}`);

// Empty objects stay objects, words are trimmed, and the file comes back as saved.
const good = file({ slug: 'round-trip', title: '  Padded  ', steps: [{ ...step, title: ' Padded ', phone: {}, missing: {}, blocked: [] }] });
const saved = (await (await post(good)).json()) as { walkthrough_id: string };
const detail = (await (await fetch(`${url}/admin/walkthroughs/${saved.walkthrough_id}`, { headers: signIn('admin') })).json()) as { versions: { title: string; steps: unknown }[] };
const parsed = schema.parse(good);
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort().map(([k, x]) => [k, sorted(x)])) : v);
say('a saved file reads back as TypeScript parsed it', detail.versions[0]!.title === parsed.title && JSON.stringify(sorted(detail.versions[0]!.steps)) === JSON.stringify(sorted(parsed.steps)), JSON.stringify(detail.versions[0]!.steps));

// Numbers and versions under load: the lock, not luck.
const raced = (await Promise.all(Array.from({ length: 24 }, (_, n) => post(file({ slug: `race-${n}` })).then((r) => r.json() as Promise<{ number: number }>)))).map((r) => r.number).sort((a, b) => a - b);
say('24 uploads at once take 24 numbers in a row', new Set(raced).size === 24 && raced[23]! - raced[0]! === 23, raced.join(' '));
const first = (await (await post(file({ slug: 'race' }))).json()) as { walkthrough_id: string };
const copies = await Promise.all(Array.from({ length: 12 }, () => post({ from_version: 1, status: 'inactive' }, `/admin/walkthroughs/${first.walkthrough_id}/versions`).then((r) => r.json() as Promise<{ version: number }>)));
const versions = copies.map((c) => c.version).sort((a, b) => a - b);
say('12 saves at once take 12 versions in a row', versions[0] === 2 && versions[11] === 13 && new Set(versions).size === 12, versions.join(' '));

// The database itself refuses.
const rule = (await (await fetch(url.replace('/flinders', '/_rig/append-only'))).json()) as { rows: number; rows_after: number; update_refused: boolean; delete_refused: boolean };
say('MySQL refuses an UPDATE or DELETE on the versions table', rule.update_refused && rule.delete_refused && rule.rows === rule.rows_after && rule.rows > 0, JSON.stringify(rule));

// Features left off answer 501, a bad body still comes first, and the default Connectors' lists work.
const defaults = JSON.stringify(await (await fetch(url.replace('/flinders', '/_rig/defaults'))).json());
say(
  'features left off say so',
  defaults === JSON.stringify({ offers: '501 feature_off', offers_bad_body_first: '400 validation_failed', link: '501 feature_off', check: '501 feature_off', save: '501 feature_off', offers_default_on: true, listed: [true, false] }),
  defaults,
);

const unknown = await fetch(`${url}/no-such-route`, { headers: signIn('admin') });
const wrong = await fetch(`${url}/walkthroughs`, { method: 'DELETE', headers: signIn('admin') });
say('unknown routes and methods answer in the error shape', unknown.status === 404 && wrong.status === 405 && !!((await wrong.json()) as { error?: unknown }).error);

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

import { createFileSchema, createWalkthroughRepository, describeSchemaError, WalkthroughFileError, WALKTHROUGH_FORMAT_VERSION } from '../src/server.js';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'walkthrough.schema.json');
const jsonSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validate = new Ajv({ strict: true, allowUnionTypes: true }).compile(jsonSchema);
const zodSchema = createFileSchema();

const step = { anchor: 'save-button', title: 'Save', body: 'Saves your work.', missing: 'centred' };
const file = () => ({ slug: 'first-steps', title: 'First steps', steps: [step] });
const withFile = (over: object) => ({ ...file(), ...over });
const withStep = (over: object) => withFile({ steps: [{ ...step, ...over }] });
const without = (key: string) => Object.fromEntries(Object.entries(file()).filter(([k]) => k !== key));

const good: Record<string, unknown> = {
  'the least a file needs': file(),
  'format 1 said out loud': withFile({ format_version: 1 }),
  'every file field': withFile({ format_version: 1, number: 7, mode: 'guide', article: 'getting-started', permission: 'reports.edit', offer_on: '/projects/:id', reoffer_from: 2, status: 'live' }),
  'article hints of any kind': withFile({ articles: ['https://help.example.com/a', 'an id', 'x'.repeat(500), 'a', 'b'], steps: [{ ...step, articles: ['slug'] }] }),
  'no article hints': withFile({ articles: [], steps: [{ ...step, articles: [] }] }),
  'nulls where allowed': withFile({ article: null, permission: null, offer_on: null }),
  'a centred step': withStep({ anchor: null }),
  'every step field': withStep({
    route: '/projects/:id',
    side: 'left',
    align: 'center',
    wait_for: 'person',
    advance_on_click: true,
    optional: true,
    help_after: 120,
    blocked: [{ anchor: 'no-data', title: 'Blocked', body: 'Connect a data source first.' }],
    phone: { anchor: null, title: 'Tap', body: 'Tap save.', side: 'top' },
    missing: { alt: 'other-button', body: 'Look here instead.' },
  }),
  'phone skipped': withStep({ phone: 'skip' }),
  'an empty phone': withStep({ phone: {} }),
  'missing ends it': withStep({ missing: 'end' }),
  'done when clicked': withStep({ done_when: { kind: 'clicked' } }),
  'done when it appears': withStep({ done_when: { kind: 'appears', anchor: 'saved-toast' } }),
  'done when on a page': withStep({ done_when: { kind: 'route', route: '/done' } }),
  'thirty steps': withFile({ steps: Array.from({ length: 30 }, () => step) }),
};

const bad: Record<string, unknown> = {
  'not an object': [],
  'no slug': without('slug'),
  'no title': without('title'),
  'no steps': without('steps'),
  'an unknown field': withFile({ owner: 'someone' }),
  'format 0': withFile({ format_version: 0 }),
  'a format that is not whole': withFile({ format_version: 1.5 }),
  'a format as text': withFile({ format_version: '1' }),
  'six article hints': withFile({ articles: ['1', '2', '3', '4', '5', '6'] }),
  'six article hints on a step': withStep({ articles: ['1', '2', '3', '4', '5', '6'] }),
  'a blank article hint': withFile({ articles: [''] }),
  'an article hint too long': withStep({ articles: ['x'.repeat(501)] }),
  'an article hint that is not text': withFile({ articles: [1] }),
  'one article hint as text': withFile({ articles: 'a' }),
  'a newer format': withFile({ format_version: WALKTHROUGH_FORMAT_VERSION + 1 }),
  'number 0': withFile({ number: 0 }),
  'number too big': withFile({ number: 1_000_000_000 }),
  'a capital in the slug': withFile({ slug: 'First' }),
  'a blank title': withFile({ title: '   ' }),
  'a title too long': withFile({ title: 'x'.repeat(121) }),
  'an unknown mode': withFile({ mode: 'play' }),
  'an unknown status': withFile({ status: 'archived' }),
  'offer_on not a route': withFile({ offer_on: 'projects' }),
  'an empty permission': withFile({ permission: '' }),
  'no steps in the list': withFile({ steps: [] }),
  'thirty-one steps': withFile({ steps: Array.from({ length: 31 }, () => step) }),
  'a capital in an anchor': withStep({ anchor: 'Save' }),
  'an anchor with a double dash': withStep({ anchor: 'save--button' }),
  'an anchor too long': withStep({ anchor: 'x'.repeat(81) }),
  'a step with no anchor key': { ...file(), steps: [{ title: 'a', body: 'b', missing: 'end' }] },
  'a step with no missing': { ...file(), steps: [{ anchor: null, title: 'a', body: 'b' }] },
  'an unknown step field': withStep({ colour: 'red' }),
  'a blank step body': withStep({ body: ' ' }),
  'a step body too long': withStep({ body: 'x'.repeat(401) }),
  'a route without a slash': withStep({ route: 'projects' }),
  'an unknown side': withStep({ side: 'middle' }),
  'help_after 0': withStep({ help_after: 0 }),
  'help_after too long': withStep({ help_after: 121 }),
  'six blocks': withStep({ blocked: Array.from({ length: 6 }, () => ({ anchor: 'a', body: 'b' })) }),
  'a block with no body': withStep({ blocked: [{ anchor: 'a' }] }),
  'an unknown phone word': withStep({ phone: 'hide' }),
  'an unknown phone field': withStep({ phone: { route: '/x' } }),
  'an unknown missing word': withStep({ missing: 'skip' }),
  'an unknown done_when kind': withStep({ done_when: { kind: 'hovered' } }),
  'appears with no anchor': withStep({ done_when: { kind: 'appears' } }),
  'route with no route': withStep({ done_when: { kind: 'route' } }),
  'clicked with an anchor': withStep({ done_when: { kind: 'clicked', anchor: 'a' } }),
};

describe('the published JSON Schema matches the file schema', () => {
  it.each(Object.entries(good))('both accept: %s', (_name, sample) => {
    expect(zodSchema.safeParse(sample).success, 'zod').toBe(true);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(Object.entries(bad))('both refuse: %s', (_name, sample) => {
    expect(zodSchema.safeParse(sample).success, 'zod').toBe(false);
    expect(validate(sample), 'JSON Schema').toBe(false);
  });

  it('says the same newest format as the package', () => {
    expect(jsonSchema.properties.format_version.maximum).toBe(WALKTHROUGH_FORMAT_VERSION);
  });

  it('lists every field the file schema has', () => {
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(Object.keys(zodSchema.shape).sort());
  });
});

describe('format_version', () => {
  it('is 1 when a file leaves it out', () => {
    expect(zodSchema.parse(file()).format_version).toBe(1);
  });

  it('refuses a newer file with a plain message, even when the rest is unreadable', () => {
    const newer = { format_version: 2, slug: 'first-steps', hints: true, steps: [{ shiny: true }] };
    const parsed = zodSchema.safeParse(newer);
    expect(parsed.success).toBe(false);
    expect(describeSchemaError(parsed.error!)).toBe('format_version: this file is format 2, but this version of the package only reads up to format 1. Update the package to use it.');
  });

  it('is never saved, so adding it to a file changes nothing', async () => {
    const saved: string[] = [];
    const q = async (text: string, params?: unknown[]) => {
      if (text.startsWith('INSERT')) saved.push(params![3] as string);
      return text.startsWith('INSERT') ? [{ walkthrough_id: 'w1', number: 1 }] : [];
    };
    const repository = createWalkthroughRepository({
      tables: { versions: 'walkthroughs', progress: 'walkthroughs_progress' },
      app: { anchorExists: () => true, routeExists: () => true },
    });
    await repository.saveFile(q, withFile({ format_version: 1 }), { createdBy: null });
    await repository.saveFile(q, file(), { createdBy: null });
    expect(saved[0]).toBe(saved[1]);
    expect(saved[0]).not.toContain('format_version');
  });

  it('an upload of a newer file is refused with that message', async () => {
    const repository = createWalkthroughRepository({
      tables: { versions: 'walkthroughs', progress: 'walkthroughs_progress' },
      app: { anchorExists: () => true, routeExists: () => true },
    });
    await expect(repository.saveFile(async () => [], withFile({ format_version: 2 }), { createdBy: null })).rejects.toThrow(WalkthroughFileError);
  });
});

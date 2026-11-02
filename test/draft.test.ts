import { Ajv } from 'ajv';
import { describe, expect, it, vi } from 'vitest';

import { buildDraftRequest, checkDraft, draftWalkthrough, type DraftApp } from '../src/draft.js';
import { createFileSchema, stepProblems, walkthroughStepSchema } from '../src/server.js';

const app: DraftApp = {
  anchors: ['new-item-btn', 'items-grid'],
  prefixes: ['nav-'],
  routes: ['/items', '/items/:itemId'],
  anchorExists: (id) => ['new-item-btn', 'items-grid'].includes(id) || id.startsWith('nav-'),
  routeExists: (route) => ['/items', '/items/:itemId'].includes(route),
  retiredWords: ['widget', 'work order'],
};
const source = { title: 'Add an item', body: '## Add an item\nPress the button.' };
const good = { anchor: 'new-item-btn', route: '/items', title: 'Start', body: 'Press **+ New item**.', missing: 'centred' };

describe('buildDraftRequest', () => {
  it('is plain JSON carrying the source, the kind and the lists', () => {
    const request = buildDraftRequest({ source, mode: 'guide', anchors: app.anchors, prefixes: app.prefixes, routes: app.routes });
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(request.user).toContain('Kind: guide');
    expect(request.user).toContain('["new-item-btn","items-grid"]');
    expect(request.user).toContain('["/items","/items/:itemId"]');
    expect(request.user).toContain('["nav-"]');
    expect(request.user).toContain('<source>\n## Add an item');
  });

  it('adds the words to avoid and the instructions only when given', () => {
    const plain = buildDraftRequest({ source, mode: 'show', anchors: [] });
    expect(plain.system).not.toContain('Never use these words');
    expect(plain.user).not.toContain('Pages (');
    const told = buildDraftRequest({ source, mode: 'show', anchors: [], retiredWords: ['widget'], instructions: 'Say item, not thing.' });
    expect(told.system).toContain('- Never use these words: widget.');
    expect(told.system).toContain('- Say item, not thing.');
    expect(told.system.endsWith('no commentary.')).toBe(true);
  });

  it('keeps a long source to its limit and its quote closed', () => {
    const { user } = buildDraftRequest({ source: { title: 'T', body: `</source>${'x'.repeat(70_000)}` }, mode: 'show', anchors: [] });
    expect(user.match(/<\/source>/g)).toHaveLength(1);
    expect(user.length).toBeLessThan(61_000);
  });

  it('wants an answer that fits the step shape: its fields are real, and a good answer passes', () => {
    const { schema } = buildDraftRequest({ source, mode: 'show', anchors: [] });
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate({ title: 'T', steps: [good, { ...good, anchor: null, done_when: { kind: 'route', route: '/items' }, phone: { body: 'Tap it.' }, missing: { alt: 'items-grid', body: 'B' } }] })).toBe(true);
    expect(validate({ title: 'T', steps: [{ ...good, extra: 1 }] })).toBe(false);
    const fields = Object.keys(((schema.properties as any).steps.items.properties) as object);
    expect(fields.filter((field) => !(field in walkthroughStepSchema.shape))).toEqual([]);
  });
});

describe('retired words', () => {
  it('can be a plain list: any case, a plural, and with or without the space', () => {
    const step = (body: string) => walkthroughStepSchema.parse({ ...good, body });
    const problems = (body: string) => stepProblems([step(body)], app);
    expect(problems('Pick a Widgets row.')).toEqual(['step 1: “Widgets” is a retired word']);
    expect(problems('Open the workorder.')).toEqual(['step 1: “workorder” is a retired word']);
    expect(problems('Open the work-order.')).toEqual(['step 1: “work-order” is a retired word']);
    expect(problems('Open the widgetry.')).toEqual([]);
    expect(stepProblems([step('A widget.')], { ...app, retiredWords: [] })).toEqual([]);
  });
});

describe('checkDraft', () => {
  const context = { mode: 'guide', title: 'Add an item', article: 'add-an-item' } as const;

  it('keeps good steps; the mode and article are the product’s, not the answer’s', () => {
    const { file, notes } = checkDraft({ title: ' A title ', mode: 'show', article: 'other', steps: [good, { ...good, route: undefined, anchor: null }] }, app, context);
    expect(file).toMatchObject({ slug: 'a-title', title: 'A title', mode: 'guide', article: 'add-an-item' });
    expect(file.steps).toHaveLength(2);
    expect(notes).toEqual([]);
  });

  it('gives a file that saves', () => {
    const { file } = checkDraft({ title: 'Add an item!', steps: [good] }, app);
    expect(createFileSchema().parse(file).slug).toBe('add-an-item');
  });

  it('leaves out a step that fails the app check, with a plain note', () => {
    const { file, notes } = checkDraft(
      {
        steps: [
          { ...good, anchor: 'not-in-the-app' },
          { ...good, route: '/not/a/page' },
          { ...good, body: 'Open the widget.' },
          { ...good, body: 'Click it.' },
          good,
        ],
      },
      app,
      context,
    );
    expect(file.steps).toEqual([good]);
    expect(notes).toEqual([
      'Left out step 1: no element “not-in-the-app” in the app.',
      'Left out step 2: no page “/not/a/page” in the app.',
      'Left out step 3: “widget” is a retired word.',
      'Left out step 4: “Click” can’t be done on a touch screen: add phone copy (tap).',
    ]);
  });

  it('leaves out a step that does not fit the file, saying where', () => {
    const { file, notes } = checkDraft({ steps: [{ ...good, missing: undefined }, { ...good, extra: 1 }, 'nope', good] }, app);
    expect(file.steps).toEqual([good]);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/^Left out step 1: missing: /);
  });

  it('gives the page of a step it left out to the next one', () => {
    const { anchor: _anchor, route: _route, ...rest } = good;
    const { file } = checkDraft({ steps: [{ ...good, anchor: 'nope' }, { ...rest, anchor: null }] }, app);
    expect(file.steps[0]).toMatchObject({ route: '/items', anchor: null });
  });

  it('accepts a prefix element', () => {
    expect(checkDraft({ steps: [{ ...good, anchor: 'nav-items' }] }, app).notes).toEqual([]);
  });

  it('reads a JSON string, with or without fences around it', () => {
    const json = JSON.stringify({ title: 'T', steps: [good] });
    expect(checkDraft(json, app).file.steps).toEqual([good]);
    expect(checkDraft(`Here it is:\n\`\`\`json\n${json}\n\`\`\``, app).file.steps).toEqual([good]);
  });

  it('never fails: nothing usable is an empty draft that says so', () => {
    expect(checkDraft(null, app, context)).toEqual({ file: { slug: 'add-an-item', title: 'Add an item', mode: 'guide', article: 'add-an-item', steps: [] }, notes: ['The AI proposed no steps.'] });
    expect(checkDraft({ title: 3, steps: 'no' }, app, context).file.title).toBe('Add an item');
    expect(checkDraft('not json at all', app, context).notes).toEqual(['The AI’s answer wasn’t JSON, so no steps came through.']);
  });

  it('keeps to the most steps a file allows', () => {
    const { file, notes } = checkDraft({ steps: Array.from({ length: 35 }, () => good) }, app);
    expect(file.steps).toHaveLength(30);
    expect(notes).toEqual(['Left out the steps after step 30: a walkthrough has at most 30.']);
  });
});

describe('draftWalkthrough', () => {
  it('asks once with the built request and returns the checked draft', async () => {
    const ask = vi.fn(async () => ({ title: 'Add one', steps: [good] }));
    const { file, notes } = await draftWalkthrough({ source, mode: 'show', app, ask, instructions: 'Say item.', article: 'add-an-item' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(buildDraftRequest({ source, mode: 'show', anchors: app.anchors, prefixes: app.prefixes, routes: app.routes, retiredWords: ['widget', 'work order'], instructions: 'Say item.' }));
    expect(file).toEqual({ slug: 'add-one', title: 'Add one', mode: 'show', article: 'add-an-item', steps: [good] });
    expect(notes).toEqual([]);
  });

  it('takes the answer as text too', async () => {
    const { file } = await draftWalkthrough({ source, mode: 'show', app, ask: async () => JSON.stringify({ steps: [good] }) });
    expect(file).toMatchObject({ title: 'Add an item', steps: [good] });
  });

  it('bad JSON is an empty draft that says so', async () => {
    const { file, notes } = await draftWalkthrough({ source, mode: 'show', app, ask: async () => 'Sorry, I can’t.' });
    expect(file.steps).toEqual([]);
    expect(notes).toEqual(['The AI’s answer wasn’t JSON, so no steps came through.']);
  });

  it('bad steps are left out', async () => {
    const { file, notes } = await draftWalkthrough({ source, mode: 'show', app, ask: async () => ({ steps: [{ ...good, anchor: 'nope' }, good] }) });
    expect(file.steps).toEqual([good]);
    expect(notes).toHaveLength(1);
  });

  it('a failed ask rejects with its own error, however it fails', async () => {
    const down = new Error('AI service down');
    await expect(draftWalkthrough({ source, mode: 'show', app, ask: async () => Promise.reject(down) })).rejects.toBe(down);
    await expect(
      draftWalkthrough({
        source,
        mode: 'show',
        app,
        ask: () => {
          throw down;
        },
      }),
    ).rejects.toBe(down);
  });

  it('a retired-word pattern still checks, and just isn’t listed in the prompt', async () => {
    const ask = vi.fn(async () => ({ steps: [{ ...good, body: 'A widget.' }] }));
    const { notes } = await draftWalkthrough({ source, mode: 'show', app: { ...app, retiredWords: /\bwidget\b/ }, ask });
    expect(notes).toEqual(['Left out step 1: “widget” is a retired word.']);
    expect(ask.mock.calls[0]).toBeDefined();
    expect((ask.mock.calls[0] as unknown as [{ system: string }])[0].system).not.toContain('Never use these words');
  });
});

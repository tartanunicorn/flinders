import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RULES } from '../conformance/runner.js';
import { FLINDERS_ROUTES } from '../src/contract.js';
import { createFileSchema, stepProblems, walkthroughStepSchema } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (name: string) => readFileSync(join(ROOT, 'docs', name), 'utf8');
const DOCS = ['compared.md', 'install.md', 'rollout-checklist.md', 'quick-start.md', 'recording.md', 'checking.md', 'server-contract.md', 'file-format.md', 'matching-your-design.md', 'chat-and-admin.md', 'show-me-where.md', 'ai-drafts.md', 'own-backend.md'];

describe('the docs match the code', () => {
  it('explains every field of the file format', () => {
    const fields = [...Object.keys(createFileSchema().shape), ...Object.keys(walkthroughStepSchema.shape)];
    const text = doc('file-format.md');
    expect(fields.filter((field) => !text.includes(`| \`${field}\` |`))).toEqual([]);
  });

  it('lists every rule of the conformance kit and every route of the contract', () => {
    const text = doc('server-contract.md');
    expect(RULES.map(([id]) => id).filter((id) => !text.includes(`\`${id}\``))).toEqual([]);
    expect(Object.values(FLINDERS_ROUTES).filter((route) => !text.includes(`${route.method} \`${route.path}\``))).toEqual([]);
  });

  it('maps every route of the contract in the guide to writing your own server', () => {
    const text = doc('own-backend.md');
    expect(Object.values(FLINDERS_ROUTES).filter((route) => !text.includes(`${route.method} \`${route.path}\``))).toEqual([]);
  });

  it('shows only walkthrough files that would save', () => {
    const app = { anchorExists: () => true, routeExists: () => true };
    const files = DOCS.flatMap((name) => [...doc(name).matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!)));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const parsed = createFileSchema().parse(file);
      expect(stepProblems(parsed.steps, app)).toEqual([]);
    }
  });

  it('lists every variable the stylesheet reads', () => {
    const css = readFileSync(join(ROOT, 'src', 'player.css'), 'utf8');
    const variables = new Set([...css.matchAll(/var\((--flinders-[a-z0-9-]+)/g)].map((m) => m[1]!));
    const text = doc('matching-your-design.md');
    expect([...variables].filter((name) => !text.includes(`\`${name}\``))).toEqual([]);
  });

  it('is linked from the README, and links only to pages that exist', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const name of DOCS) {
      expect(readme, name).toContain(`docs/${name}`);
      for (const link of doc(name).matchAll(/\]\(([a-z-]+\.md)\)/g)) expect(DOCS, name).toContain(link[1]);
    }
  });
});

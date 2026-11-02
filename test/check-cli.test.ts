import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stepProblems, walkthroughStepsSchema } from '../src/server.js';

// Each test starts node, some of them several times.
vi.setConfig({ testTimeout: 30_000 });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'flinders-check.mjs');

const step = (anchor: string | null, over: object = {}) => ({ anchor, title: 'A step', body: 'Some words.', missing: 'centred', ...over });

let dir: string;
const write = (path: string, text: string) => {
  const to = join(dir, path);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, text);
};
const walkthrough = (steps: unknown, name = 'one.json', extra: object = {}) => write(join('walkthroughs', name), JSON.stringify({ slug: 'one', title: 'One', steps, ...extra }));
const run = (...args: string[]) => {
  // No colour settings passed down: with both set, Node warns on stderr, which these tests read.
  const { NO_COLOR: _noColor, FORCE_COLOR: _forceColor, ...env } = process.env;
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', env });
  return { code: result.status, out: result.stdout, err: result.stderr };
};
const check = (...args: string[]) => run('--source', 'src', '--walkthroughs', 'walkthroughs', ...args);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'walkthrough-check-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('finding anchors', () => {
  it.each([
    ['plain HTML', 'a.html', '<button data-testid="target-x">'],
    ['single quotes', 'a.html', "<button data-testid='target-x'>"],
    ['JSX with a string', 'a.jsx', `<a data-testid={'target-x'} />`],
    ['JSX, either side of a condition', 'a.tsx', `<a data-testid={on ? 'other' : 'target-x'} />`],
    ['Angular bound', 'a.ts', `<a [attr.data-testid]="'target-x'"></a>`],
    ['Vue bound', 'a.vue', `<a :data-testid="'target-x'" />`],
    ['setAttribute', 'a.js', `el.setAttribute('data-testid', 'target-x');`],
    ['an object of attributes', 'a.js', `h('a', { 'data-testid': 'target-x' });`],
    ['a bound start, Angular', 'a.ts', `<a [attr.data-testid]="'target-' + t.slug"></a>`],
    ['a bound start, Vue', 'a.vue', `<a :data-testid="'target-' + slug" />`],
    ['a bound start, JSX plus', 'a.jsx', `<a data-testid={'target-' + slug} />`],
    ['a bound start, JSX template', 'a.tsx', '<a data-testid={`target-${slug}`} />'],
    ['a bound start, Angular text', 'a.html', '<a data-testid="target-{{slug}}"></a>'],
    ['a bound start, Svelte text', 'a.svelte', '<a data-testid="target-{slug}"></a>'],
    ['a bound start, setAttribute', 'a.js', `el.setAttribute('data-testid', 'target-' + id);`],
    ['a bound start, template', 'a.js', "el.setAttribute('data-testid', `target-${id}`);"],
  ])('%s', (_name, path, source) => {
    write(join('src', 'nested', path), source);
    walkthrough([step('target-x')]);
    const result = check();
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('All good');
  });

  it("doesn't take a bound variable's name for an anchor", () => {
    write('src/a.ts', `<a [attr.data-testid]="slug"></a><b :data-testid="slug" /><c data-testid={slug} />`);
    walkthrough([step('slug')]);
    expect(check().code).toBe(1);
  });

  it("doesn't take a longer attribute for the one asked for", () => {
    write('src/a.html', '<a x-data-testid="one"></a><a data-testid-more="two"></a>');
    walkthrough([step('one'), step('two')]);
    expect(check().code).toBe(1);
  });

  it('skips dependencies, builds and test files', () => {
    write('src/node_modules/lib/a.js', '<a data-testid="one">');
    write('src/dist/a.js', '<a data-testid="two">');
    write('src/a.spec.ts', '<a data-testid="three">');
    write('src/a.test.tsx', '<a data-testid="four">');
    write('src/real.html', '<a data-testid="real">');
    walkthrough([step('real'), step('one'), step('two'), step('three'), step('four')]);
    const result = check();
    expect(result.code).toBe(1);
    expect(result.err.match(/no element/g)).toHaveLength(4);
  });

  it('takes a different attribute, or several', () => {
    write('src/a.html', '<a data-tour="one"></a><dialog primaryTestId="two"></dialog><a data-testid="three"></a>');
    walkthrough([step('one'), step('two')]);
    expect(check('--attribute', 'data-tour', '--attribute', 'primaryTestId').code).toBe(0);
    expect(check().code).toBe(1);
    walkthrough([step('three')]);
    expect(check('--attribute', 'data-tour').code).toBe(1);
  });

  it('scans only the file types asked for', () => {
    write('src/a.foo', '<a data-testid="one">');
    write('src/a.html', '<a data-testid="two">');
    walkthrough([step('one')]);
    expect(check().code).toBe(1);
    expect(check('--ext', '.foo').code).toBe(0);
    expect(check('--ext', 'foo').code).toBe(0);
  });

  it('scans several source folders', () => {
    write('src/a.html', '<a data-testid="one">');
    write('lib/a.html', '<a data-testid="two">');
    walkthrough([step('one'), step('two')]);
    expect(run('--source', 'src', '--source', 'lib', '--walkthroughs', 'walkthroughs').code).toBe(0);
  });
});

describe('reporting problems', () => {
  beforeEach(() => write('src/a.html', '<a data-testid="here"></a>'));

  it('names the file, the step and the element, and exits 1', () => {
    walkthrough([step('here'), step('gone')]);
    const result = check();
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${join('walkthroughs', 'one.json')}: step 2: no element “gone” in the app`);
    expect(result.err).toContain('1 problem found');
  });

  it('finds what the upload check finds, in every place a step points at an element', () => {
    const steps = [
      step('gone-1', {
        missing: { alt: 'gone-2' },
        phone: { anchor: 'gone-3' },
        done_when: { kind: 'appears', anchor: 'gone-4' },
        blocked: [{ anchor: 'gone-5', body: 'Blocked.' }, { anchor: 'gone-6', body: 'Blocked.' }],
      }),
      step(null),
    ];
    walkthrough(steps);
    const expected = stepProblems(walkthroughStepsSchema.parse(steps), { anchorExists: (id) => id === 'here', routeExists: () => true });
    expect(expected).toHaveLength(6);
    const printed = check().err.split('\n').filter((l) => l.includes('.json')).map((l) => l.replace(/^.*?\.json: /, ''));
    expect(printed).toEqual(expected);
  });

  it('a centred step points at nothing, so it is fine', () => {
    walkthrough([step(null)]);
    expect(check().code).toBe(0);
  });

  it('checks every file in the folder, in subfolders too', () => {
    walkthrough([step('gone-1')], 'a.json');
    walkthrough([step('gone-2')], join('more', 'b.json'));
    const result = check();
    expect(result.err).toContain('gone-1');
    expect(result.err).toContain('gone-2');
  });

  it('takes one file', () => {
    walkthrough([step('here')], 'a.json');
    walkthrough([step('gone')], 'b.json');
    expect(run('--source', 'src', '--walkthroughs', join('walkthroughs', 'a.json')).code).toBe(0);
  });

  it('says so when a file is not JSON, or not a walkthrough', () => {
    write('walkthroughs/broken.json', '{ nope');
    write('walkthroughs/other.json', '{"name":"not one"}');
    const result = check();
    expect(result.code).toBe(1);
    expect(result.err).toContain("broken.json: this isn't valid JSON");
    expect(result.err).toContain("other.json: this isn't a walkthrough");
  });

  it('refuses a newer format, however much of it looks wrong', () => {
    walkthrough([step('gone')], 'one.json', { format_version: 2 });
    const result = check();
    expect(result.code).toBe(1);
    expect(result.err).toContain('this file is format 2');
    expect(result.err).not.toContain('gone');
  });

  it('reads a file with a byte order mark', () => {
    write('walkthroughs/one.json', `﻿${JSON.stringify({ steps: [step('here')] })}`);
    expect(check().code).toBe(0);
  });
});

describe('--list', () => {
  it('writes every element, with a bound one as its fixed start and a star, and needs no walkthroughs', () => {
    write('src/a.html', `<button data-testid="save"></button><a [attr.data-testid]="'open-' + id"></a>`);
    expect(run('--source', 'src', '--list', 'anchors.json').code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8'))).toEqual(['open-*', 'save']);
  });

  it('with no source files, writes nothing and exits 2', () => {
    mkdirSync(join(dir, 'src'));
    expect(run('--source', 'src', '--list', 'anchors.json').code).toBe(2);
  });
});

describe('when it cannot run', () => {
  it('shows how to use it and exits 2', () => {
    const result = run();
    expect(result.code).toBe(2);
    expect(result.err).toContain('Usage:');
  });

  it('--help is not an error', () => {
    const result = run('--help');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Usage:');
  });

  it('an unknown option exits 2', () => {
    expect(run('--nope').code).toBe(2);
  });

  it('a folder that is not there exits 2', () => {
    const result = check();
    expect(result.code).toBe(2);
    expect(result.err).toContain("Can't find");
  });

  it("doesn't pass when it had nothing to check", () => {
    write('src/a.html', '<a data-testid="here"></a>');
    mkdirSync(join(dir, 'walkthroughs'));
    expect(check().code).toBe(2);
    walkthrough([step(null)]);
    mkdirSync(join(dir, 'empty'));
    expect(run('--source', 'empty', '--walkthroughs', 'walkthroughs').code).toBe(2);
  });
});

it('is the package.json command', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(pkg.bin['flinders-check']).toBe('./bin/flinders-check.mjs');
  expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

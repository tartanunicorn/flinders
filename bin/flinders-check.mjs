#!/usr/bin/env node
/**
 * Checks walkthrough files against an app's source: every element a step points at must exist.
 * Works on any framework, because it only reads text. It knows these forms of an attribute:
 *
 *   data-testid="save"                     a fixed anchor (also in JSX, as {'save'} or {"save"})
 *   [attr.data-testid]="'open-' + slug"    a bound one: `open-` is the fixed start, any end matches
 *   :data-testid="'open-' + slug"          the same in Vue
 *   data-testid={`open-${slug}`}           the same in JSX
 *   data-testid="open-{{slug}}"            the same as interpolated text ({x} and ${x} too)
 *   setAttribute('data-testid', 'save')    in plain JavaScript
 *
 * Exit codes: 0 all fine, 1 problems found, 2 it couldn't run.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `Checks that every element a walkthrough points at exists in your app's source.

Usage: flinders-check --source <folder> --walkthroughs <folder or file> [options]
       flinders-check --source <folder> --list <file> [options]

  --source <folder>        Source files to scan. Repeat for several folders.
  --walkthroughs <path>    A walkthrough JSON file, or a folder of them. Repeatable.
  --list <file>            Instead of checking, writes every element found as a JSON array.
                           A bound one is its fixed start, then *: open-*.
  --attribute <name>       Attribute that marks an element (default data-testid). Repeatable.
  --ext <.ext>             File type to scan, replacing the default list. Repeatable.
  --help                   Show this help.

Exit codes: 0 all fine, 1 problems found, 2 it couldn't run.`;

const DEFAULT_EXTENSIONS = ['.html', '.htm', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro'];
const SKIP_FOLDERS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.nuxt', '.angular', '.svelte-kit']);
const TEST_FILE = /\.(spec|test)\.[^.]+$/;

/** A problem with how it was called, not with the walkthroughs. */
class CantRun extends Error {}

function walk(dir, keep, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_FOLDERS.has(entry)) walk(path, keep, out);
    } else if (keep(entry)) out.push(path);
  }
  return out;
}

function filesAt(path, keep) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new CantRun(`Can't find ${path}.`);
  }
  return stat.isDirectory() ? walk(path, keep) : [path];
}

/** Records a fixed string, cut at the first interpolation: what's before it is a prefix. */
function addText(text, followedByPlus, found) {
  const cut = text.search(/\$?\{/);
  const fixed = cut >= 0 ? text.slice(0, cut) : text;
  if (!fixed) return;
  (cut >= 0 || followedByPlus ? found.prefixes : found.ids).add(fixed);
}

/** A bound value: every string in the expression, so `on ? 'a' : 'b'` gives both. */
function addExpression(expression, found) {
  for (const m of expression.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1(\s*\+)?/g)) addText(m[2], Boolean(m[3]), found);
}

/** The text between `{` at `start` and its matching `}`. */
function braced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start + 1, i);
  }
  return '';
}

function scan(text, pattern, found) {
  for (const m of text.matchAll(pattern)) {
    const [whole, open, close] = m;
    const start = m.index + whole.length;
    const quote = text[start];
    if (quote === '{') addExpression(braced(text, start), found);
    if (!`"'\``.includes(quote)) continue;
    const end = text.indexOf(quote, start + 1);
    if (end < 0) continue;
    const value = text.slice(start + 1, end);
    const bound = open === ':' || open === 'v-bind:' || (open && close);
    if (bound && quote !== '`') addExpression(value, found);
    else addText(value, /^\s*\+/.test(text.slice(end + 1, end + 20)), found);
  }
}

function anchorsIn(paths, attributes, extensions) {
  const found = { ids: new Set(), prefixes: new Set() };
  const names = attributes.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?<![\\w-])(\\[(?:attr\\.)?|v-bind:|:)?(?:${names})(\\])?['"]?\\s*[=:,]\\s*`, 'g');
  const keep = (name) => extensions.includes(extname(name)) && !TEST_FILE.test(name);
  let files = 0;
  for (const path of paths) {
    for (const file of filesAt(path, keep)) {
      files++;
      scan(readFileSync(file, 'utf8'), pattern, found);
    }
  }
  return { ...found, files };
}

/** Every element one step points at. Keep in step with `stepProblems` in src/server.ts. */
function stepAnchors(s) {
  return [
    ['', s.anchor],
    ['fallback ', s.missing?.alt],
    ['phone ', s.phone?.anchor],
    ['done-when ', s.done_when?.kind === 'appears' ? s.done_when.anchor : null],
    ...(Array.isArray(s.blocked) ? s.blocked : []).map((b) => ['blocked ', b?.anchor]),
  ];
}

function problemsIn(file, anchors, newestFormat) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return [`this isn't valid JSON (${e.message})`];
  }
  if (parsed?.format_version > newestFormat) return [`this file is format ${parsed.format_version}, but this tool only reads up to format ${newestFormat}: update it`];
  if (!Array.isArray(parsed?.steps)) return ["this isn't a walkthrough: it has no list of steps"];
  const exists = (id) => anchors.ids.has(id) || [...anchors.prefixes].some((p) => id.startsWith(p));
  return parsed.steps.flatMap((step, i) =>
    stepAnchors(step ?? {})
      .filter(([, id]) => typeof id === 'string' && !exists(id))
      .map(([kind, id]) => `step ${i + 1}: no ${kind}element “${id}” in the app`),
  );
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', multiple: true, default: [] },
      walkthroughs: { type: 'string', multiple: true, default: [] },
      list: { type: 'string' },
      attribute: { type: 'string', multiple: true, default: ['data-testid'] },
      ext: { type: 'string', multiple: true, default: DEFAULT_EXTENSIONS },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.source.length || !(values.list || values.walkthroughs.length)) throw new CantRun(USAGE);

  const extensions = values.ext.map((e) => (e.startsWith('.') ? e : `.${e}`));
  const anchors = anchorsIn(values.source, values.attribute, extensions);
  if (values.list) {
    if (!anchors.files) throw new CantRun(`No source files in ${values.source.join(', ')}.`);
    const list = [...anchors.ids, ...[...anchors.prefixes].map((p) => `${p}*`)].sort();
    writeFileSync(values.list, `${JSON.stringify(list, null, 2)}\n`);
    console.log(`Wrote ${plural(list.length, 'anchor')} from ${plural(anchors.files, 'source file')} to ${values.list}.`);
    return 0;
  }
  const walkthroughs = values.walkthroughs.flatMap((path) => filesAt(path, (name) => name.endsWith('.json')));
  // A check that looked at nothing must not pass.
  if (!walkthroughs.length) throw new CantRun(`No walkthrough files (.json) in ${values.walkthroughs.join(', ')}.`);
  if (!anchors.files) throw new CantRun(`No source files in ${values.source.join(', ')}.`);

  const schema = JSON.parse(readFileSync(new URL('../schema/walkthrough.schema.json', import.meta.url), 'utf8'));
  const newestFormat = schema.properties.format_version.maximum;
  const problems = walkthroughs.flatMap((file) => problemsIn(file, anchors, newestFormat).map((p) => `${relative(process.cwd(), file) || file}: ${p}`));

  const scanned = `${plural(walkthroughs.length, 'walkthrough file')} against ${plural(anchors.ids.size + anchors.prefixes.size, 'anchor')} in ${plural(anchors.files, 'source file')}`;
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${plural(problems.length, 'problem')} found checking ${scanned}.`);
    return 1;
  }
  console.log(`All good: checked ${scanned}.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  if (!(e instanceof CantRun) && e?.code?.startsWith?.('ERR_PARSE_ARGS') !== true) throw e;
  console.error(e.message);
  process.exitCode = 2;
}

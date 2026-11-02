#!/usr/bin/env node
/** Builds the demo into `examples/demo/site`, a folder any static host can serve. Needs `npm run build` first. */
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, 'site');

mkdirSync(site, { recursive: true });
for (const file of readdirSync(site)) rmSync(join(site, file), { recursive: true });
await build({
  entryPoints: [join(here, 'demo.js')],
  outdir: site,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  alias: { flinders: join(here, '..', '..', 'dist', 'index.js') },
});
cpSync(join(here, 'index.html'), join(site, 'index.html'));
cpSync(join(here, 'demo.css'), join(site, 'demo.css'));
cpSync(join(here, '..', '..', 'src', 'player.css'), join(site, 'player.css'));
console.log(`Built ${site}. Serve it with any static server: npx serve ${site}`);

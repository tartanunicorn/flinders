import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every file under a folder, leaving out an example's own installs and builds (its link back here would never end). */
function ownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.angular', '.next', 'next-env.d.ts', 'package-lock.json', 'vendor', 'composer.lock'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? ownFiles(path) : [path];
  });
}

describe('the package stays portable', () => {
  it('builds on its own: no settings or dependencies from a repo around it', () => {
    const root = join(SRC, '..');
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
      const text = readFileSync(join(root, file), 'utf8');
      expect(text, file).not.toContain('../');
      expect(text, file).not.toContain('workspace:');
    }
  });

  it('keeps framework examples to themselves: they reach no further than this folder', () => {
    for (const example of ['react', 'angular', 'nextjs']) {
      const manifest = JSON.parse(readFileSync(join(SRC, '..', 'examples', example, 'package.json'), 'utf8'));
      const versions = Object.values<string>({ ...manifest.dependencies, ...manifest.devDependencies });
      expect(manifest.dependencies.flinders, example).toBe('file:../..');
      expect(versions.filter((v) => v.includes('workspace:') || (v.includes('../') && v !== 'file:../..')), example).toEqual([]);
    }
  });

  it('imports only itself, driver.js and zod (and node:crypto, to sign a recording link): no product code, no framework', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('controller.ts');
    for (const file of files) {
      const source = readFileSync(join(SRC, file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g), ...source.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1]!);
      const allowed = ['driver.js', 'zod', ...(file === 'recording-link.ts' ? ['node:crypto'] : [])];
      expect(imports.filter((i) => !i.startsWith('./') && !allowed.includes(i)), file).toEqual([]);
    }
  });

  it('imports nothing outside this folder: code, tests and tools reach only themselves and what package.json lists', () => {
    const root = join(SRC, '..');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const listed = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
    // This file holds import patterns of its own, as text.
    const files = ['src', 'test', 'bin', 'conformance'].flatMap((dir) => ownFiles(join(root, dir))).filter((f) => /\.m?tsx?$|\.mjs$/.test(f) && !f.endsWith('portable.test.ts'));
    expect(files.length).toBeGreaterThan(20);
    const outside = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*(?:\n[^'"\n]*)*?\bfrom ['"]([^'"]+)['"]/g), ...source.matchAll(/^\s*import ['"]([^'"]+)['"]/gm), ...source.matchAll(/\b(?:import|require)\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]!);
      return specifiers.flatMap((spec) => {
        const inside = spec.startsWith('.') ? !relative(root, resolve(dirname(file), spec)).startsWith('..') : spec.startsWith('node:') || listed.has(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'));
        return inside ? [] : [`${relative(root, file)}: ${spec}`];
      });
    });
    expect(outside).toEqual([]);
  });

  it('the conformance kit is plain TypeScript: node and itself, so it can test a backend in any language', () => {
    const kit = join(SRC, '..', 'conformance');
    const files = readdirSync(kit).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('runner.ts');
    for (const file of files) {
      const imports = [...readFileSync(join(kit, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      expect(imports.filter((i) => !i.startsWith('node:') && !/^\.\/[a-z]+\.js$/.test(i)), file).toEqual([]);
    }
  });

  it('the command line tool needs nothing but node itself', () => {
    const bin = join(SRC, '..', 'bin');
    for (const file of readdirSync(bin)) {
      const imports = [...readFileSync(join(bin, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      expect(imports.filter((i) => !i.startsWith('node:')), file).toEqual([]);
    }
  });
});

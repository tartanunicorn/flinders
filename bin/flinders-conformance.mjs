#!/usr/bin/env node
// Drives a Flinders backend through the contract. The kit is built with the package: `npm run build`.
const kit = await import('../dist/conformance/cli.js').catch(() => null);
if (!kit) {
  console.error('The conformance kit isn’t built yet. Run the package’s build first.');
  process.exit(2);
}
process.exit(await kit.main(process.argv.slice(2)));

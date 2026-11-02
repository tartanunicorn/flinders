import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// `flinders` is linked from two folders up (file:../..), so Next looks from there. In your own app
// it's an ordinary package and neither line about the root is needed.
const root = fileURLToPath(new URL('../..', import.meta.url));

const config: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  serverExternalPackages: ['pg'], // Stays a Node package on the server, not bundled.
};

export default config;

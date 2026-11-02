/**
 * The server side: `createFlinders`, which serves the HTTP contract (contract/openapi.yaml), and the
 * repository under it for a product that wires its own routes.
 */
export * from './repository.js';
export * from './server-flinders.js';
export { parseShowMe } from './show-me.js';

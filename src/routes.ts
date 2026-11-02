/** `/projects/:projectId/settings` against a URL: the params, or null when it doesn't match. */
export function matchRoute(pattern: string, url: string): Record<string, string> | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const names: string[] = [];
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z]+)/g, (_m, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
  const m = new RegExp(`^${source}/?$`).exec(path);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? '')]));
}

/**
 * The ids a URL already gives a route pattern, segment by segment while they agree: on
 * `/projects/p1`, `/projects/:projectId/settings` gets `{ projectId: 'p1' }`, so a walkthrough
 * started on a project can go to that project's settings itself.
 */
export function paramsFromUrl(pattern: string, url: string): Record<string, string> {
  const want = pattern.split('/').filter(Boolean);
  const have = (url.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length && i < have.length; i++) {
    const seg = want[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(have[i]!);
    else if (seg !== have[i]) break;
  }
  return params;
}

/** The first id a route pattern needs that this URL doesn't give (`projectId`), or null when it has them all. */
export function missingRouteParam(pattern: string, url: string): string | null {
  const known = paramsFromUrl(pattern, url);
  return (pattern.match(/:[A-Za-z]+/g) ?? []).map((p) => p.slice(1)).find((name) => !known[name]) ?? null;
}

/** Fills a route pattern from params seen earlier; null when one is missing. */
export function buildRoute(pattern: string, params: Record<string, string>): string | null {
  let missing = false;
  const url = pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = params[name];
    if (!value) missing = true;
    return encodeURIComponent(value ?? '');
  });
  return missing ? null : url;
}

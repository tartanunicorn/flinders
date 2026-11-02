/**
 * The HTTP contract's routes, as data: `contract/openapi.yaml` is the definition, and a test keeps
 * this list and that file the same. Paths sit under a base the product sets.
 */
export const FLINDERS_ROUTES = {
  listWalkthroughs: { method: 'GET', path: '/walkthroughs' },
  getMyProgress: { method: 'GET', path: '/progress' },
  setOffers: { method: 'PATCH', path: '/offers' },
  recordEvent: { method: 'POST', path: '/walkthroughs/{walkthroughId}/events' },
  checkRecordingLink: { method: 'POST', path: '/recording-links/check' },
  saveRecording: { method: 'POST', path: '/recording-links/drafts' },
  adminList: { method: 'GET', path: '/admin/walkthroughs' },
  adminUpload: { method: 'POST', path: '/admin/walkthroughs' },
  adminDetail: { method: 'GET', path: '/admin/walkthroughs/{walkthroughId}' },
  adminSaveVersion: { method: 'POST', path: '/admin/walkthroughs/{walkthroughId}/versions' },
  adminStats: { method: 'GET', path: '/admin/walkthroughs/{walkthroughId}/stats' },
  adminCreateRecordingLink: { method: 'POST', path: '/admin/recording-links' },
} as const;

export type FlindersRouteName = keyof typeof FLINDERS_ROUTES;

/**
 * A product's own path for a route, where it differs. Null = the backend doesn't serve this route,
 * so that feature is off (stats still come with the admin detail).
 */
export type FlindersPaths = Partial<Record<FlindersRouteName, string | null>>;

/** A route's path with its `{params}` filled in; encoded, as they go in a URL. */
export function fillPath(path: string, params: Readonly<Record<string, string>> = {}): string {
  return path.replace(/\{([A-Za-z]+)\}/g, (_m, key: string) => encodeURIComponent(params[key] ?? ''));
}

/** The error every route answers with: `code` for code, `message` in plain words for a person. */
export interface FlindersErrorBody {
  error: { code: string; message: string };
}

/** `code` out of an error body, when it has one. */
export function errorCode(body: unknown): string | null {
  const code = (body as Partial<FlindersErrorBody> | null | undefined)?.error?.code;
  return typeof code === 'string' ? code : null;
}

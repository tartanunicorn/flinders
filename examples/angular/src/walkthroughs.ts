import type { FlindersRequest, Walkthrough, WalkthroughProgress, WalkthroughStep } from 'flinders';

// A real app has `http: { baseUrl: '/flinders' }` and a server; here the server sits in the page.
const step = (anchor: string, title: string, body: string, extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({ anchor, title, body, missing: 'centred', ...extra });
const base = { version: 1, reoffer_from: 1, permission: null, article_slug: null };

const walkthroughs: Walkthrough[] = [
  {
    ...base,
    walkthrough_id: 'tour',
    number: 1,
    handle: '1-find-your-way',
    slug: 'find-your-way',
    title: 'Find your way round',
    mode: 'show',
    offer_on: '/',
    steps: [
      step('project-1', 'Your projects', 'Each project is listed **here**.', { route: '/' }),
      step('project-notes', 'Notes', 'Each project keeps its notes on its own page.', { route: '/projects/1' }),
    ],
  },
  {
    ...base,
    walkthrough_id: 'note',
    number: 2,
    handle: '2-add-a-note',
    slug: 'add-a-note',
    title: 'Add a note',
    mode: 'guide',
    offer_on: null,
    steps: [
      step('project-1', 'Open the project', 'Open **Project 1**.', { route: '/', done_when: { kind: 'route', route: '/projects/:projectId' } }),
      step('project-notes', 'Write a note', 'Type anything here.', { route: '/projects/:projectId', done_when: { kind: 'filled' } }),
      step('save', 'Save it', 'Press **Save** and you are done.', { done_when: { kind: 'clicked' } }),
    ],
  },
];

const progress: Record<string, WalkthroughProgress> = {};
const mine = () => ({ offer_walkthroughs: true, progress });

export const inPageServer: FlindersRequest = async ({ route, params, body }) => {
  if (route === 'listWalkthroughs') return { ok: true, body: { data: walkthroughs } };
  if (route === 'adminList') return { ok: true, body: { data: walkthroughs.map((w) => ({ handle: w.handle, title: w.title, mode: w.mode, live_version: w.version, steps_count: w.steps.length, problems: [] })) } };
  if (route === 'getMyProgress') return { ok: true, body: mine() };
  if (route === 'recordEvent') {
    const { event, version, step: at } = body as { event: string; version: number; step: number };
    if (event !== 'step') progress[params['walkthroughId']!] = { v: version, status: event as WalkthroughProgress['status'], step: at, at: new Date().toISOString() };
    return { ok: true, body: mine() };
  }
  return { ok: false, body: { error: { code: 'feature_off', message: 'Not in this example.' } } };
};

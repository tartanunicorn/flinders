import { createFlinders, fillRecordedWords, walkthroughHandle } from 'flinders';

const $ = (id) => document.getElementById(id);

// ── The pretend app: two pages and a tiny hash router ────────────────────────
const projects = { 1: { name: 'North bank survey', notes: [] }, 2: { name: 'Harbour wall', notes: [] } };
const url = () => location.hash.slice(1) || '/';
const listeners = new Set();

function render() {
  const id = /^\/projects\/(\d+)$/.exec(url())?.[1];
  const page = $('page');
  if (id && projects[id]) {
    const project = projects[id];
    page.innerHTML = `
      <h1></h1>
      <p><label>New note <input data-testid="note" autocomplete="off" /></label></p>
      <p><button type="button" data-testid="save">Save note</button></p>
      <ul data-testid="notes"></ul>`;
    page.querySelector('h1').textContent = project.name;
    const notes = page.querySelector('ul');
    const show = () => notes.replaceChildren(...project.notes.map((note) => Object.assign(document.createElement('li'), { textContent: note })));
    show();
    page.querySelector('[data-testid="save"]').addEventListener('click', () => {
      const field = page.querySelector('input');
      if (field.value.trim()) project.notes.push(field.value.trim());
      field.value = '';
      show();
    });
  } else {
    page.innerHTML = `
      <h1>Projects</h1>
      <ul>${Object.entries(projects)
        .map(([key, project]) => `<li><a href="#/projects/${key}" data-testid="project-${key}">${project.name}</a></li>`)
        .join('')}</ul>
      <p>This line has no anchor, so recording says it can’t be a step.</p>`;
  }
}

addEventListener('hashchange', () => {
  render();
  listeners.forEach((listener) => listener(url()));
});

const router = {
  url,
  navigate: (to) =>
    new Promise((resolve) => {
      if (to === url()) return resolve(true);
      addEventListener('hashchange', () => resolve(true), { once: true });
      location.hash = to;
    }),
  onNavigated(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  // Tells recording `/projects/1` is the page `/projects/:projectId`.
  routePattern: (address) => address.replace(/\/\d+$/, '/:projectId'),
};

// ── An in-memory server: the contract's routes, in the page ──────────────────
const step = (anchor, title, body, extra = {}) => ({ anchor, title, body, missing: 'centred', ...extra });
const walkthrough = (number, slug, title, mode, offerOn, steps) => ({
  walkthrough_id: slug,
  number,
  handle: walkthroughHandle({ number, slug }),
  version: 1,
  slug,
  title,
  mode,
  permission: null,
  offer_on: offerOn,
  reoffer_from: 1,
  article_slug: null,
  steps,
});

const served = [
  walkthrough(1, 'find-your-way', 'Find your way round', 'show', '/', [
    step('project-1', 'Your projects', 'Each project is listed **here**.', { route: '/' }),
    step('note', 'Notes', 'Each project keeps its notes on its own page.', { route: '/projects/1' }),
    step('save', 'Saving', 'Press **Save note** to keep it. That’s all there is to it.'),
  ]),
  walkthrough(2, 'add-a-note', 'Add a note', 'guide', null, [
    step('project-1', 'Open the project', 'Open **North bank survey**.', { route: '/', done_when: { kind: 'route', route: '/projects/:projectId' } }),
    step('note', 'Write a note', 'Type anything here.', { route: '/projects/:projectId', done_when: { kind: 'filled' } }),
    step('save', 'Save it', 'Press **Save note** and you’re done.', { done_when: { kind: 'clicked' } }),
  ]),
];
const mine = { offer_walkthroughs: true, progress: {} };

async function request({ route, params, body }) {
  if (route === 'listWalkthroughs') return { ok: true, body: { data: served } };
  if (route === 'getMyProgress') return { ok: true, body: mine };
  if (route === 'setOffers') return { ok: true, body: Object.assign(mine, body) };
  if (route === 'recordEvent') {
    if (body.event !== 'step') mine.progress[params.walkthroughId] = { v: body.version, status: body.event, step: body.step, at: new Date().toISOString() };
    return { ok: true, body: mine };
  }
  return { ok: false, body: { error: { code: 'feature_off', message: 'This demo has no admin.' } } };
}

// ── Flinders: one call, one connector for each thing the app already has ─────
let saidAt = 0;
function toast(message) {
  const said = ++saidAt;
  $('toast').textContent = message;
  setTimeout(() => said === saidAt && ($('toast').textContent = ''), 5000);
}

function offer(details) {
  return new Promise((answer) => {
    const button = (label, value) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.addEventListener('click', () => {
        $('offer').replaceChildren();
        answer(value);
      });
      return el;
    };
    const text = document.createElement('span');
    text.textContent = `New here? ${details.title}`;
    $('offer').replaceChildren(text, button(details.dismissLabel, false), button(details.acceptLabel, true));
  });
}

const flinders = createFlinders({
  http: { request },
  router,
  identity: { can: () => true },
  offers: { show: offer, clear: () => $('offer').replaceChildren() },
  toast,
  recording: { onFinish: showRecording },
});

// ── Your own recording, played straight back ─────────────────────────────────
let recorded = null;

function showRecording(steps) {
  if (!steps.length) return;
  recorded = { id: 'yours', version: 1, title: 'Your walkthrough', mode: 'guide', steps: fillRecordedWords(steps) };
  $('recorded').hidden = false;
  $('recorded-count').textContent = steps.length === 1 ? '1 step' : `${steps.length} steps`;
  $('recorded-steps').textContent = JSON.stringify(steps, null, 2);
  $('recorded').scrollIntoView({ block: 'nearest' });
}

$('play-recorded').addEventListener('click', () => recorded && void flinders.controller.preview(recorded));
$('show-me').addEventListener('click', () => void flinders.start('1', 'list'));
$('guide-me').addEventListener('click', () => void flinders.start('2', 'list'));
$('record').addEventListener('click', () => void flinders.record());
$('rtl').addEventListener('change', (event) => {
  document.documentElement.dir = event.target.checked ? 'rtl' : 'ltr';
});

render();

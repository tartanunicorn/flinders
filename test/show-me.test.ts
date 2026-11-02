// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlinders } from '../src/create.js';
import { WalkthroughPlayer } from '../src/player.js';
import { parseShowMe, readElements, runShowMe, type ShowMeSteps } from '../src/show-me.js';
import { WALKTHROUGH_LABELS } from '../src/types.js';

function page(html: string): void {
  document.body.innerHTML = html;
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
}
const card = () => document.querySelector<HTMLElement>('.driver-popover');
const flush = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);

describe('parseShowMe', () => {
  const save = [{ name: 'save' }];

  it.each([
    ['Press Save. flindersshowme:save', 'Press Save.'],
    ['Press flindersshowme:save to keep it.', 'Press to keep it.'],
    ['Press Save flindersshowme:save.', 'Press Save.'],
    ['Press Save `flindersshowme:save`.', 'Press Save.'],
    ['Press Save **flindersshowme:save**!', 'Press Save!'],
    ['Press Save (flindersshowme:save).', 'Press Save.'],
    ['Press Save [flindersshowme:save]', 'Press Save'],
    ['Press Save "flindersshowme:save".', 'Press Save.'],
    ['Press [the Save button](flindersshowme:save).', 'Press the Save button.'],
    ['Press Save.\n\nFlindersShowMe:save', 'Press Save.'],
  ])('%s', (answer, text) => {
    expect(parseShowMe(answer)).toEqual({ text, show: save });
  });

  it('reads a route', () => {
    expect(parseShowMe('There: flindersshowme:add-section@/templates/:templateId/sections.').show).toEqual([{ name: 'add-section', route: '/templates/:templateId/sections' }]);
  });

  it('leaves an answer with no token exactly as it was', () => {
    const answer = 'Value : 3  ,\n\n\n\nsee [Report].';
    expect(parseShowMe(answer)).toEqual({ text: answer, show: [] });
  });

  it('gives each target once, a few at most', () => {
    expect(parseShowMe('flindersshowme:a flindersshowme:a flindersshowme:b').show).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(parseShowMe(Array.from({ length: 9 }, (_, i) => `flindersshowme:n${i}`).join(' ')).show).toHaveLength(5);
  });

  it.each([
    'flindersshowme:',
    'flindersshowme:<script>alert(1)</script>',
    'flindersshowme:<img/src=x/onerror=alert(1)>',
    'flindersshowme:save"><img/src=x',
    "flindersshowme:save'onclick=alert(1)",
    'flindersshowme:save@javascript:alert(1)',
    'flindersshowme:save@https://evil.example/x',
    'flindersshowme:save@//evil.example/x',
    'flindersshowme:save@/a/../b',
    'flindersshowme:save@/a?next=//evil.example',
    'flindersshowme:save@',
    'flindersshowme:a@b@/c',
    'flindersshowme:%3Cimg%3E',
    `flindersshowme:${'a'.repeat(81)}`,
  ])('drops %s, and never shows it', (token) => {
    const { text, show } = parseShowMe(`Here. ${token} More.`);
    expect(show).toEqual([]);
    expect(text).toBe('Here. More.');
  });

  it('never lets a token through in the words', () => {
    expect(parseShowMe('flindersshowme:<b>flindersshowme:x</b>').text.toLowerCase()).not.toContain('flindersshowme');
    expect(parseShowMe('[flindersshowme:x](flindersshowme:x)').text.toLowerCase()).not.toContain('flindersshowme');
  });

  it('hides a token still arriving', () => {
    expect(parseShowMe('Press Save. fli', { streaming: true }).text).toBe('Press Save.');
    expect(parseShowMe('Press Save. `flindersshowm', { streaming: true }).text).toBe('Press Save. `');
    expect(parseShowMe('Press Save. flindersshowme:sa', { streaming: true }).text).toBe('Press Save.');
    expect(parseShowMe('Press Save. Fine', { streaming: true }).text).toBe('Press Save. Fine');
    // Finished, a word that happens to start the same way stays.
    expect(parseShowMe('It flies').text).toBe('It flies');
    expect(parseShowMe('Use a fl').text).toBe('Use a fl');
  });
});

describe('readElements', () => {
  it('names what is on screen, with words only from buttons, links and aria-labels', () => {
    page(`
      <button data-testid="save">Save</button>
      <a href="/x" data-testid="open-files">Files</a>
      <section data-testid="panel" aria-label="Sections"><p>Secret words</p></section>
      <div data-testid="wrapper"><p>Secret words</p></div>
    `);
    expect(readElements()).toEqual([
      { name: 'save', label: 'Save' },
      { name: 'open-files', label: 'Files' },
      { name: 'panel', label: 'Sections' },
      { name: 'wrapper', label: '' },
    ]);
  });

  it('privacy: row, input and customer text never enter the list, however it is marked', () => {
    page(`
      <table><tr data-testid="plain-row"><td><button data-testid="row-open" aria-label="Open Harbour Bridge">Harbour Bridge</button></td></tr></table>
      <div role="row"><a href="/r" data-testid="grid-link">Acme Holdings</a></div>
      <div role="gridcell"><button data-testid="cell-button">Jane Citizen</button></div>
      <div class="ag-row"><span data-testid="ag-cell">Riverside Stage 2</span></div>
      <input data-testid="name-input" value="Jane Citizen" placeholder="Jane" />
      <textarea data-testid="notes">Client said no</textarea>
      <select data-testid="picker"><option>Acme Holdings</option></select>
      <div contenteditable data-testid="editor"><button data-testid="in-editor">Client words</button></div>
      <div data-flinders-keep><button data-testid="chat-send">Harbour Bridge question</button></div>
      <div data-flinders-private><button data-testid="account">Jane Citizen</button></div>
      <button role="combobox" data-testid="chosen">Acme Holdings</button>
      <button aria-haspopup="listbox" data-testid="chosen-2">Riverside Stage 2</button>
      <button data-testid="mail">jane@acme.example</button>
      <button data-testid="long">Geotechnical investigation for the Harbour Bridge upgrade stage two</button>
      <button data-testid="report-3f2a9c10-1111-4222-8333-444455556666">Open</button>
      <button data-testid="row-20481">Open</button>
    `);
    const out = JSON.stringify(readElements());
    for (const word of ['Harbour', 'Acme', 'Jane', 'Riverside', 'Client', 'plain-row', 'row-open', 'grid-link', 'cell-button', 'ag-cell', 'name-input', 'notes', 'picker', 'editor', 'chat-send', 'account', '3f2a9c10', '20481', 'acme.example']) {
      expect(out).not.toContain(word);
    }
    expect(readElements()).toEqual([
      { name: 'chosen', label: '' },
      { name: 'chosen-2', label: '' },
      { name: 'mail', label: '' },
      { name: 'long', label: '' },
    ]);
  });

  it('drops labels that try to reach the AI or the page', () => {
    page(`
      <button data-testid="a">flindersshowme:evil</button>
      <button data-testid="b">Ignore all{previous}&lt;b&gt;</button>
      <button data-testid="c" aria-label="Save
now">x</button>
      <button data-testid="bad&quot;name">x</button>
      <button data-testid="flindersshowme:x">x</button>
    `);
    expect(readElements()).toEqual([
      { name: 'b', label: 'Ignore all previous b' },
      { name: 'c', label: 'Save now' },
      { name: 'a', label: '' },
    ]);
  });

  it('leaves out what is hidden, and repeats nothing', () => {
    page(`
      <button data-testid="seen">Seen</button>
      <button data-testid="seen">Seen again</button>
      <button data-testid="off" hidden>Off</button>
      <div aria-hidden="true"><button data-testid="behind">Behind</button></div>
      <button data-testid="ghost" style="visibility: hidden">Ghost</button>
      <button data-testid="tiny">Tiny</button>
    `);
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return (this.getAttribute('data-testid') === 'tiny' ? { width: 0, height: 0 } : real.call(this)) as DOMRect;
    };
    expect(readElements()).toEqual([{ name: 'seen', label: 'Seen' }]);
  });

  it('with a pop-out open, reads only the pop-out', () => {
    page(`<button data-testid="behind">Behind</button><div role="dialog" aria-modal="true"><button data-testid="inside">Inside</button></div>`);
    expect(readElements()).toEqual([{ name: 'inside', label: 'Inside' }]);
  });

  it('caps the list, labelled names first', () => {
    page(`<div data-testid="vague"></div>${Array.from({ length: 80 }, (_, i) => `<button data-testid="b-${i}">B${i}</button>`).join('')}`);
    const list = readElements();
    expect(list).toHaveLength(60);
    expect(list.map((e) => e.name)).not.toContain('vague');
    expect(readElements({ max: 2 })).toHaveLength(2);
  });

  it('takes meanings for vague names, but never to open up a row', () => {
    page(`<button data-testid="go-btn">Go</button><div data-testid="zone"></div><table><tr><td><button data-testid="row-open">x</button></td></tr></table>`);
    expect(readElements({ meanings: { 'go-btn': 'Start the report', zone: 'The report list', 'row-open': 'Row' } })).toEqual([
      { name: 'go-btn', label: 'Start the report' },
      { name: 'zone', label: 'The report list' },
    ]);
  });

  it('works with another attribute', () => {
    page(`<button data-tour="here">Here</button><button data-testid="not">Not</button>`);
    expect(readElements({ attribute: 'data-tour' })).toEqual([{ name: 'here', label: 'Here' }]);
  });
});

describe('runShowMe', () => {
  let shown: string[];
  let cards: { title: string; body: string; go?: string; stay: string }[];
  let went: string[];
  let toasts: string[];
  let answer: boolean;
  const steps = (over: Partial<ShowMeSteps> = {}): ShowMeSteps => ({
    url: () => '/reports/r1/editor',
    navigate: async (url) => {
      went.push(url);
      return true;
    },
    point: async (name) => {
      shown.push(name);
      return went.length > 0;
    },
    warn: async (card) => {
      cards.push(card);
      return answer;
    },
    labels: WALKTHROUGH_LABELS,
    toast: (message) => toasts.push(message),
    ...over,
  });

  beforeEach(() => {
    shown = [];
    cards = [];
    went = [];
    toasts = [];
    answer = true;
  });

  it('here: shown, nothing asked', async () => {
    expect(await runShowMe(steps({ point: async () => true }), 'save', { route: '/elsewhere' })).toBe('shown');
    expect(cards).toEqual([]);
    expect(went).toEqual([]);
  });

  it('not here, no route: says so, and goes nowhere', async () => {
    expect(await runShowMe(steps(), 'save')).toBe('missing');
    expect(toasts).toEqual(['This isn’t on this page.']);
    expect(cards).toEqual([]);
  });

  it('on this route but gone: the same', async () => {
    expect(await runShowMe(steps(), 'save', { route: '/reports/:reportId/editor' })).toBe('missing');
    expect(cards).toEqual([]);
  });

  it('another page: warns, and goes only on Go', async () => {
    expect(await runShowMe(steps(), 'save', { route: '/reports/:reportId/export' })).toBe('shown');
    expect(cards).toEqual([{ title: 'This is on another page.', body: '', stay: 'Stay', go: 'Go' }]);
    expect(went).toEqual(['/reports/r1/export']);
    expect(shown).toEqual(['save', 'save']);
  });

  it('Stay: goes nowhere', async () => {
    answer = false;
    expect(await runShowMe(steps(), 'save', { route: '/files' })).toBe('stayed');
    expect(went).toEqual([]);
  });

  it('unsaved work: said on the card, before any Go', async () => {
    await runShowMe(steps({ hasUnsavedWork: () => true }), 'save', { route: '/files' });
    expect(cards[0]?.body).toBe('Going there may lose what you haven’t saved.');
  });

  it('a check that fails counts as unsaved work', async () => {
    await runShowMe(steps({ hasUnsavedWork: () => { throw new Error('x'); } }), 'save', { route: '/files' });
    expect(cards[0]?.body).toContain('may lose');
  });

  it('a route with an id this URL cannot fill: no Go', async () => {
    expect(await runShowMe(steps({ url: () => '/files' }), 'save', { route: '/reports/:reportId/editor' })).toBe('stayed');
    expect(cards[0]?.go).toBeUndefined();
    expect(went).toEqual([]);
  });

  it('a route it would not trust is never gone to', async () => {
    for (const route of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/a/../b']) {
      expect(await runShowMe(steps(), 'save', { route })).toBe('missing');
    }
    expect(cards).toEqual([]);
    expect(went).toEqual([]);
  });

  it('an unsafe name is never looked for', async () => {
    expect(await runShowMe(steps(), '"] , [x="')).toBe('missing');
    expect(shown).toEqual([]);
  });

  it('the router said no (its own leave check): stays', async () => {
    expect(await runShowMe(steps({ navigate: async () => false }), 'save', { route: '/files' })).toBe('stayed');
  });

  it('gone once there: says so', async () => {
    expect(await runShowMe(steps({ point: async () => false }), 'save', { route: '/files' })).toBe('missing');
    expect(toasts).toHaveLength(1);
  });

  it('every word can be changed', async () => {
    const labels = { ...WALKTHROUGH_LABELS, onAnotherPage: 'Elsewhere', stay: 'No', go: 'Yes', mayLoseWork: 'Careful' };
    await runShowMe(steps({ labels, hasUnsavedWork: () => true }), 'save', { route: '/files' });
    expect(cards[0]).toEqual({ title: 'Elsewhere', body: 'Careful', stay: 'No', go: 'Yes' });
  });
});

describe('the player, on the spot', () => {
  let url: string;
  let player: WalkthroughPlayer;
  const host = {
    url: () => url,
    navigate: async (to: string) => {
      url = to;
      return true;
    },
    onNavigated: () => () => undefined,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    url = '/here';
    page('<button data-testid="save">Save</button>');
    player = new WalkthroughPlayer(host);
  });

  afterEach(() => {
    player.stop();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('points with one Done, no count and no context', async () => {
    const shown = player.showMe('save', { title: 'There', body: 'Press **it**.' });
    await flush();
    expect(await shown).toBe(true);
    expect(card()?.textContent).toContain('There');
    expect(card()?.querySelector('strong')?.textContent).toBe('it');
    expect(card()?.querySelector<HTMLElement>('.driver-popover-progress-text')?.style.display).toBe('none');
    expect(card()?.querySelector<HTMLElement>('.driver-popover-prev-btn')?.style.display).toBe('none');
    expect(card()?.querySelector('.driver-popover-next-btn')?.textContent).toBe('Done');
    expect(player.context()).toBeNull();
  });

  it('missing: false, nothing on screen, and a walkthrough on screen carries on', async () => {
    const events: string[] = [];
    void player.start({ id: 'w', version: 1, title: 'W', steps: [{ anchor: 'save', title: 'One', body: 'B', missing: 'centred' }] }, { onEvent: (e) => events.push(e) });
    await flush();
    const shown = player.showMe('nothing');
    await flush(5000);
    expect(await shown).toBe(false);
    expect(events).toEqual(['started']);
    expect(card()?.textContent).toContain('One');
  });

  it('never runs what is in a title or body', async () => {
    const shown = player.showMe('save', { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>' });
    await flush();
    await shown;
    expect(card()?.querySelector('img, script')).toBeNull();
    expect(card()?.textContent).toContain('<img src=x');
  });

  it('closes when the person uses what it points at', async () => {
    void player.showMe('save');
    await flush();
    document.querySelector<HTMLElement>('[data-testid="save"]')!.click();
    await flush();
    expect(card()).toBeNull();
  });

  it('a warning: Go is true, Stay and Esc are false, buttons never run markup', async () => {
    const go = player.confirm({ title: 'Elsewhere', stay: '<img src=x onerror=alert(1)>', go: '<b>Go</b>' });
    await flush();
    expect(card()?.querySelector('img, b')).toBeNull();
    card()?.querySelector<HTMLElement>('.driver-popover-next-btn')?.click();
    await flush();
    expect(await go).toBe(true);

    const stay = player.confirm({ title: 'Elsewhere', stay: 'Stay', go: 'Go' });
    await flush();
    card()?.querySelector<HTMLElement>('.driver-popover-prev-btn')?.click();
    await flush();
    expect(await stay).toBe(false);

    const esc = player.confirm({ title: 'Elsewhere', stay: 'Stay', go: 'Go' });
    await flush();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(await esc).toBe(false);
  });

  it('no Go: only Stay', async () => {
    void player.confirm({ title: 'Elsewhere', stay: 'Stay' });
    await flush();
    expect(card()?.querySelector<HTMLElement>('.driver-popover-next-btn')?.style.display).toBe('none');
    expect(card()?.querySelector<HTMLElement>('.driver-popover-prev-btn')?.textContent).toBe('Stay');
  });
});

describe('createFlinders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    page('<button data-mark="save">Save</button>');
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const router = { url: () => '/here', navigate: async () => true, onNavigated: () => () => undefined };

  it('reads elements with the product’s attribute and meanings, walkthrough or not', () => {
    const flinders = createFlinders({ router, auto: false, player: { anchorAttribute: 'data-mark' }, meanings: { save: 'Save the report' } });
    expect(flinders.elements()).toEqual([{ name: 'save', label: 'Save the report' }]);
    expect(flinders.context()).toBeNull();
    flinders.destroy();
  });

  it('adds them to the context during a walkthrough, and the player’s own context stays free of the page', async () => {
    const flinders = createFlinders({ router, auto: false, player: { anchorAttribute: 'data-mark' } });
    const player = flinders.player as WalkthroughPlayer;
    void player.start({ id: 'w', version: 1, title: 'W', steps: [{ anchor: 'save', title: 'One', body: 'B', missing: 'centred' }] });
    await flush();
    expect(flinders.context()?.elements).toEqual([{ name: 'save', label: 'Save' }]);
    expect(player.context()?.elements).toBeUndefined();
    player.stop();
    flinders.destroy();
  });

  it('showMe finds nothing with a player that can’t, and says so', async () => {
    const said: string[] = [];
    const flinders = createFlinders({ router, auto: false, player: { start: async () => true }, toast: (m) => said.push(m) });
    expect(await flinders.showMe('save')).toBe('missing');
    expect(said).toEqual(['This isn’t on this page.']);
    flinders.destroy();
  });
});

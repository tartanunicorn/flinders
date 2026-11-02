import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Outlet, RouterProvider, useLocation, useParams } from 'react-router';
import { createFlinders, type AdminWalkthrough, type OfferAnswer, type Walkthrough, type WalkthroughOffer } from 'flinders';
import type { PlayerCard } from 'flinders/player';
import 'flinders/player.css';

import { inPageServer } from './walkthroughs';

// ── The offer: Flinders decides when, React draws it ─────────────────────────
type Shown = WalkthroughOffer & { answer(value: OfferAnswer): void };
let shown: Shown | null = null;
const watchers = new Set<() => void>();
const showing = (next: Shown | null) => {
  shown = next;
  watchers.forEach((watcher) => watcher());
};

function Offer() {
  const offer = useSyncExternalStore((watcher) => (watchers.add(watcher), () => watchers.delete(watcher)), () => shown);
  if (!offer) return null;
  const answer = (value: OfferAnswer) => {
    showing(null);
    offer.answer(value);
  };
  return (
    <aside data-testid="offer">
      <span>New here? {offer.title}</span>
      <button onClick={() => answer(false)}>{offer.dismissLabel}</button>
      <button onClick={() => answer(true)}>{offer.acceptLabel}</button>
    </aside>
  );
}

// ── Flinders: one call, before the router, one connector for each thing the app has ──
const flinders = createFlinders({
  http: { request: inPageServer },
  router: {
    url: () => router.state.location.pathname + router.state.location.search,
    navigate: (to) => router.navigate(to).then(() => true, () => false),
    onNavigated: (listener) => router.subscribe(({ location }) => listener(location.pathname + location.search)),
    routePattern: (url) => url.split('?')[0]!.replace(/\/projects\/[^/]+/, '/projects/:projectId'),
  },
  identity: { can: () => true },
  offers: {
    show: (offer) => new Promise((answer) => showing({ ...offer, answer })),
    clear: () => showing(null),
  },
  toast: (message) => console.log(message),
  player: {
    // Design level 3: the card is a React component. flushSync, as the player measures it straight after.
    renderCard(container, card) {
      const root = createRoot(container);
      flushSync(() => root.render(<Card card={card} />));
      return () => root.unmount();
    },
  },
});

function Card({ card }: { card: PlayerCard }) {
  return (
    <>
      <h3>{card.title}</h3>
      {/* bodyHtml is the package's own escaped text with **bold**, so it is safe to set. */}
      <p dangerouslySetInnerHTML={{ __html: card.bodyHtml }} />
      <footer>
        <small>{card.progress}</small>
        <button onClick={card.finishLater}>Later</button>
        {card.canGoBack && <button onClick={card.back}>Back</button>}
        {card.showNext && <button onClick={card.next}>{card.nextLabel}</button>}
      </footer>
    </>
  );
}

// ── The chat: `matching` returns JSON, the chat words its own answer ─────────
function Chat() {
  const { pathname } = useLocation();
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ walkthrough: Walkthrough; here: boolean }[] | null>(null);
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setAnswers((await flinders.controller?.matching(pathname, question)) ?? []);
  };
  return (
    <section data-testid="chat">
      <form onSubmit={(event) => void ask(event)}>
        <input aria-label="Ask" placeholder="Show me how to add a note" value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="chat-input" />
        <button>Ask</button>
      </form>
      {answers?.length === 0 && <p>I couldn’t find a walkthrough on that.</p>}
      {answers?.map(({ walkthrough, here }) => (
        <p key={walkthrough.walkthrough_id}>
          {walkthrough.title} {here ? '(on this page)' : ''} <button onClick={() => void flinders.start(walkthrough.handle, 'chat')}>Show me</button>
        </p>
      ))}
    </section>
  );
}

// ── The pages ────────────────────────────────────────────────────────────────
function Home() {
  return <Link to="/projects/1" data-testid="project-1">Project 1</Link>;
}

function Project() {
  return (
    <>
      <h2>Project {useParams().id}</h2>
      <p><label>Notes <input data-testid="project-notes" /></label></p>
      <button data-testid="save">Save</button>
    </>
  );
}

function Admin() {
  const [rows, setRows] = useState<AdminWalkthrough[]>([]);
  useEffect(() => {
    void flinders.api?.admin.list().then((list) => list.ok && setRows(list.data));
  }, []);
  return (
    <ul data-testid="admin-list">
      {rows.map((row) => (
        <li key={row.handle}>
          {row.title}: {row.mode}, version {row.live_version} live, {row.steps_count} steps{row.problems.length ? ', needs update' : ''}
        </li>
      ))}
    </ul>
  );
}

function Layout() {
  return (
    <>
      <nav><Link to="/">Projects</Link> <Link to="/admin">Admin</Link> <button onClick={() => void flinders.record()}>Record</button></nav>
      <Offer />
      <main><Outlet /></main>
      <Chat />
    </>
  );
}

const router = createBrowserRouter([
  { element: <Layout />, children: [{ path: '/', element: <Home /> }, { path: '/projects/:id', element: <Project /> }, { path: '/admin', element: <Admin /> }] },
]);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);

'use client';

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createFlinders, type Flinders, type OfferAnswer, type WalkthroughOffer } from 'flinders';

// ── The offer: Flinders decides when, React draws it ─────────────────────────
type Shown = WalkthroughOffer & { answer(value: OfferAnswer): void };
let shown: Shown | null = null;
const watchers = new Set<() => void>();
const showing = (next: Shown | null) => {
  shown = next;
  watchers.forEach((watcher) => watcher());
};

function Offer() {
  const offer = useSyncExternalStore((watcher) => (watchers.add(watcher), () => watchers.delete(watcher)), () => shown, () => null);
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

// ── The router connector, on the App Router ──────────────────────────────────
// The App Router has no navigation events, so a change of pathname tells the listeners.
const here = () => location.pathname + location.search;
const listeners = new Set<(url: string) => void>();

/** Resolves once the address is `to`, or false if it never gets there. */
const arrival = (to: string) =>
  new Promise<boolean>((resolve) => {
    const want = to.split('#')[0]!;
    if (here() === want) return resolve(true);
    const done = (ok: boolean) => {
      listeners.delete(seen);
      clearTimeout(timer);
      resolve(ok);
    };
    const seen = (url: string) => url === want && done(true);
    const timer = setTimeout(() => done(here() === want), 10_000);
    listeners.add(seen);
  });

const FlindersContext = createContext<Flinders | null>(null);

/** The Flinders object, or null before it has started in the browser. */
export const useFlinders = () => useContext(FlindersContext);

/** Starts Flinders once, in the browser, and keeps it in step with the App Router. Put it in the root layout. */
export function FlindersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [flinders, setFlinders] = useState<Flinders | null>(null);

  useEffect(() => {
    const made = createFlinders({
      http: { baseUrl: '/api/flinders' },
      router: {
        url: here,
        navigate: (to) => {
          const arrived = arrival(to);
          routerRef.current.push(to);
          return arrived;
        },
        onNavigated: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
        // Your own route table: /projects/12 to /projects/:projectId. Recording needs this.
        routePattern: (url) => url.split('?')[0]!.replace(/^\/projects\/[^/]+/, '/projects/:projectId'),
      },
      identity: { can: () => true }, // Your own permissions.
      offers: {
        show: (offer) => new Promise((answer) => showing({ ...offer, answer })),
        clear: () => showing(null),
      },
      toast: (message) => console.log(message), // Swap for your own toast.
    });
    setFlinders(made);
    return () => made.destroy();
  }, []);

  // After each move, once the new page has drawn.
  useEffect(() => {
    const url = here();
    listeners.forEach((listener) => listener(url));
  }, [pathname]);

  return (
    <FlindersContext.Provider value={flinders}>
      <Offer />
      {children}
    </FlindersContext.Provider>
  );
}

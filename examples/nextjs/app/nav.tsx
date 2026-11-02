'use client';

import Link from 'next/link';

import { useFlinders } from './flinders-client';

export function Nav() {
  const flinders = useFlinders();
  return (
    <nav>
      <Link href="/">Projects</Link>
      <Link href="/admin">Admin</Link>
      <button onClick={() => void flinders?.record()} disabled={!flinders}>Record</button>
    </nav>
  );
}

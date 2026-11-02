import type { ReactNode } from 'react';
import 'flinders/player.css';

import { FlindersProvider } from './flinders-client';
import { Nav } from './nav';
import { Chat } from './chat';
import './app.css';

export const metadata = { title: 'Flinders with Next.js' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FlindersProvider>
          <Nav />
          <main>{children}</main>
          <Chat />
        </FlindersProvider>
      </body>
    </html>
  );
}

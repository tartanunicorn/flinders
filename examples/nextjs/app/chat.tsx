'use client';

import { useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import type { Walkthrough } from 'flinders';

import { useFlinders } from './flinders-client';

// The chat: `matching` returns JSON, and the chat words its own answer.
export function Chat() {
  const flinders = useFlinders();
  const pathname = usePathname();
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ walkthrough: Walkthrough; here: boolean }[] | null>(null);
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setAnswers((await flinders?.controller?.matching(pathname, question)) ?? []);
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
          {walkthrough.title} {here ? '(on this page)' : ''} <button onClick={() => void flinders?.start(walkthrough.handle, 'chat')}>Show me</button>
        </p>
      ))}
    </section>
  );
}

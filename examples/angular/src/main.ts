import { ApplicationRef, Component, createComponent, EnvironmentInjector, inject, Injectable, input, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, provideRouter, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { createFlinders, type AdminWalkthrough, type OfferAnswer, type Walkthrough, type WalkthroughOffer } from 'flinders';
import type { PlayerCard } from 'flinders/player';

import { inPageServer } from './walkthroughs';

// ── The card, as an Angular component (design level 3) ───────────────────────
@Component({
  selector: 'app-card',
  // bodyHtml is the package's own escaped text with **bold**, so it is safe to bind.
  template: `
    <h3>{{ card().title }}</h3>
    <p [innerHTML]="card().bodyHtml"></p>
    <footer>
      <small>{{ card().progress }}</small>
      <button (click)="card().finishLater()">Later</button>
      @if (card().canGoBack) { <button (click)="card().back()">Back</button> }
      @if (card().showNext) { <button (click)="card().next()">{{ card().nextLabel }}</button> }
    </footer>
  `,
})
class Card {
  readonly card = input.required<PlayerCard>();
}

// ── Flinders: one call, one connector for each thing the app has ─────────────
// Angular makes this service after the router has started, which is fine here. A real app with a
// sign-in redirect adds `new RecordingTab()` at the top of main.ts (see docs/recording.md).
@Injectable({ providedIn: 'root' })
class Walkthroughs {
  private readonly router = inject(Router);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly app = inject(ApplicationRef);
  private answer: ((value: OfferAnswer) => void) | null = null;

  /** What the offer draws. */
  readonly offer = signal<WalkthroughOffer | null>(null);

  readonly flinders = createFlinders({
    http: { request: inPageServer },
    router: {
      url: () => this.router.url,
      navigate: (url) => this.router.navigateByUrl(url),
      onNavigated: (listener) => {
        const subscription = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => listener(e.urlAfterRedirects));
        return () => subscription.unsubscribe();
      },
      routePattern: (url) => url.split('?')[0]!.replace(/\/projects\/[^/]+/, '/projects/:projectId'),
    },
    identity: { can: () => true },
    offers: {
      show: (offer) =>
        new Promise((answer) => {
          this.answer = answer;
          this.offer.set(offer);
        }),
      clear: () => this.offer.set(null),
    },
    toast: (message) => console.log(message),
    player: {
      renderCard: (container, card) => {
        const ref = createComponent(Card, { environmentInjector: this.environmentInjector, hostElement: container });
        ref.setInput('card', card);
        this.app.attachView(ref.hostView);
        ref.changeDetectorRef.detectChanges();
        return () => ref.destroy();
      },
    },
  });

  answered(value: OfferAnswer): void {
    this.offer.set(null);
    this.answer?.(value);
    this.answer = null;
  }
}

// ── The offer: Flinders decides when, Angular draws it ───────────────────────
@Component({
  selector: 'app-offer',
  template: `
    @if (walkthroughs.offer(); as offer) {
      <aside data-testid="offer">
        <span>New here? {{ offer.title }}</span>
        <button (click)="walkthroughs.answered(false)">{{ offer.dismissLabel }}</button>
        <button (click)="walkthroughs.answered(true)">{{ offer.acceptLabel }}</button>
      </aside>
    }
  `,
})
class Offer {
  protected readonly walkthroughs = inject(Walkthroughs);
}

// ── The chat: `matching` returns JSON, the chat words its own answer ─────────
@Component({
  selector: 'app-chat',
  template: `
    <section data-testid="chat">
      <form (submit)="ask($event, question.value)">
        <input #question aria-label="Ask" placeholder="Show me how to add a note" data-testid="chat-input" />
        <button>Ask</button>
      </form>
      @if (answers()?.length === 0) { <p>I couldn’t find a walkthrough on that.</p> }
      @for (answer of answers(); track answer.walkthrough.walkthrough_id) {
        <p>
          {{ answer.walkthrough.title }} {{ answer.here ? '(on this page)' : '' }}
          <button (click)="flinders.start(answer.walkthrough.handle, 'chat')">Show me</button>
        </p>
      }
    </section>
  `,
})
class Chat {
  private readonly router = inject(Router);
  protected readonly flinders = inject(Walkthroughs).flinders;
  protected readonly answers = signal<{ walkthrough: Walkthrough; here: boolean }[] | null>(null);

  protected async ask(event: Event, question: string): Promise<void> {
    event.preventDefault();
    this.answers.set((await this.flinders.controller?.matching(this.router.url, question)) ?? []);
  }
}

// ── The pages ────────────────────────────────────────────────────────────────
@Component({ imports: [RouterLink], template: `<a routerLink="/projects/1" data-testid="project-1">Project 1</a>` })
class Home {}

@Component({
  template: `
    <h2>Project {{ id }}</h2>
    <p><label>Notes <input data-testid="project-notes" /></label></p>
    <button data-testid="save">Save</button>
  `,
})
class Project {
  protected readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
}

@Component({
  template: `
    <ul data-testid="admin-list">
      @for (row of rows(); track row.handle) {
        <li>{{ row.title }}: {{ row.mode }}, version {{ row.live_version }} live, {{ row.steps_count }} steps{{ row.problems.length ? ', needs update' : '' }}</li>
      }
    </ul>
  `,
})
class Admin {
  protected readonly rows = signal<AdminWalkthrough[]>([]);

  constructor() {
    void inject(Walkthroughs).flinders.api?.admin.list().then((list) => list.ok && this.rows.set(list.data));
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, Offer, Chat],
  template: `
    <nav><a routerLink="/">Projects</a> <a routerLink="/admin">Admin</a> <button (click)="flinders.record()">Record</button></nav>
    <app-offer />
    <main><router-outlet /></main>
    <app-chat />
  `,
})
class App {
  protected readonly flinders = inject(Walkthroughs).flinders;
}

void bootstrapApplication(App, {
  providers: [provideRouter([{ path: '', component: Home }, { path: 'projects/:id', component: Project }, { path: 'admin', component: Admin }])],
});

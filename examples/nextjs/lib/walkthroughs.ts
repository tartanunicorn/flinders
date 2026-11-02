// The walkthrough files. A real app keeps them as JSON in its repo, and checks them with flinders-check.
export const walkthroughFiles = [
  {
    number: 1,
    slug: 'find-your-way',
    title: 'Find your way round',
    mode: 'show',
    offer_on: '/',
    steps: [
      { anchor: 'project-1', route: '/', title: 'Your projects', body: 'Each project is listed **here**.', missing: 'centred' },
      { anchor: 'project-notes', route: '/projects/1', title: 'Notes', body: 'Each project keeps its notes on its own page.', missing: 'centred' },
    ],
  },
  {
    number: 2,
    slug: 'add-a-note',
    title: 'Add a note',
    mode: 'guide',
    offer_on: null,
    steps: [
      { anchor: 'project-1', route: '/', title: 'Open the project', body: 'Open **Project 1**.', missing: 'centred', done_when: { kind: 'route', route: '/projects/:projectId' } },
      { anchor: 'project-notes', route: '/projects/:projectId', title: 'Write a note', body: 'Type anything here.', missing: 'centred', done_when: { kind: 'filled' } },
      { anchor: 'save', title: 'Save it', body: 'Press **Save** and you are done.', missing: 'centred', done_when: { kind: 'clicked' } },
    ],
  },
];

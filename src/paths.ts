import type { WalkthroughStep } from './types.js';

/**
 * Reading forks from the flat step list. Nothing here is stored: a fork is neighbouring `only_if`
 * steps, and neighbouring steps with the same `only_if` are one path, because they apply or don't
 * together. The player, the step table and the recorder all read the list through these.
 */
type Forkable = Pick<WalkthroughStep, 'only_if'>;

const pathKey = (step: Forkable) => [step.only_if ?? []].flat().sort().join('\n');

/** Two steps of one path: the same `only_if`, in any order, as one element or a list of it. */
export const samePath = (a: Forkable | undefined, b: Forkable | undefined): boolean => !!a?.only_if && !!b?.only_if && pathKey(a) === pathKey(b);

/** The first and last step of the path a step is on. */
export function pathAround(steps: readonly Forkable[], index: number): { first: number; last: number } {
  let first = index;
  let last = index;
  while (samePath(steps[first - 1], steps[index])) first--;
  while (samePath(steps[last + 1], steps[index])) last++;
  return { first, last };
}

/** The first and last step of the fork a step is on. */
export function forkAround(steps: readonly Forkable[], index: number): { first: number; last: number } {
  let first = index;
  let last = index;
  while (steps[first - 1]?.only_if) first--;
  while (steps[last + 1]?.only_if) last++;
  return { first, last };
}

/**
 * Each step's number on the card, and how many there are. A step counts one, and a fork as many as
 * its longest path, numbered from where it starts on every path. The player can't see which path a
 * person will take, so someone on a shorter path jumps to the number after the fork.
 */
export function stepPlaces(steps: readonly Forkable[]): { places: number[]; total: number } {
  const places: number[] = [];
  let place = 0;
  for (let i = 0; i < steps.length; ) {
    if (!steps[i]!.only_if) {
      places[i++] = ++place;
      continue;
    }
    const { last: end } = forkAround(steps, i);
    let longest = 0;
    while (i <= end) {
      const { first, last } = pathAround(steps, i);
      for (let at = first; at <= last; at++) places[at] = place + at - first + 1;
      longest = Math.max(longest, last - first + 1);
      i = last + 1;
    }
    place += longest;
  }
  return { places, total: place };
}

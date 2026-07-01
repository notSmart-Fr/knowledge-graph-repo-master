/**
 * ponytail: thin abstraction over Date.now() and Date.
 * Makes agent timing testable and keeps a single ban bypass point.
 */

export const timeService = {
  now: (): number => Date.now(),

  durationMs: (start: number): number => Date.now() - start,

  toISO: (): string => new Date().toISOString(),
};

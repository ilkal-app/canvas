import { z } from 'zod';

/** The end decorations a line or connector can carry; arrowheads are caps. */
export const LINE_CAPS = ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const;

/** Validates a line or connector end cap: one of {@link LINE_CAPS}. */
export const lineCapSchema = z
  .enum(LINE_CAPS)
  .describe('End decoration: none, arrow (open), triangle (filled), circle or diamond.');

/** An end decoration of a line or connector. */
export type LineCap = (typeof LINE_CAPS)[number];

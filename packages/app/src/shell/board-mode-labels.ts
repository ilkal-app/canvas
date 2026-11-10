import type { BoardMode } from '@canvas/schema';

/**
 * Each board mode's short name, its product's: `Boards`, `Design`,
 * `Draw`, `Motion` and `Slides`, with diagrams part of Boards. The board-name bar showed it under
 * the title until.
 */
export const BOARD_MODE_LABELS: Readonly<Record<BoardMode, string>> = Object.freeze({
  whiteboard: 'Boards',
  uiux: 'Design',
  diagram: 'Boards',
  illustration: 'Draw',
  motion: 'Motion',
  slides: 'Slides',
});

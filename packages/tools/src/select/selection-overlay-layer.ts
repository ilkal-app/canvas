import type { EngineOverlay, GpuBackend } from '@canvas/engine';

import type { OrientedBox } from './oriented-box.js';
import type { SelectionOverlayModel } from './overlay-rects.js';
import { SelectionOverlay } from './selection-overlay.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOrientedBox(value: unknown): value is OrientedBox {
  return (
    isRecord(value) &&
    ['x', 'y', 'width', 'height', 'rotation'].every((key) => isFiniteNumber(value[key]))
  );
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isWorldBounds(value: unknown): boolean {
  return (
    isRecord(value) && ['minX', 'minY', 'maxX', 'maxY'].every((key) => isFiniteNumber(value[key]))
  );
}

function isOverlayRect(value: unknown): boolean {
  if (!isRecord(value) || !isOrientedBox(value.box)) return false;
  return isColor(value.color);
}

function isColor(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function isPalette(value: unknown): boolean {
  return isRecord(value) && ['you', 'guide', 'hover', 'locked'].every((key) => isColor(value[key]));
}

function isGap(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.axis === 'x' || value.axis === 'y') &&
    ['position', 'from', 'to'].every((key) => isFiniteNumber(value[key]))
  );
}

const LABEL_KINDS: ReadonlySet<string> = new Set(['size', 'extent', 'gap', 'locked', 'connect']);

function isLabel(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    LABEL_KINDS.has(value.kind) &&
    typeof value.text === 'string' &&
    isRecord(value.at) &&
    isFiniteNumber(value.at.x) &&
    isFiniteNumber(value.at.y) &&
    (value.axis === undefined || value.axis === 'x' || value.axis === 'y')
  );
}

function isListOf(value: unknown, isItem: (item: unknown) => boolean): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isItem));
}

function isGuide(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.axis === 'x' || value.axis === 'y') &&
    ['position', 'from', 'to'].every((key) => isFiniteNumber(value[key]))
  );
}

/**
 * Checks a selection overlay model that crossed a thread: its frame, drop target, entered group
 * and hover outline (boxes or absent), outlines (boxes), count badge (a positive integer or
 * absent), resize and lock flags, marquee (bounds or absent), snapping guides and gap runs (lists,
 * or absent), palette (four four-channel colours, or absent), labels (a list of kinds, text and
 * anchors, or absent) and tool rectangles (boxes with a four-channel colour; absent reads as
 * none), all finite. Pure.
 *
 * @param value - The received model.
 * @returns Whether it is a well-formed `SelectionOverlayModel` (`toolRects` may be missing).
 */
export function isSelectionOverlayModel(
  value: unknown,
): value is Omit<SelectionOverlayModel, 'toolRects'> & Partial<SelectionOverlayModel> {
  if (!isRecord(value)) return false;
  const {
    frame,
    outlines,
    countBadge,
    canResize,
    isLocked,
    marquee,
    dropTarget,
    insertion,
    enteredGroup,
    guides,
    toolRects,
    hover,
    palette,
  } = value;
  return (
    (frame === undefined || isOrientedBox(frame)) &&
    (hover === undefined || isOrientedBox(hover)) &&
    (palette === undefined || isPalette(palette)) &&
    isListOf(value.gaps, isGap) &&
    isListOf(value.labels, isLabel) &&
    (dropTarget === undefined || isOrientedBox(dropTarget)) &&
    (insertion === undefined || isOrientedBox(insertion)) &&
    (enteredGroup === undefined || isOrientedBox(enteredGroup)) &&
    Array.isArray(outlines) &&
    outlines.every(isOrientedBox) &&
    (countBadge === undefined || isCount(countBadge)) &&
    (typeof canResize === 'boolean' || canResize === 'x' || canResize === 'y') &&
    typeof isLocked === 'boolean' &&
    (marquee === undefined || isWorldBounds(marquee)) &&
    (guides === undefined || (Array.isArray(guides) && guides.every(isGuide))) &&
    (toolRects === undefined || (Array.isArray(toolRects) && toolRects.every(isOverlayRect)))
  );
}

/**
 * The select tool's overlay ({@link SelectionOverlay}) as an engine host's overlay layer
 * (`EngineOverlay`, for an engine in a worker): the select tool stays on the page and sends its
 * model through `EngineHost.setOverlay`; this layer, created where the engine renders (the app's
 * engine worker script, or the main-thread host), draws it after the scene at each frame's zoom,
 * pixel for pixel as a `SelectionOverlay` on the page does. A model that is not a
 * `SelectionOverlayModel` is refused (the host reports it as a fault). Runs on the thread that
 * renders.
 *
 * @param backend - The host's backend.
 * @returns The layer.
 */
export function createSelectionOverlayLayer(backend: GpuBackend): EngineOverlay {
  const overlay = new SelectionOverlay(backend);
  return {
    install: (frame) => {
      overlay.install(frame);
    },
    setModel: (model) => {
      if (!isSelectionOverlayModel(model)) return false;
      overlay.setModel({ ...model, toolRects: model.toolRects ?? [] });
      return true;
    },
    destroy: () => {
      overlay.destroy();
    },
  };
}

// SVG markup into board objects: design tools, Figma's MCP among them, hand icons and
// vectors over as SVG. Each `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`
// and `<polygon>` becomes a `path` object (or a `shape` where one draws it exactly), with its fill
// and stroke, every transform and the `viewBox` applied, in the frame of the group the caller
// makes for it (its origin the viewport's top-left). What the board cannot draw (filters, masks,
// clipping, text, images, patterns, external references, dashes, non-round caps and joins) is
// drawn without, approximated or left out, and always reported. The markup is untrusted: it is
// read as data (`readSvgXml`), nothing in it runs or loads, and its size and what it expands to
// are capped (`SVG_IMPORT_LIMITS`). Pure.

import type { Rgba } from '../fields/color.js';

import { reportEffects } from './svg-clip.js';
import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import { computeStyle, INITIAL_STYLE, type SvgStyle } from './svg-style.js';
import { rootViewport } from './svg-viewport.js';
import { visit } from './svg-visit.js';
import {
  ImportRefusal,
  report,
  type SvgImportedObject,
  type SvgImportIssue,
  type Walk,
} from './svg-walk.js';
import { readSvgXml, type SvgElement } from './svg-xml.js';

export type {
  SvgImportedObject,
  SvgImportedPath,
  SvgImportedShape,
  SvgImportIssue,
} from './svg-walk.js';

/** How an import is sized and coloured. */
export interface SvgImportOptions {
  /** The width on the board, world units; default from the SVG (or the height's aspect). */
  readonly width?: number;
  /** The height on the board, world units; default from the SVG (or the width's aspect). */
  readonly height?: number;
  /** What `currentColor` is at the root; default black. */
  readonly currentColor?: Rgba;
}

/** What an import made. */
export interface SvgImport {
  /** The objects, bottom first, in the frame of a group whose origin is the viewport's top-left. */
  readonly objects: readonly SvgImportedObject[];
  /** What was drawn differently or left out, in the order first met. */
  readonly issues: readonly SvgImportIssue[];
  /** The viewport's width on the board. */
  readonly width: number;
  /** The viewport's height on the board. */
  readonly height: number;
}

/** An import, or why the markup was refused. */
export type SvgImportResult =
  | {
      /** The markup was read and its objects made. */
      readonly status: 'imported';
      /** What was made, and what was reported. */
      readonly value: SvgImport;
    }
  | {
      /** The markup was refused whole: malformed, not `<svg>`, or over a cap. */
      readonly status: 'refused';
      /** Why, in a sentence. */
      readonly error: string;
    };

/**
 * Every element by its `id`, the first of each id winning.
 *
 * @param root - The root.
 * @returns The map.
 */
function indexIds(root: SvgElement): Map<string, SvgElement> {
  const ids = new Map<string, SvgElement>();
  const pending = [root];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    const id = element.attributes.get('id');
    if (id !== undefined && !ids.has(id)) ids.set(id, element);
    pending.push(...[...element.children].reverse());
  }
  return ids;
}

/**
 * Tells whether a document holds an element anywhere.
 *
 * @param root - The root.
 * @param name - The element's name.
 * @returns True when one is in it.
 */
function contains(root: SvgElement, name: string): boolean {
  return root.name === name || root.children.some((child) => contains(child, name));
}

/**
 * Turns SVG markup into board objects in the frame of a group the caller creates, its origin the
 * viewport's top-left corner, sized as asked. Refuses markup over `SVG_IMPORT_LIMITS`, malformed
 * markup and a root that is not `<svg>`; draws everything else it can, and reports the rest.
 *
 * @param markup - The SVG markup; untrusted, never run; not mutated.
 * @param options - The size on the board and the root's `currentColor`.
 * @returns The objects and issues, or why the markup was refused.
 * @throws {Error} Only for a fault in the import itself; a document over a cap is refused, not
 *   thrown.
 */
export function importSvg(markup: string, options: SvgImportOptions = {}): SvgImportResult {
  if (markup.length > SVG_IMPORT_LIMITS.maxMarkupLength) {
    return {
      status: 'refused',
      error: `the SVG is longer than ${String(SVG_IMPORT_LIMITS.maxMarkupLength)} characters`,
    };
  }
  const xml = readSvgXml(markup);
  if (xml.status === 'refused')
    return { status: 'refused', error: `the SVG is malformed: ${xml.error}` };
  const { root } = xml;
  if (root.name !== 'svg')
    return { status: 'refused', error: `the root element is <${root.name}>, not <svg>` };
  const walk: Walk = {
    ids: indexIds(root),
    objects: [],
    issues: new Map(),
    currentColor: options.currentColor ?? [0, 0, 0, 1],
    visited: 0,
    depth: 0,
    fillRuleBudget: { remaining: SVG_IMPORT_LIMITS.maxFillRuleWork },
    vertices: 0,
    using: [],
  };
  if (contains(root, 'style')) {
    report(walk, {
      feature: 'style',
      detail: '<style> rules are not applied; attributes and style="" are',
    });
  }
  if (contains(root, 'script')) {
    report(walk, { feature: 'script', detail: 'scripts are never run' });
  }
  const viewport = rootViewport(root, options, walk);
  const rootStyle: SvgStyle = { ...INITIAL_STYLE, color: 'currentColor' };
  try {
    const style = computeStyle(root, rootStyle);
    if (style.display !== 'none') {
      for (const child of root.children) visit(child, style, viewport.map, style.opacity, walk);
      reportEffects(style, viewport.map, walk.objects, walk);
      if (style.opacity < 1 && walk.objects.length > 1) {
        report(walk, {
          feature: 'opacity',
          detail: "a group's opacity is applied to each object in it separately",
        });
      }
    }
  } catch (error) {
    if (!(error instanceof ImportRefusal)) throw error;
    return { status: 'refused', error: error.message };
  }
  return {
    status: 'imported',
    value: {
      objects: walk.objects,
      issues: [...walk.issues.values()],
      width: viewport.width,
      height: viewport.height,
    },
  };
}

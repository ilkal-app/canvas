// Helpers for the SVG import's tests: import or refuse, check every object against its
// schema, and pick objects and issues out of an import.
import { pathObjectSchema } from '../../objects/path-object.js';
import { shapeObjectSchema } from '../../objects/shape-object.js';
import {
  importSvg,
  type SvgImport,
  type SvgImportedPath,
  type SvgImportedShape,
  type SvgImportOptions,
} from '../svg-import.js';

/** The stored fields an imported object lacks, so it can be checked as a whole object. */
const STAMPS = {
  id: 'o1',
  parentId: 'g1',
  pageId: null,
  z: 'a0',
  locked: false,
  createdBy: 'agent:test',
  createdAt: 0,
  updatedAt: 0,
};

/**
 * Imports markup, and checks every object it made against its object schema.
 *
 * @param markup - The SVG.
 * @param options - The size and current colour.
 * @returns The import.
 * @throws {Error} When the markup is refused or an object fails its schema.
 */
export function imported(markup: string, options?: SvgImportOptions): SvgImport {
  const result = importSvg(markup, options);
  if (result.status === 'refused') throw new Error(result.error);
  for (const object of result.value.objects) {
    const schema = object.type === 'path' ? pathObjectSchema : shapeObjectSchema;
    const parsed = schema.safeParse({ ...STAMPS, ...object });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  }
  return result.value;
}

/**
 * Imports markup that must be refused.
 *
 * @param markup - The SVG.
 * @returns Why it was refused.
 * @throws {Error} When it was imported.
 */
export function refusal(markup: string): string {
  const result = importSvg(markup);
  if (result.status === 'imported') throw new Error('expected a refusal');
  return result.error;
}

/**
 * Wraps a body in an `<svg>`.
 *
 * @param body - The content.
 * @param attributes - The root's attributes; default a 100-unit square viewBox.
 * @returns The markup.
 */
export function svg(body: string, attributes = 'viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
}

/**
 * The features an import reported, in order.
 *
 * @param value - The import.
 * @returns The features.
 */
export function features(value: SvgImport): string[] {
  return value.issues.map((issue) => issue.feature);
}

/**
 * The one object of an import, which must be a path.
 *
 * @param value - The import.
 * @returns The path.
 * @throws {Error} When there is not exactly one path.
 */
export function onlyPath(value: SvgImport): SvgImportedPath {
  const [object, ...rest] = value.objects;
  if (object?.type !== 'path' || rest.length > 0) {
    throw new Error(`expected one path, got ${JSON.stringify(value.objects.map((o) => o.type))}`);
  }
  return object;
}

/**
 * The one object of an import, which must be a shape.
 *
 * @param value - The import.
 * @returns The shape.
 * @throws {Error} When there is not exactly one shape.
 */
export function onlyShape(value: SvgImport): SvgImportedShape {
  const [object, ...rest] = value.objects;
  if (object?.type !== 'shape' || rest.length > 0) {
    throw new Error(`expected one shape, got ${JSON.stringify(value.objects.map((o) => o.type))}`);
  }
  return object;
}

/**
 * A path's vertices in the group's frame, rounded to six places.
 *
 * @param path - The path.
 * @returns The points.
 */
export function points(path: SvgImportedPath): [number, number][] {
  return path.vertices.map(({ x, y }) => [
    Number((path.x + x).toFixed(6)),
    Number((path.y + y).toFixed(6)),
  ]);
}

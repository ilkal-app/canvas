import { fontName } from './font-names.js';
import { sfntTable } from './sfnt-tables.js';
import type { NamedInstance, VariationAxes, VariationAxis } from './variation-axes.js';

export type { NamedInstance, VariationAxes, VariationAxis } from './variation-axes.js';

/** An fvar axis record's size: tag, three Fixed values, flags and a name id. */
const AXIS_SIZE = 20;
/** The fvar axis flag that asks user interfaces to leave the axis out. */
const HIDDEN_AXIS = 0x1;
/** A name id that names nothing (an instance without a PostScript name). */
const NO_NAME = 0xffff;

/**
 * Reads a variable font's axes and named instances from its `fvar` table, and their names from
 * its `name` table. HarfBuzz applies the coordinates (`avar`, `gvar`, `HVAR`); the
 * bundled HarfBuzz has no named-instance API, so the instances are read here. Every read is
 * bounded by the tables' declared lengths: a damaged font reads as a static one.
 *
 * @param bytes - The font, TrueType or OpenType.
 * @returns Its axes and instances, or undefined for a static font or a damaged `fvar`.
 */
export function readVariationAxes(bytes: Uint8Array): VariationAxes | undefined {
  return readAxes(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/**
 * The reading itself, over the font's bytes.
 *
 * @param view - The font's bytes.
 * @returns Its axes and instances, or undefined.
 */
function readAxes(view: DataView): VariationAxes | undefined {
  const table = sfntTable(view, 'fvar');
  if (table === undefined || table.length < 16) return undefined;
  const { offset, length } = table;
  if (view.getUint16(offset) !== 1 || view.getUint16(offset + 2) !== 0) return undefined;
  const axesOffset = view.getUint16(offset + 4);
  const axisCount = view.getUint16(offset + 8);
  const axisSize = view.getUint16(offset + 10);
  const instanceCount = view.getUint16(offset + 12);
  const instanceSize = view.getUint16(offset + 14);
  const hasPostScript = instanceSize === axisCount * 4 + 6;
  // The axes follow the 16-byte header; an offset into it would read header fields as values.
  if (axesOffset < 16 || axisCount === 0 || axisSize !== AXIS_SIZE) return undefined;
  if (!hasPostScript && instanceSize !== axisCount * 4 + 4) return undefined;
  const instancesOffset = axesOffset + axisCount * AXIS_SIZE;
  if (instancesOffset + instanceCount * instanceSize > length) return undefined;
  const names = sfntTable(view, 'name');
  const axes: VariationAxis[] = [];
  for (let index = 0; index < axisCount; index += 1) {
    const record = offset + axesOffset + index * AXIS_SIZE;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    const [minimum, value, maximum] = [4, 8, 12].map((at) => fixed(view, record + at));
    if (minimum === undefined || value === undefined || maximum === undefined) return undefined;
    if (!(minimum <= value && value <= maximum)) return undefined;
    const flags = view.getUint16(record + 16);
    const name = fontName(view, names, view.getUint16(record + 18)) ?? tag;
    axes.push({
      tag,
      minimum,
      default: value,
      maximum,
      name,
      isHidden: (flags & HIDDEN_AXIS) !== 0,
    });
  }
  const instances: NamedInstance[] = [];
  for (let index = 0; index < instanceCount; index += 1) {
    const record = offset + instancesOffset + index * instanceSize;
    const coordinates: Record<string, number> = {};
    axes.forEach((axis, at) => {
      coordinates[axis.tag] = fixed(view, record + 4 + at * 4) ?? axis.default;
    });
    const name = fontName(view, names, view.getUint16(record)) ?? '';
    const postScriptId = hasPostScript ? view.getUint16(record + 4 + axisCount * 4) : NO_NAME;
    const postScriptName =
      postScriptId === NO_NAME ? undefined : fontName(view, names, postScriptId);
    instances.push(
      postScriptName === undefined ? { name, coordinates } : { name, coordinates, postScriptName },
    );
  }
  return { axes, instances };
}

/**
 * A 16.16 fixed-point number.
 *
 * @param view - The font's bytes.
 * @param at - Its byte offset.
 * @returns Its value.
 */
function fixed(view: DataView, at: number): number | undefined {
  return at + 4 <= view.byteLength ? view.getInt32(at) / 65536 : undefined;
}

import * as decoding from 'lib0/decoding';

import type { ScannedItem } from './update-scan.js';

/**
 * Reads the value a plain map entry holds, as `Y.Map#get` would: the last of its item's values
 * (a map entry written by Yjs holds exactly one).
 *
 * @param update - The update the item was scanned from.
 * @param item - An `any` item, or undefined.
 * @returns The value, or undefined when there is no item or it is not an `any` item.
 * @throws {Error} When the item's values run past the update (lib0's "Unexpected end of array");
 *   the scan that found the item has read past them already, so only a different update can.
 */
export function readScannedValue(update: Uint8Array, item: ScannedItem | undefined): unknown {
  if (item?.content !== 'any') return undefined;
  const decoder = decoding.createDecoder(update);
  decoder.pos = item.detail;
  let value: unknown;
  for (let count = decoding.readVarUint(decoder); count > 0; count -= 1) {
    value = decoding.readAny(decoder);
  }
  return value;
}

/**
 * Reads the value a map entry holds, as `Y.Map#get` would, whatever plain content wrote it: the
 * last of an `any` item's values; the last of a `json` item's, each parsed from its JSON string
 * (`undefined` by name, as Yjs reads them, so `1e999` reads as `Infinity`); an `embed` item's
 * one JSON value. Part 1 fix round 1: the door judges what a reader gets, not only what
 * the codec writes.
 *
 * @param update - The update the item was scanned from.
 * @param item - An `any`, `json` or `embed` item.
 * @returns `{ value }`, or undefined for an item of another content.
 * @throws {SyntaxError} When a JSON string does not parse (Yjs throws on it too).
 * @throws {Error} When the item's content runs past the update, which the scan has ruled out.
 */
export function readScannedPlainValue(
  update: Uint8Array,
  item: ScannedItem,
): { readonly value: unknown } | undefined {
  if (item.content === 'any') return { value: readScannedValue(update, item) };
  if (item.content !== 'json' && item.content !== 'embed') return undefined;
  const decoder = decoding.createDecoder(update);
  decoder.pos = item.detail;
  if (item.content === 'embed') {
    const embed: unknown = JSON.parse(decoding.readVarString(decoder));
    return { value: embed };
  }
  let text = 'undefined';
  for (let count = decoding.readVarUint(decoder); count > 0; count -= 1) {
    text = decoding.readVarString(decoder);
  }
  const value: unknown = text === 'undefined' ? undefined : JSON.parse(text);
  return { value };
}

/**
 * Reads one JSON string as Yjs reads it, from the decoder's position.
 *
 * @param decoder - Positioned at the string.
 * @returns Whether it parses.
 */
function isParsedString(decoder: decoding.Decoder): boolean {
  try {
    JSON.parse(decoding.readVarString(decoder));
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells whether Yjs can decode an item's content. JSON, an embed and a format's value
 * are JSON text, which Yjs parses while it reads an update, before it applies any of it
 * (`readContentJSON`, `readContentEmbed`, `readContentFormat`, yjs 13.6): text no JSON parser
 * takes (a hostile encoder's literal `NaN`, which no Yjs writes) makes `Y.applyUpdate` throw.
 * Every other content decodes, once the scan has read past it. Pure; O(the content's text).
 *
 * @param update - The update the item was scanned from.
 * @param item - A scanned item.
 * @returns `false` when Yjs would throw reading it.
 */
export function isDecodableContent(update: Uint8Array, item: ScannedItem): boolean {
  if (item.content !== 'json' && item.content !== 'embed' && item.content !== 'format') {
    return true;
  }
  const decoder = decoding.createDecoder(update);
  decoder.pos = item.detail;
  if (item.content === 'format') decoding.readVarString(decoder);
  if (item.content !== 'json') return isParsedString(decoder);
  for (let count = decoding.readVarUint(decoder); count > 0; count -= 1) {
    const position = decoder.pos;
    if (decoding.readVarString(decoder) === 'undefined') continue;
    decoder.pos = position;
    if (!isParsedString(decoder)) return false;
  }
  return true;
}

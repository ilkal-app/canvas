/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as text from '@canvas/text';

/** The five CJK families and their source asset folders. */
export const FAMILIES = [
  ['Noto Sans SC', 'notosanssc'],
  ['Noto Sans TC', 'notosanstc'],
  ['Noto Sans HK', 'notosanshk'],
  ['Noto Sans JP', 'notosansjp'],
  ['Noto Sans KR', 'notosanskr'],
] as const;

/** The subset operation the CJK slicing promises. */
export interface Subsetter {
  /** Retain the requested mapped characters. */
  subset(font: Uint8Array, codepoints: Iterable<number>): Uint8Array;
}

interface SliceApi {
  cjkSliceOf(family: string, codepoint: number): string;
  cjkSlices(family: string, codepoints: Iterable<number>): ReadonlyMap<string, readonly number[]>;
  createSubsetter(wasm: ArrayBuffer | ArrayBufferView): Promise<Subsetter>;
  buildCjkSlices(
    subsetter: Subsetter,
    family: string,
    font: Uint8Array,
  ): ReadonlyMap<string, Uint8Array>;
}

// The API is intentionally absent at this base. Cast only the contract so tsc can check the
// acceptance code; Vitest must fail on the missing runtime exports until the slicing lands.
/** The public API under acceptance, cast while its exports are absent. */
export const slices = text as typeof text & SliceApi;

/**
 * Read one committed source face.
 *
 * @param folder - The family asset folder.
 * @param weight - The face weight.
 * @returns The font bytes.
 */
export function faceBytes(folder: string, weight: 400 | 700): Uint8Array {
  return readFileSync(
    new URL(
      `../../../../../packages/app/assets/fonts/script-coverage/${folder}/${String(weight)}.ttf`,
      import.meta.url,
    ),
  );
}

/**
 * Instantiate the production subsetter from harfbuzzjs's WASM.
 *
 * @returns The subsetter.
 */
export async function subsetter(): Promise<Subsetter> {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  return slices.createSubsetter(wasm);
}

/**
 * Return a font's mapped codepoints in ascending order.
 *
 * @param bytes - The font bytes.
 * @returns Its mapped codepoints.
 */
export function cmap(bytes: Uint8Array): number[] {
  return text
    .parseFont(bytes)
    .characterMap()
    .map(([codepoint]) => codepoint);
}

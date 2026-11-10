import { readFileSync } from 'node:fs';

/**
 * `open-packages.json`: the workspace packages that make up the open SDK (the SDK and every
 * workspace package it bundles) and their licence. Kept as JSON so the export tooling reads the
 * same list without importing this package.
 */
interface OpenPackagesFile {
  license: string;
  packages: string[];
  /** The packages of font files the SDK loads, under the fonts' own licence. */
  fonts: { license: string; packages: string[] };
}

const file = JSON.parse(
  readFileSync(new URL('../open-packages.json', import.meta.url), 'utf8'),
) as OpenPackagesFile;

/**
 * The open packages, relative to the repository root. Each carries the Apache-2.0 `LICENSE` and a
 * `license` field, and the public repository's export copies them. The list grows only by a
 * reviewed change, and `licences.test.ts` fails when one of them depends on a workspace package
 * not listed here.
 */
export const OPEN_PACKAGES: readonly string[] = file.packages;

/** The SPDX identifier of the licence every open package carries. */
export const OPEN_LICENSE = file.license;

/**
 * The open packages of font files the SDK loads, relative to the repository root: files
 * under the fonts' own licence, each with its licence text beside it, rather than Apache-2.0
 * code. The export copies them with the open packages.
 */
export const OPEN_FONT_PACKAGES: readonly string[] = file.fonts.packages;

/** The SPDX identifier the font packages declare. */
export const OPEN_FONT_LICENSE = file.fonts.license;

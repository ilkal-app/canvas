import { readFileSync } from 'node:fs';

/**
 * `open-packages.json`: the workspace packages that make up the open SDK (the SDK and every
 * workspace package it bundles) and their licence. Kept as JSON so the export tooling reads the
 * same list without importing this package.
 */
interface OpenPackagesFile {
  license: string;
  packages: string[];
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

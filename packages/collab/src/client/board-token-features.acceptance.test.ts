// Acceptance test: collab preserves signed feature values without using the registry.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeBoardToken } from './board-token.js';

function base64Url(value: unknown): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function unsignedToken(claims: Readonly<Record<string, unknown>>): string {
  return [base64Url({ alg: 'HS256', typ: 'JWT' }), base64Url(claims), 'not-a-signature'].join('.');
}

const EDITOR_CLAIMS = {
  sub: 'user-ada',
  boardId: 'board-1',
  role: 'editor',
  principal: 'user',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe('board token feature claims', () => {
  it('keeps only signed boolean and string entries, including unknown ids', () => {
    const token = unsignedToken({
      ...EDITOR_CLAIMS,
      features: { 'mode.design': true, agents: 'maybe', retired: true, count: 3, nested: {} },
    });
    expect(decodeBoardToken(token).features).toEqual({
      'mode.design': true,
      agents: 'maybe',
      retired: true,
    });
  });

  it('omits features for absent and non-object claims', () => {
    for (const features of ['all', [], null]) {
      expect(decodeBoardToken(unsignedToken({ ...EDITOR_CLAIMS, features }))).not.toHaveProperty(
        'features',
      );
    }
    expect(decodeBoardToken(unsignedToken(EDITOR_CLAIMS))).not.toHaveProperty('features');
  });

  it('has no plans dependency or source import', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = packageJson[field];
      if (typeof dependencies === 'object' && dependencies !== null) {
        expect(dependencies).not.toHaveProperty('@canvas/plans');
      }
    }
    const src = fileURLToPath(new URL('../', import.meta.url));
    for (const path of sourceFiles(src)) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /\b(?:from|import)\s*(?:\(\s*)?['"]@canvas\/plans(?:\/[^'"]*)?['"]/u,
      );
    }
  });
});

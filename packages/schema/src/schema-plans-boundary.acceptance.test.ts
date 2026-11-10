// Acceptance test: schema keeps board modes and templates, without commercial exports.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TEMPLATES, templatesFor, type Template } from './templates/templates.js';

import * as schema from './index.js';

const MOVED_EXPORTS = [
  'PLAN_IDS',
  'PLAN_CATALOGUE',
  'PLAN_CATALOGUE_VERSION',
  'HISTORY_GRACE_DAYS',
  'PRO_OFFER',
  'STRIPE_LOOKUP_KEYS',
  'STORAGE_ADDON_BYTES',
  'withStorageAddons',
  'isPlanId',
  'limitOverridesReason',
  'effectiveLimits',
  'hasRoomUnder',
  'overLimitBoards',
  'mcpCallWeight',
  'usageWindow',
  'FEATURES',
  'FEATURE_IDS',
  'FEATURE_LIFECYCLES',
  'SIGNUP_CHOICES',
  'resolveFeatures',
  'parseFeatureOverrides',
  'readFeatureSet',
  'featureValueReason',
  'isFeatureId',
  'featureOfMode',
  'isModeEnabled',
  'enabledModes',
  'cloudLoggingFormatters',
  'cloudLoggingSeverity',
  'errorReportingFields',
  'CLOUD_LOGGING_SEVERITIES',
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__fixtures__') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe('schema plans boundary', () => {
  it('exports board modes but none of the moved values', () => {
    expect(schema.BOARD_MODES).toEqual([
      'whiteboard',
      'uiux',
      'diagram',
      'illustration',
      'motion',
      'slides',
    ]);
    for (const name of MOVED_EXPORTS) expect(schema).not.toHaveProperty(name);
  });

  it('keeps commercial vocabulary out of schema source and dependencies', () => {
    const src = fileURLToPath(new URL('.', import.meta.url));
    for (const path of sourceFiles(src)) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/stripe|workos|signup|reports\//iu);
    }
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
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
  });

  it('filters templates using exactly true in a plain feature record', () => {
    const enabled: Readonly<Record<string, boolean | string>> = {
      templates: true,
      'mode.design': true,
    };
    expect(templatesFor(enabled)).toEqual(
      TEMPLATES.filter((template) => template.requires.every((id) => enabled[id] === true)),
    );
    expect(templatesFor({ templates: false })).toEqual([]);

    const list: readonly Template[] = [
      { id: 'on', name: 'On', category: 'planning', mode: 'whiteboard', requires: ['templates'] },
      {
        id: 'missing',
        name: 'Missing',
        category: 'planning',
        mode: 'whiteboard',
        requires: ['future.flag'],
      },
      {
        id: 'string',
        name: 'String',
        category: 'planning',
        mode: 'whiteboard',
        requires: ['choice.flag'],
      },
    ];
    expect(templatesFor({ ...enabled, 'choice.flag': 'yes' }, list)).toEqual([list[0]]);
  });
});

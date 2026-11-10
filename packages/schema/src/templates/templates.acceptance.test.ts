import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  portableBoardSchema,
  searchTemplates,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  templateById,
  templatesFor,
  templatesIn,
} from '../index.js';

import { FIXTURE_TEMPLATES } from './__fixtures__/template-registry.js';
import { templateDocument } from './documents/index.js';

describe('template registry', () => {
  it('has stable, unique kebab-case ids and complete metadata', () => {
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(TEMPLATES.length);
    const categories = new Map(TEMPLATE_CATEGORIES.map((category) => [category.id, category.name]));
    expect([...categories]).toEqual([
      ['meetings-retros', 'Meetings & retros'],
      ['brainstorming', 'Brainstorming'],
      ['planning', 'Planning'],
      ['diagrams-flows', 'Diagrams & flows'],
      ['research-mapping', 'Research & mapping'],
    ]);
    for (const template of TEMPLATES) {
      expect(template.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(template.name.trim()).not.toBe('');
      expect(categories.has(template.category)).toBe(true);
      expect(template.requires).toContain('templates');
      expect(templateById(template.id)).toEqual(template);
    }
    expect(templateById('missing-template')).toBeUndefined();
  });

  it('filters each required switch and returns none when templates is off', () => {
    const on = { templates: true, 'mode.design': true };
    expect(templatesFor(on, FIXTURE_TEMPLATES).map((template) => template.id)).toEqual([
      'test-retrospective',
      'test-design-map',
    ]);
    expect(
      templatesFor({ templates: true, 'mode.design': false }, FIXTURE_TEMPLATES).map(
        (template) => template.id,
      ),
    ).toEqual(['test-retrospective']);
    expect(templatesFor({ templates: false }, FIXTURE_TEMPLATES)).toEqual([]);
  });

  it('searches names and category display names without case or accents', () => {
    expect(searchTemplates(FIXTURE_TEMPLATES, '')).toEqual(FIXTURE_TEMPLATES);
    expect(searchTemplates(FIXTURE_TEMPLATES, 'RETROSPECTIVE')).toEqual([FIXTURE_TEMPLATES[0]]);
    expect(searchTemplates(FIXTURE_TEMPLATES, 'RESEARCH')).toEqual([FIXTURE_TEMPLATES[1]]);
    expect(searchTemplates(FIXTURE_TEMPLATES, 'absent')).toEqual([]);
  });

  it('filters categories, with all preserving the input list', () => {
    expect(templatesIn(FIXTURE_TEMPLATES, 'all')).toEqual(FIXTURE_TEMPLATES);
    expect(templatesIn(FIXTURE_TEMPLATES, 'meetings-retros')).toEqual([FIXTURE_TEMPLATES[0]]);
  });

  it('validates every registry document through the document accessor', () => {
    for (const template of TEMPLATES) {
      const document = templateDocument(template.id);
      expect(portableBoardSchema.safeParse(document).success, template.id).toBe(true);
    }
  });

  it('keeps the metadata module free of document imports', async () => {
    const source = await readFile(new URL('./templates.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(?:from\s*['"][^'"]*documents|import\s*\([^)]*documents)/);
  });
});

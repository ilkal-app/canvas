// The template helpers' finer rules: word-by-word search, blank queries, the default
// lists and inputs left as they were.
import { describe, expect, it } from 'vitest';

import { FIXTURE_TEMPLATES } from './__fixtures__/template-registry.js';
import { templateDocument } from './documents/index.js';
import {
  searchTemplates,
  TEMPLATES,
  templateById,
  templatesFor,
  templatesIn,
} from './templates.js';

describe('template helpers', () => {
  it('finds a template only when every word of the query matches its name or category', () => {
    expect(searchTemplates(FIXTURE_TEMPLATES, '  retro   meetings ')).toEqual([
      FIXTURE_TEMPLATES[0],
    ]);
    expect(searchTemplates(FIXTURE_TEMPLATES, 'retro research')).toEqual([]);
    expect(searchTemplates(FIXTURE_TEMPLATES, '   ')).toEqual(FIXTURE_TEMPLATES);
  });

  it('reads the registry by default and leaves its inputs alone', () => {
    const list = [...FIXTURE_TEMPLATES];
    expect(templatesIn(list, 'planning')).toEqual([]);
    expect(templateById('test-design-map', list)).toBe(FIXTURE_TEMPLATES[1]);
    expect(list).toEqual(FIXTURE_TEMPLATES);
    expect(templatesFor({ templates: true })).toEqual(TEMPLATES);
    expect(templateById('test-design-map')).toBeUndefined();
  });

  it('has no document for an id outside the registry', () => {
    expect(templateDocument('test-retrospective')).toBeUndefined();
  });
});

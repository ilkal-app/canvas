import { describe, expect, it } from 'vitest';

import { boardOf, component, id, instance, text } from './__fixtures__/component-board.js';
import { editableOverrideFields } from './override-content.js';
import { resolveInstance } from './resolve-instance.js';

describe('variant edges', () => {
  it('offers neither a nested selection nor a measured size as override rows', () => {
    const nested = instance('nested', 'other');
    expect(editableOverrideFields(nested)).toEqual(['isHidden', 'opacity']);
    expect(editableOverrideFields(text('label', 'main'))).not.toContain('measuredSize');
  });

  it('reports a nested instance whose main is missing, composing no presets for it', () => {
    const outer = component('outer');
    const nested = instance('nested', 'gone', { parentId: 'outer' });
    const root = instance('root', 'outer', { overrides: { nested: { variant: { state: 'on' } } } });
    const resolved = resolveInstance(boardOf([outer, nested, root]), root);
    expect(resolved.issue).toBe('missing-main');
    const virtual = resolved.objects.find((object) => object.id.endsWith('/nested'));
    expect(virtual?.type === 'instance' && virtual.mainId).toBe(id('gone'));
  });
});

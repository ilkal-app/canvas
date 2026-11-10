import { describe, expect, it } from 'vitest';

import { boardOf, component, instance, text } from './__fixtures__/component-board.js';
import { mergeOverrideRecords } from './override-merge.js';
import { resolveInstance } from './resolve-instance.js';

const SIZE = { width: 40, height: 16, fonts: 'abc' };

describe('mergeOverrideRecords and measured sizes', () => {
  it('drops the inner size when the outer record changes the text it measured', () => {
    const inner = { text: 'One', measuredSize: SIZE };
    expect(mergeOverrideRecords(inner, { text: 'Two' })).toEqual({ text: 'Two' });
    expect(mergeOverrideRecords(inner, { runs: [] })).not.toHaveProperty('measuredSize');
    expect(mergeOverrideRecords(inner, { textStyle: { weight: 700 } })).toEqual({
      text: 'One',
      textStyle: { weight: 700 },
    });
  });

  it('keeps it when the outer record leaves the text alone or brings its own size', () => {
    const inner = { text: 'One', measuredSize: SIZE };
    expect(mergeOverrideRecords(inner, { isHidden: false })).toEqual({ ...inner, isHidden: false });
    const own = { width: 50, height: 16, fonts: 'abc' };
    expect(mergeOverrideRecords(inner, { text: 'Two', measuredSize: own })).toEqual({
      text: 'Two',
      measuredSize: own,
    });
    // A measure-only outer record measures the inner text ('s follower writes these).
    expect(mergeOverrideRecords(inner, { measuredSize: own })).toEqual({
      text: 'One',
      measuredSize: own,
    });
  });

  it('changes neither record', () => {
    const inner = Object.freeze({ text: 'One', measuredSize: Object.freeze({ ...SIZE }) });
    const outer = Object.freeze({ text: 'Two' });
    mergeOverrideRecords(inner, outer);
    expect(inner).toEqual({ text: 'One', measuredSize: SIZE });
    expect(outer).toEqual({ text: 'Two' });
  });
});

describe('a nested instance under an outer text override', () => {
  it('passes the nested instance no size measured for text the outer record replaced', () => {
    const inner = component('inner');
    const nested = instance('nested', 'inner', {
      parentId: 'outer',
      overrides: { leaf: { text: 'One', measuredSize: SIZE } },
    });
    const outer = component('outer');
    const root = instance('root', 'outer', { overrides: { 'nested/leaf': { text: 'Two' } } });
    const board = boardOf([inner, text('leaf', 'inner'), outer, nested, root]);
    const virtual = resolveInstance(board, root).objects.find(({ id }) => id.endsWith('/nested'));
    expect(virtual?.type === 'instance' && virtual.overrides.leaf).toEqual({ text: 'Two' });
  });
});

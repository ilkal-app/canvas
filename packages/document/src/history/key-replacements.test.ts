import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { CausalPastRecorder } from './causal-past.js';
import { isGuardedFieldValue, isInsideKeptValue } from './field-guard.js';
import { KeyReplacements } from './key-replacements.js';

it('keeps direct guard reads uncached and current-value checks live', () => {
  const doc = new Y.Doc();
  const objects = doc.getMap('objects');
  const object = new Y.Map();
  objects.set('object', object);
  object.set('label', null);
  const pasts = new CausalPastRecorder();
  const manager = new Y.UndoManager(object, {
    captureTransaction: (transaction) => {
      pasts.noteCaptured(transaction);
      return true;
    },
  });
  manager.on('stack-item-added', pasts.onStepAdded);
  const label = new Y.Map();
  label.set('text', new Y.Text('label'));
  object.set('label', label);
  const step = manager.undoStack.at(-1);
  const owner = label._item;
  const child = label._map.get('text');
  if (step === undefined || owner === null || child === undefined) throw new Error('No label');
  try {
    expect(isGuardedFieldValue(owner, objects, step)).toBe(true);
    expect(isInsideKeptValue(child, objects, step)).toBe(true);
    const deletions = step.deletions;
    step.deletions = Y.createDeleteSet();
    expect(isGuardedFieldValue(owner, objects, step)).toBe(false);
    expect(isInsideKeptValue(child, objects, step)).toBe(false);
    step.deletions = deletions;
    const memo = new KeyReplacements(step);
    expect(isGuardedFieldValue(owner, objects, step, memo)).toBe(true);
    object.set('label', null);
    expect(isGuardedFieldValue(owner, objects, step, memo)).toBe(false);
    expect(isInsideKeptValue(child, objects, step, memo)).toBe(false);
    manager.clear();
    doc.transact(() => object.set('other', 1));
    expect(isGuardedFieldValue(owner, objects, step)).toBe(false);
  } finally {
    manager.destroy();
    doc.destroy();
  }
});

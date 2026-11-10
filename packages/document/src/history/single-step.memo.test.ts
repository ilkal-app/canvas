import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { isKeyReplacedBy, type KeyReplacements } from './key-replacements.js';
import { SingleStep } from './single-step.js';

function fixture() {
  const doc = new Y.Doc();
  const values = doc.getMap('values');
  values.set('key', 0);
  const single = new SingleStep();
  const seen: KeyReplacements[] = [];
  const manager = new Y.UndoManager(values, {
    captureTimeout: 0,
    deleteFilter: (item) => {
      const step = single.current();
      const memo = single.replacements();
      if (step === undefined || memo === undefined) throw new Error('No active apply');
      seen.push(memo);
      expect(memo.has(item, step)).toBe(isKeyReplacedBy(item, step));
      return true;
    },
  });
  values.set('key', 1);
  return { doc, values, single, seen, manager };
}

describe('history-walk memo lifetime', () => {
  it('uses a fresh memo for redo and after a remote write changes the key chain', () => {
    const { doc, values, single, seen, manager } = fixture();
    const peer = new Y.Doc();
    try {
      single.apply(manager, 'undo');
      const undoMemo = seen.at(-1);
      expect(undoMemo).toBeDefined();
      expect(single.replacements()).toBeUndefined();
      single.apply(manager, 'redo');
      const redoMemo = seen.at(-1);
      expect(redoMemo).toBeDefined();
      expect(redoMemo).not.toBe(undoMemo);
      expect(single.replacements()).toBeUndefined();
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
      peer.getMap('values').set('key', 2);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), 'remote');
      values.set('key', 3);
      single.apply(manager, 'undo');
      expect(values.get('key')).toBe(2);
      expect(seen.at(-1)).not.toBe(redoMemo);
      expect(single.current()).toBeUndefined();
      expect(single.replacements()).toBeUndefined();
    } finally {
      manager.destroy();
      doc.destroy();
      peer.destroy();
    }
  });

  it('drops the populated memo when the delete filter throws, then starts redo fresh', () => {
    const { doc, values, single, seen, manager } = fixture();
    const filter = manager.deleteFilter;
    manager.deleteFilter = (item) => {
      filter(item);
      throw new Error('filter failed');
    };
    try {
      expect(() => single.apply(manager, 'undo')).toThrow('filter failed');
      const failedMemo = seen.at(-1);
      expect(failedMemo).toBeDefined();
      expect(single.current()).toBeUndefined();
      expect(single.replacements()).toBeUndefined();
      manager.deleteFilter = filter;
      single.apply(manager, 'redo');
      expect(values.get('key')).toBe(1);
      expect(seen.at(-1)).not.toBe(failedMemo);
      expect(single.replacements()).toBeUndefined();
    } finally {
      manager.destroy();
      doc.destroy();
    }
  });

  it('does not reuse a result when the same step is applied again with changed deletions', () => {
    const { doc, single, manager } = fixture();
    const step = manager.undoStack.at(-1);
    if (step === undefined) throw new Error('Missing step');
    const deletions = step.deletions;
    const decisions: boolean[] = [];
    manager.deleteFilter = (entry) => {
      const memo = single.replacements();
      if (memo === undefined) throw new Error('No active apply');
      decisions.push(memo.has(entry, step));
      return false;
    };
    try {
      step.deletions = Y.createDeleteSet();
      single.apply(manager, 'undo');
      expect(single.replacements()).toBeUndefined();
      step.deletions = deletions;
      manager.undoStack.push(step);
      single.apply(manager, 'undo');
      expect(decisions).toEqual([false, true]);
      expect(single.replacements()).toBeUndefined();
    } finally {
      manager.destroy();
      doc.destroy();
    }
  });

  it('uses the exact substituted deletion set and leaves other-step reads uncached', () => {
    const { doc, single, manager } = fixture();
    const original = manager.undoStack.at(-1);
    if (original === undefined) throw new Error('Missing step');
    const substitute = {
      insertions: original.insertions,
      deletions: Y.createDeleteSet(),
      meta: original.meta,
    };
    let calls = 0;
    manager.deleteFilter = (entry) => {
      const memo = single.replacements();
      if (memo === undefined) throw new Error('Missing memo');
      calls += 1;
      expect(single.current()).toBe(substitute);
      expect(memo.has(entry, substitute)).toBe(false);
      expect(memo.has(entry, substitute)).toBe(false);
      expect(memo.has(entry, original)).toBe(true);
      original.deletions = Y.createDeleteSet();
      expect(memo.has(entry, original)).toBe(false);
      return true;
    };
    try {
      single.apply(manager, 'undo', null, substitute);
      expect(calls).toBe(1);
      expect(single.replacements()).toBeUndefined();
    } finally {
      manager.destroy();
      doc.destroy();
    }
  });
});

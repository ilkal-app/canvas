import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore, type ChangeSet } from '@canvas/document';
import type { ObjectId, TextObject } from '@canvas/schema';

import { MIXED } from '../panels/controls/mixed-value.js';

import { setUpTextDocument } from './__fixtures__/text-document.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';

function selectedText() {
  const setup = setUpTextDocument();
  const { document, press, store, text } = setup;
  document.setActiveTool('text');
  press('pointerDown', 20, 20);
  press('pointerUp', 20, 20);
  document.tools.text.session()?.type('Variable');
  document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
  const changes: ChangeSet[] = [];
  store.subscribe((change) => changes.push(change));
  const shown = () =>
    document.tools
      .sourceOver({ get: (id: ObjectId) => store.get(id) })
      .get('text-1' as ObjectId) as TextObject;
  return { ...setup, text, changes, shown };
}

describe('text axis drag preview', () => {
  it('replaces the measured preview without writing, then clears it on release', () => {
    const { document, text, shown, changes } = selectedText();
    const original = text('text-1');
    expect(
      document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 500 } } }),
    ).toBe(true);
    expect(shown().runs[0]?.style.fontVariations).toEqual({ wght: 500 });
    expect(shown().width).toBeGreaterThan(0);
    expect(
      document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } }),
    ).toBe(true);
    expect(shown().runs[0]?.style.fontVariations).toEqual({ wght: 650 });
    expect(text('text-1')).toEqual(original);
    expect(changes).toHaveLength(0);
    document.tools.text.apply({ kind: 'endPreview' });
    expect(shown()).toEqual(original);
    expect(changes).toHaveLength(0);
  });

  it('commits once after previews and clears the preview', () => {
    const { document, text, shown, changes, history } = selectedText();
    const original = text('text-1');
    document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 500 } } });
    document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } });
    expect(changes).toHaveLength(0);
    document.tools.text.apply({ kind: 'style', patch: { fontVariationsAxes: { wght: 650 } } });
    expect(changes).toHaveLength(1);
    expect(text('text-1').runs[0]?.style.fontVariations).toEqual({ wght: 650 });
    expect(shown()).toEqual(text('text-1'));
    expect(history.undo()).toBe(true);
    expect(text('text-1')).toEqual(original);
  });

  it('does not preview while editing', () => {
    const { document, press, store } = setUpTextDocument();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Draft');
    const before = store.encodeState();
    document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } });
    expect(store.encodeState()).toEqual(before);
    // No coordinates read as none ({}, the panel's spelling): the preview set none.
    expect(document.tools.text.session()?.currentStyle().fontVariations ?? {}).toEqual({});
  });

  it.each(['local', 'remote', 'undo'] as const)(
    'clears every axis preview after a %s document change',
    (kind) => {
      const { document, store, history, shown, text } = selectedText();
      const textId = 'text-1' as ObjectId;
      if (kind === 'undo') {
        store.transact(LOCAL_USER_ORIGIN, (transaction) => {
          transaction.formatText(textId, 0, 8, { italic: true });
        });
        history.stopCapturing();
      }
      document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } });
      expect(shown()).not.toEqual(text('text-1'));
      if (kind === 'local') {
        store.transact(LOCAL_USER_ORIGIN, (transaction) => {
          transaction.formatText(textId, 0, 8, { italic: true });
        });
      } else if (kind === 'remote') {
        const peer = new YjsDocumentStore();
        peer.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
        peer.transact(SYSTEM_ORIGIN, (transaction) => {
          transaction.formatText(textId, 0, 8, { italic: true });
        });
        store.applyUpdate(peer.encodeState(store.encodeStateVector()), SYSTEM_ORIGIN);
        peer.destroy();
      } else {
        expect(history.undo()).toBe(true);
      }
      expect(shown()).toEqual(store.get(textId));
    },
  );

  it('clears the old selection’s preview when selection changes', () => {
    const { document, shown, store } = selectedText();
    document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } });
    expect(shown()).not.toEqual(store.get('text-1' as ObjectId));
    document.selectTool.select([]);
    expect(shown()).toEqual(store.get('text-1' as ObjectId));
  });

  it('clears previews for all selected texts after a document write', () => {
    const { document, press, store } = setUpTextDocument();
    for (const y of [20, 300]) {
      document.setActiveTool('text');
      press('pointerDown', 20, y);
      press('pointerUp', 20, y);
      document.tools.text.session()?.type('ab');
      document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    }
    const selected = ['text-1', 'text-2'] as ObjectId[];
    document.selectTool.select(selected);
    const shown = (id: ObjectId) =>
      document.tools.sourceOver({ get: (key: ObjectId) => store.get(key) }).get(id);
    document.tools.text.apply({ kind: 'preview', patch: { fontVariationsAxes: { wght: 650 } } });
    for (const id of selected) expect(shown(id)).not.toEqual(store.get(id));
    const [first] = selected;
    if (first === undefined) throw new Error('Expected a selected text');
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.formatText(first, 0, 2, { italic: true });
    });
    for (const id of selected) expect(shown(id)).toEqual(store.get(id));
  });

  it('reports common values per axis across two selected text objects', () => {
    const { document, press, store } = setUpTextDocument();
    for (const [y, value] of [
      [20, 'ab'],
      [300, 'cd'],
    ] as const) {
      document.setActiveTool('text');
      press('pointerDown', 20, y);
      press('pointerUp', 20, y);
      document.tools.text.session()?.type(value);
      document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    }
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.formatText('text-1' as ObjectId, 0, 2, {
        fontVariations: { opsz: 18, wght: 650 },
      });
      transaction.formatText('text-2' as ObjectId, 0, 2, {
        fontVariations: { opsz: 24, wght: 650 },
      });
    });
    document.selectTool.select(['text-1', 'text-2'] as ObjectId[]);
    expect(document.tools.text.styleContext()).toMatchObject({
      axisValues: { opsz: MIXED, wght: 650 },
    });
  });

  it('counts an unset tag as mixed and uses weight where wght is unset', () => {
    const { document, press, store } = setUpTextDocument();
    for (const y of [20, 300]) {
      document.setActiveTool('text');
      press('pointerDown', 20, y);
      press('pointerUp', 20, y);
      document.tools.text.session()?.type('ab');
      document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    }
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.formatText('text-1' as ObjectId, 0, 2, {
        weight: 600,
        fontVariations: { opsz: 18, wght: 600 },
      });
      transaction.formatText('text-2' as ObjectId, 0, 2, { weight: 600 });
    });
    document.selectTool.select(['text-1', 'text-2'] as ObjectId[]);
    expect(document.tools.text.styleContext()).toMatchObject({
      axisValues: { opsz: MIXED, wght: 600 },
    });
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.formatText('text-1' as ObjectId, 0, 2, { fontVariations: { wght: 600 } });
    });
    expect(document.tools.text.styleContext()).toHaveProperty('axisValues', { wght: 600 });
  });
});

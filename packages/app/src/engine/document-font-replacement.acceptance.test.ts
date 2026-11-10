// Acceptance (Claude), the document side over a stubbed page-font status: a collaborator
// without a text's font can still move it and restyle it with no question asked; opening its
// words (Enter on the selection, the text tool) asks for an available family instead; cancelling changes
// nothing; the replacement sets the whole text's runs to the chosen family, keeps every word and
// every other style field, and is one undo step; a replacement is refused when the text was
// locked meanwhile or the person can no longer edit; the owner, whose font is installed, edits
// as before.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId, StyleRun, TextObject, TextStyle } from '@canvas/schema';
import type { TextLayoutInput } from '@canvas/tools';

import { LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import { readFontReplacement, setFontReplacement } from '../text-input/font-replacement.js';
import { PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

import { setUpTextDocument, TEXT_CAMERA } from './__fixtures__/text-document.js';

/** What this page can draw: a family's status, `ready` unless set otherwise. */
const status = vi.hoisted(() => new Map<string, 'ready' | 'missing' | 'failed'>());

vi.mock('../text-input/page-fonts.js', async () => {
  const { layoutText } = await import('@canvas/engine');
  const monoLayout = {
    layout: (input: TextLayoutInput) =>
      layoutText(
        input.text,
        input.runs,
        input.wrapWidth,
        {
          faceIdOf: () => 'test',
          advance: () => 0.6,
          kerning: () => 0,
          lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
        },
        input.align,
      ),
  };
  return {
    // Page override sizes measure unshaped here: no page shaper in tests.
    PAGE_OVERRIDE_SHAPING: {},
    PAGE_TEXT_LAYOUT: monoLayout,
    pageFontRevision: () => 0,
    subscribePageFonts: () => () => undefined,
    ensurePageFont: (family: string) =>
      Promise.resolve((status.get(family) ?? 'ready') === 'ready'),
    pageFontStatus: (family: string) => status.get(family) ?? 'ready',
  };
});

afterEach(() => {
  setFontReplacement(undefined);
  status.clear();
});

const STYLE: Pick<TextStyle, 'fontSize' | 'color' | 'italic'> = {
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  italic: false,
};

/** Two runs: a bold private family, then a regular library family. */
const RUNS: StyleRun[] = [
  { length: 6, style: { ...STYLE, fontFamily: 'Private Mono', weight: 700 } },
  { length: 5, style: { ...STYLE, fontFamily: 'Liberation Sans', weight: 400 } },
];

/** A text object at the origin, before the demo board's first section, in those runs. */
const SHARED_TEXT: TextObject = {
  id: 'shared' as ObjectId,
  type: 'text',
  parentId: null,
  x: 0,
  y: 0,
  width: 80,
  height: 20,
  rotation: 0,
  z: 'Zz',
  locked: false,
  createdBy: 'user:owner' as TextObject['createdBy'],
  createdAt: 1,
  updatedAt: 1,
  text: 'Owner words',
  runs: RUNS,
  autoWidth: true,
  align: 'left',
  verticalAlign: 'top',
};

/**
 * The document side with the shared text written by another person, the private family missing.
 *
 * @returns The fixture plus a double click at a point.
 */
function setUpCollaborator() {
  status.set('Private Mono', 'missing');
  const fixture = setUpTextDocument(PAGE_TEXT_LAYOUT);
  fixture.store.transact(
    { kind: 'user', principalId: 'user:owner' as TextObject['createdBy'] },
    (tx) => {
      tx.setObject(SHARED_TEXT);
    },
  );
  // Select with a click, then open the words with Enter (the `activate` selection command, the
  // same activation a double click resolves to).
  const openWords = (x: number, y: number) => {
    fixture.press('pointerDown', x, y, 1_000);
    fixture.press('pointerUp', x, y, 1_050);
    fixture.document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
  };
  return { ...fixture, openWords };
}

describe('a collaborator without the font', () => {
  it('moves and restyles the text with no question asked, its family and words untouched', () => {
    const { document, press, text, store, history } = setUpCollaborator();
    const before = text('shared');
    // Select it and drag it 40 px right with the select tool.
    press('pointerDown', 5, 5, 0);
    document.handlePointer(
      {
        kind: 'pointerMove',
        screen: { x: 25, y: 5 },
        isShiftPressed: false,
        isModPressed: false,
        timeStamp: 20,
      },
      TEXT_CAMERA,
    );
    document.handlePointer(
      {
        kind: 'pointerMove',
        screen: { x: 45, y: 5 },
        isShiftPressed: false,
        isModPressed: false,
        timeStamp: 40,
      },
      TEXT_CAMERA,
    );
    press('pointerUp', 45, 5, 60);
    expect(text('shared').x).toBe(before.x + 40);
    expect(readFontReplacement()).toBeUndefined();
    expect(document.tools.text.session()).toBeUndefined();

    // Restyle the selection from the panel: size and colour change, families and words stay.
    expect(document.tools.text.apply({ kind: 'style', patch: { fontSize: 32 } })).toBe(true);
    expect(document.tools.text.apply({ kind: 'toggleItalic' })).toBe(true);
    const restyled = text('shared');
    expect(restyled.text).toBe(before.text);
    expect(restyled.runs.map(({ style }) => style.fontFamily)).toEqual([
      'Private Mono',
      'Liberation Sans',
    ]);
    expect(restyled.runs.every(({ style }) => style.fontSize === 32 && style.italic)).toBe(true);
    expect(readFontReplacement()).toBeUndefined();
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('is asked for an available family when opening the words, and cancelling leaves the text as it was', () => {
    const { document, openWords, text, store, history } = setUpCollaborator();
    const before = text('shared');
    openWords(5, 5);
    expect(document.tools.text.session()).toBeUndefined();
    expect(readFontReplacement()?.families).toEqual(['Private Mono']);
    setFontReplacement(undefined);
    expect(text('shared')).toEqual(before);
    expect(history.canUndo()).toBe(false);
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('replaces the whole text’s family in one undoable step, keeping words, weights and the other run’s fields', async () => {
    const { document, openWords, text, store, history } = setUpCollaborator();
    const before = text('shared');
    openWords(5, 5);
    const request = readFontReplacement();
    expect(request?.families).toEqual(['Private Mono']);
    expect(await request?.replace('Lora')).toBe(true);

    const after = text('shared');
    expect(after.text).toBe('Owner words');
    expect(after.runs.map(({ length, style }) => [length, style.fontFamily, style.weight])).toEqual(
      [
        [6, 'Lora', 700],
        [5, 'Lora', 400],
      ],
    );
    expect(after.runs.map(({ style }) => [style.fontSize, style.italic, style.color])).toEqual(
      before.runs.map(({ style }) => [style.fontSize, style.italic, style.color]),
    );
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(text('shared').runs).toEqual(before.runs);
    expect(text('shared').text).toBe(before.text);
    expect(history.canUndo()).toBe(false);
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('refuses a family this page cannot load, so the words stay closed until an available choice', async () => {
    const { document, openWords, text, store, history } = setUpCollaborator();
    status.set('Private Serif', 'missing');
    const before = text('shared');
    openWords(5, 5);
    expect(await readFontReplacement()?.replace('Private Serif')).toBe(false);
    expect(text('shared')).toEqual(before);
    expect(readFontReplacement()).toBeDefined();
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('refuses the replacement once the text was locked or the person lost edit rights meanwhile', async () => {
    const { document, openWords, text, store, history } = setUpCollaborator();
    const before = text('shared');
    openWords(5, 5);
    const locking = readFontReplacement();
    store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.patchObject('shared' as ObjectId, { locked: true });
    });
    expect(await locking?.replace('Lora')).toBe(false);
    expect(text('shared').runs).toEqual(before.runs);
    store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.patchObject('shared' as ObjectId, { locked: false });
    });

    setFontReplacement(undefined);
    openWords(5, 5);
    const readOnly = readFontReplacement();
    expect(readOnly).toBeDefined();
    document.setEditable(false);
    expect(await readOnly?.replace('Lora')).toBe(false);
    expect(text('shared').runs).toEqual(before.runs);
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('closes its pending question when the document side goes away', () => {
    const { document, openWords, store, history } = setUpCollaborator();
    openWords(5, 5);
    expect(readFontReplacement()).toBeDefined();
    document.destroy();
    expect(readFontReplacement()).toBeUndefined();
    history.destroy();
    store.destroy();
  });
});

describe('the owner, whose font is installed', () => {
  it('opens and edits the words as before, the private family kept', () => {
    const fixture = setUpTextDocument(PAGE_TEXT_LAYOUT);
    fixture.store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.setObject(SHARED_TEXT);
    });
    fixture.press('pointerDown', 5, 5, 1_000);
    fixture.press('pointerUp', 5, 5, 1_050);
    fixture.document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    const session = fixture.document.tools.text.session();
    expect(session).toBeDefined();
    expect(readFontReplacement()).toBeUndefined();
    session?.move({ unit: 'textEdge', direction: 1, isExtending: false });
    session?.type('!');
    const edited = fixture.text('shared');
    expect(edited.text).toBe('Owner words!');
    expect(edited.runs[0]?.style.fontFamily).toBe('Private Mono');
    fixture.document.destroy();
    fixture.history.destroy();
    fixture.store.destroy();
  });
});

describe('the board-wide replacement of a missing font', () => {
  it('replaces the family on every text naming it in one undo step, the others kept', async () => {
    const { document, text, store, history } = setUpCollaborator();
    store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.setObject({ ...SHARED_TEXT, id: 'second' as ObjectId, x: 200, z: 'Zzz' });
    });
    const before = text('shared');
    document.runCanvasAction({ type: 'replaceMissingFont', family: 'Private Mono' }, 1);
    const request = readFontReplacement();
    expect(request?.scope).toBe('board');
    expect(request?.families).toEqual(['Private Mono']);
    expect(await request?.replace('Lora')).toBe(true);
    for (const id of ['shared', 'second']) {
      expect(text(id).runs.map(({ style }) => style.fontFamily)).toEqual([
        'Lora',
        'Liberation Sans',
      ]);
    }
    expect(history.undo()).toBe(true);
    expect(text('shared').runs).toEqual(before.runs);
    expect(text('second').runs).toEqual(before.runs);
    document.destroy();
    history.destroy();
    store.destroy();
  });

  it('opens nothing for a viewer, and refuses once edit rights were lost meanwhile', async () => {
    const { document, text, store, history } = setUpCollaborator();
    const before = text('shared');
    document.setEditable(false);
    document.runCanvasAction({ type: 'replaceMissingFont', family: 'Private Mono' }, 1);
    expect(readFontReplacement()).toBeUndefined();
    document.setEditable(true);
    document.runCanvasAction({ type: 'replaceMissingFont', family: 'Private Mono' }, 2);
    const request = readFontReplacement();
    document.setEditable(false);
    expect(await request?.replace('Lora')).toBe(false);
    expect(text('shared').runs).toEqual(before.runs);
    document.destroy();
    history.destroy();
    store.destroy();
  });
});

import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { ADA } from '../select/__fixtures__/select-store.js';

import {
  AUTOMATIC,
  drag,
  ID,
  input,
  setUp,
  STUB_FROM,
  STUB_TO,
} from './__fixtures__/route-handles.js';
import { ELBOW_HANDLE_LENGTH_PX } from './connector-route-overlay.js';

describe('ConnectorRouteHandles: an elbow’s middle piece', () => {
  it('puts a bar on the middle piece of a lone selected, unlocked elbow', () => {
    const { editor, store, select } = setUp();
    expect(editor.handleAt(AUTOMATIC, 1)).toBe('elbow');
    expect(editor.handleAt({ x: 180, y: 60 }, 1)).toBeUndefined();
    expect(editor.press(input('pointerDown', { x: 180, y: 60 }), 1)).toBe(false);
    const rects = editor.overlay()?.toolRects ?? [];
    expect(rects).toHaveLength(2);
    expect(rects[0]?.box.height).toBe(ELBOW_HANDLE_LENGTH_PX);
    select([ID, 'a' as ObjectId]);
    expect(editor.overlay()).toBeUndefined();
    select(['a' as ObjectId]);
    expect(editor.handleAt(AUTOMATIC, 1)).toBeUndefined();
    select([ID]);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(ID, { locked: true });
    });
    expect(editor.handleAt(AUTOMATIC, 1)).toBeUndefined();
  });

  it('shows no handle on a straight route, nor on an elbow that runs straight', () => {
    expect(setUp({ route: 'straight' }).editor.overlay()).toBeUndefined();
    const level = setUp({
      from: { kind: 'point', x: 0, y: 400 },
      to: { kind: 'point', x: 300, y: 400 },
    });
    expect(level.editor.overlay()).toBeUndefined();
  });

  it('moves an L’s arm into the end, from its corner, and snaps it back there (staging)', () => {
    // From a's right side (stub to x 84) to b's top (330, 200; stub to y 176): one bend at
    // (330, 30); the upright arm down to b's stub is the bar, at (330, 103).
    const corner = setUp({
      to: { kind: 'object', objectId: 'b' as ObjectId, anchor: { x: 0.5, y: 0 } },
    });
    const arm = { x: 330, y: 103 };
    expect(corner.editor.handleAt(arm, 1)).toBe('elbow');
    drag(corner.editor, arm, { x: 84 + (330 - 84) * 0.5, y: 103 });
    expect(corner.connector()?.elbowMiddle).toBeCloseTo(0.5, 12);
    // Back near the corner: automatic again.
    drag(corner.editor, { x: 207, y: 103 }, { x: 327, y: 103 });
    expect(corner.connector()).not.toHaveProperty('elbowMiddle');
  });

  it('drags the piece square to itself and writes its fraction once, on release', () => {
    const { editor, record, connector } = setUp();
    const quarter = STUB_FROM + (STUB_TO - STUB_FROM) * 0.25;
    expect(editor.press(input('pointerDown', AUTOMATIC), 1)).toBe(true);
    expect(editor.isDragging).toBe(true);
    // Pressed but not yet moved: the bar stays where the document has it.
    expect(editor.handleAt(AUTOMATIC, 1)).toBe('elbow');
    editor.follow({ kind: 'hold' } as ToolPointerInput);
    // The pointer's other coordinate does not matter: the piece moves along x only.
    editor.follow(input('pointerMove', { x: quarter, y: 400 }));
    const preview = record.previews.get(ID) as ConnectorObject | undefined;
    expect(preview?.elbowMiddle).toBeCloseTo(0.25, 12);
    // The bar sits on the piece as the drag previews it, not where the document has it.
    expect(editor.handleAt({ x: quarter, y: 130 }, 1)).toBe('elbow');
    expect(editor.handleAt(AUTOMATIC, 1)).toBeUndefined();
    const bar = editor.overlay()?.toolRects?.[0]?.box;
    expect((bar?.x ?? 0) + (bar?.width ?? 0) / 2).toBeCloseTo(quarter, 9);
    editor.follow(input('pointerUp', { x: quarter, y: 400 }));
    expect(editor.isDragging).toBe(false);
    expect(record.previews.get(ID)).toBeUndefined();
    expect(connector()?.elbowMiddle).toBeCloseTo(0.25, 12);
    expect(record.commands).toBe(1);
  });

  it('keeps the piece between the stubs', () => {
    const { editor, connector } = setUp();
    drag(editor, AUTOMATIC, { x: -500, y: 130 });
    expect(connector()?.elbowMiddle).toBe(0);
    drag(editor, { x: STUB_FROM, y: 130 }, { x: 900, y: 130 });
    expect(connector()?.elbowMiddle).toBe(1);
  });

  it('snaps back to the middle and removes the field there', () => {
    const { editor, record, connector } = setUp({ elbowMiddle: 0.25 });
    const quarter = STUB_FROM + (STUB_TO - STUB_FROM) * 0.25;
    drag(editor, { x: quarter, y: 130 }, { x: AUTOMATIC.x + 5, y: 130 });
    expect(connector()).not.toHaveProperty('elbowMiddle');
    expect(record.commands).toBe(1);
    // Snapping an automatic piece back to the middle writes nothing.
    drag(editor, AUTOMATIC, { x: AUTOMATIC.x - 5, y: 130 });
    expect(record.commands).toBe(1);
  });

  it('snaps within a screen distance, whatever the zoom', () => {
    const { editor, connector } = setUp();
    expect(editor.press(input('pointerDown', AUTOMATIC, 0, 4), 4)).toBe(true);
    // 5 world units is 20 screen px at 400%: past the snap.
    editor.follow(input('pointerMove', { x: AUTOMATIC.x + 5, y: 130 }, 0, 4));
    editor.follow(input('pointerUp', { x: AUTOMATIC.x + 5, y: 130 }, 0, 4));
    expect(connector()?.elbowMiddle).toBeCloseTo(0.5 + 5 / (STUB_TO - STUB_FROM), 12);
  });

  it('writes nothing for a click, and resets the piece on a quick second press', () => {
    const { editor, record, connector } = setUp({ elbowMiddle: 0.25 });
    const handle = { x: STUB_FROM + (STUB_TO - STUB_FROM) * 0.25, y: 130 };
    expect(editor.press(input('pointerDown', handle, 1000), 1)).toBe(true);
    editor.follow(input('pointerUp', handle, 1100));
    expect(record.commands).toBe(0);
    expect(editor.press(input('pointerDown', handle, 1400), 1)).toBe(true);
    expect(editor.isDragging).toBe(false);
    expect(connector()).not.toHaveProperty('elbowMiddle');
    expect(record.commands).toBe(1);
  });

  it('starts a drag, not a reset, on a second press that is too late', () => {
    const { editor, record } = setUp({ elbowMiddle: 0.25 });
    const handle = { x: STUB_FROM + (STUB_TO - STUB_FROM) * 0.25, y: 130 };
    editor.press(input('pointerDown', handle, 0), 1);
    editor.follow(input('pointerUp', handle, 50));
    expect(editor.press(input('pointerDown', handle, 2000), 1)).toBe(true);
    expect(editor.isDragging).toBe(true);
    expect(record.commands).toBe(0);
  });

  it('drops a drag on a cancel, and when the connector is deleted under it', () => {
    const { editor, record, store, connector } = setUp();
    editor.press(input('pointerDown', AUTOMATIC), 1);
    editor.follow(input('pointerMove', { x: 120, y: 130 }));
    editor.follow({ kind: 'pointerCancel' });
    expect(editor.isDragging).toBe(false);
    expect(record.previews.get(ID)).toBeUndefined();
    editor.cancel();
    editor.follow(input('pointerMove', { x: 120, y: 130 }));
    expect(connector()).not.toHaveProperty('elbowMiddle');
    editor.press(input('pointerDown', AUTOMATIC), 1);
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(ID);
    });
    editor.follow(input('pointerMove', { x: 120, y: 130 }));
    expect(editor.isDragging).toBe(false);
    expect(record.commands).toBe(0);
  });

  it('writes without a capture, and reports a refusal', () => {
    const bare = setUp({}, { hasCapture: false });
    drag(bare.editor, AUTOMATIC, { x: 120, y: 130 });
    expect(bare.connector()?.elbowMiddle).toBeGreaterThan(0);
    // The scene still draws a connector the document has lost: the write is refused.
    const stale = setUp({}, { isStale: true });
    stale.editor.press(input('pointerDown', AUTOMATIC), 1);
    stale.store.transact(ADA, (transaction) => {
      transaction.deleteObject(ID);
    });
    stale.editor.follow(input('pointerUp', { x: 120, y: 130 }));
    expect(stale.record.refusals).toHaveLength(1);
  });

  it('redraws at a new zoom only while a handle shows', () => {
    const { editor, select } = setUp();
    expect(editor.followZoom(1)).toBe(false);
    expect(editor.followZoom(2)).toBe(true);
    expect(editor.overlay()?.toolRects?.[0]?.box.height).toBe(ELBOW_HANDLE_LENGTH_PX / 2);
    select([]);
    expect(editor.followZoom(3)).toBe(false);
  });
});

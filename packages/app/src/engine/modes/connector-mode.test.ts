import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { setUpTextDocument, TEXT_CAMERA } from '../__fixtures__/text-document.js';
import { LOCAL_USER_ORIGIN } from '../demo-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';

import { TOOL_MODES } from './tool-modes.js';

// The connector tool over the engine's document side, as the canvas drives it: the demo
// board's first two rectangles, (50, 50) and (140, 50), both 70 × 60, inside the frame section-0
// at (40, 40). In Chrome: tooling/scenario/specs/tools/connector.spec.ts.

/**
 * The document side with a pointer that drags in screen px (world units at this camera).
 *
 * @returns The fixture, a drag helper and a connector reader.
 */
function setUp() {
  const fixture = setUpTextDocument();
  const send = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp: 0,
    };
    fixture.document.handlePointer(input, TEXT_CAMERA);
  };
  const drag = (from: [number, number], to: [number, number]) => {
    send('pointerDown', ...from);
    send('pointerMove', ...to);
    send('pointerUp', ...to);
  };
  const connector = (id: string): ConnectorObject | undefined => {
    const object = fixture.store.get(id as ObjectId);
    return object?.type === 'connector' ? object : undefined;
  };
  return { ...fixture, drag, connector, send };
}

describe('the connector tool on the document side', () => {
  it('connects two objects as one undo step, selects it and hands back to the select tool', () => {
    const { document, drag, connector, history, onToolChange } = setUp();
    document.setActiveTool('connector');
    expect(document.cursor()).toBe('crosshair');
    drag([60, 60], [150, 60]);
    expect(connector('text-1')).toMatchObject({
      from: { kind: 'object', objectId: 'section-0-rect-0-0', anchor: null },
      to: { kind: 'object', objectId: 'section-0-rect-1-0', anchor: null },
      route: 'straight',
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    });
    expect(document.inspect().selectedIds).toEqual(['text-1']);
    expect(onToolChange).toHaveBeenLastCalledWith('select');
    history.undo();
    expect(connector('text-1')).toBeUndefined();
  });

  it('leaves an end over empty board free, and draws in the tool’s style', () => {
    const { document, drag, connector } = setUp();
    document.panels.setToolStyle('connector', { route: 'curved' });
    document.setActiveTool('connector');
    drag([-200, -100], [60, 60]);
    expect(connector('text-1')).toMatchObject({
      from: { kind: 'point', x: -200, y: -100 },
      to: { kind: 'object', objectId: 'section-0-rect-0-0', anchor: null },
      route: 'curved',
    });
  });

  it('edits a connector’s label on Enter and on a double-click, typing as one undo step', () => {
    const { document, drag, connector, history } = setUp();
    document.setActiveTool('connector');
    drag([60, 60], [150, 60]);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toMatchObject({ id: 'text-1', text: '' });
    expect(document.tools.router.activeTool).toBe('connector');
    document.tools.text.session()?.type('next');
    expect(connector('text-1')?.label?.text).toBe('next');
    expect(document.tools.text.styleContext()).toMatchObject({ canAlign: false, isEditing: true });
    document.setActiveTool('select');
    history.undo();
    expect(connector('text-1')?.label).toBeNull();
    expect(document.tools.router.canActivate('text-1' as ObjectId)).toBe(true);
  });

  it('leaves a locked connector’s label alone', () => {
    const { document, drag, store } = setUp();
    document.setActiveTool('connector');
    drag([60, 60], [150, 60]);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject('text-1' as ObjectId, { locked: true });
    });
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toBeUndefined();
  });

  it('drags a selected connector’s end to free it, one undo step; Escape drops a drag', () => {
    const { document, drag, connector, history, send } = setUp();
    document.setActiveTool('connector');
    drag([60, 60], [150, 60]);
    // The connector runs between the facing sides: (120, 80) to (140, 80).
    expect(document.tools.overlay().frame).toBeUndefined();
    drag([140, 80], [-200, -100]);
    expect(connector('text-1')?.to).toEqual({ kind: 'point', x: -200, y: -100 });
    history.undo();
    expect(connector('text-1')?.to).toMatchObject({ kind: 'object' });
    send('pointerDown', 140, 80);
    send('pointerMove', 300, 300);
    expect(document.cursor()).toBe('default');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    send('pointerUp', 300, 300);
    expect(connector('text-1')?.to).toMatchObject({ kind: 'object' });
  });

  it('edits a label at the double-clicked point, and nothing for a connector gone meanwhile', () => {
    const { document, drag, store } = setUp();
    document.setActiveTool('connector');
    drag([60, 60], [150, 60]);
    // The route's middle, where an empty label's caret goes.
    document.tools.router.activate({
      type: 'activate',
      id: 'text-1' as ObjectId,
      world: { x: 130, y: 80 },
    });
    expect(document.inspect().textEditing).toMatchObject({ id: 'text-1', caret: 0 });
    document.setActiveTool('select');
    const connector = store.get('text-1' as ObjectId);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.deleteObject('text-1' as ObjectId);
    });
    const entry = TOOL_MODES.find(({ tool }) => tool === 'connector');
    const services = document.tools.services();
    const activation = {
      type: 'activate',
      id: 'text-1' as ObjectId,
      world: { x: 0, y: 0 },
    } as const;
    expect(connector && entry?.activate?.(services, activation, connector)).toBeUndefined();
  });
});

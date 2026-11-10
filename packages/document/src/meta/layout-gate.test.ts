import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import {
  createDocumentMeta,
  DOCUMENT_LAYOUT_VERSION,
  DOCUMENT_META_KEY,
  META_MAP_NAME,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';
import { parseReadableLayouts } from './layout-declaration.js';
import {
  canReadBoardLayout,
  FIRST_GATED_LAYOUT_VERSION,
  INCOMPLETE_UPDATE_CLOSE_CODE,
  INCOMPLETE_UPDATE_REASON,
  INVALID_STAMP_REASON,
  UPDATE_DEPTH_REASON,
  UPDATE_MALFORMED_REASON,
  isAcceptableStamp,
  isLayoutGateReason,
  LAYOUT_GATE_CLOSE_CODE,
  readBoardLayout,
  UNREADABLE_LAYOUT_REASON,
  UNSTAMPED_WRITE_REASON,
  type BoardLayout,
} from './layout-gate.js';

const UNSTAMPED: BoardLayout = { isStamped: false, layoutVersion: undefined };
const AT_ONE: BoardLayout = { isStamped: true, layoutVersion: 1 };
const AT_TWO: BoardLayout = { isStamped: true, layoutVersion: 2 };
const STAMP_UNKNOWN: BoardLayout = { isStamped: true, layoutVersion: undefined };

describe('canReadBoardLayout', () => {
  it('lets every client open a board nobody has written to, declared or not', () => {
    expect(canReadBoardLayout(UNSTAMPED, [])).toBe(true);
    expect(canReadBoardLayout(UNSTAMPED, [1])).toBe(true);
    expect(canReadBoardLayout(UNSTAMPED, [7])).toBe(true);
  });

  it('lets a client open a stamped board only when it reads the board’s layout', () => {
    expect(canReadBoardLayout(AT_ONE, [1])).toBe(true);
    expect(canReadBoardLayout(AT_ONE, [1, 2])).toBe(true);
    expect(canReadBoardLayout(AT_TWO, [1])).toBe(false);
    expect(canReadBoardLayout(AT_ONE, [2])).toBe(false);
  });

  it('refuses a client that declared nothing on every stamped board (fail closed)', () => {
    const undeclared = parseReadableLayouts(null);
    expect(canReadBoardLayout(AT_ONE, undeclared)).toBe(false);
    expect(canReadBoardLayout(AT_TWO, undeclared)).toBe(false);
    expect(canReadBoardLayout(STAMP_UNKNOWN, undeclared)).toBe(false);
  });

  it('lets a declaring client open a board whose stamp names no layout it can see yet', () => {
    expect(canReadBoardLayout(STAMP_UNKNOWN, [FIRST_GATED_LAYOUT_VERSION])).toBe(true);
    expect(canReadBoardLayout(STAMP_UNKNOWN, [0])).toBe(false);
  });

  it('refuses a build reading only layout 1 once this build stamped a current-layout board', () => {
    const stamped = readBoardLayout(internalsOf(createFixtureStore()).doc);
    expect(stamped).toEqual({ isStamped: true, layoutVersion: DOCUMENT_LAYOUT_VERSION });
    expect(canReadBoardLayout(stamped, [1])).toBe(false);
    expect(canReadBoardLayout(stamped, READABLE_LAYOUT_VERSIONS)).toBe(true);
    // This build still opens a board stamped 1, and may stamp it 2; an old build may not go back.
    expect(canReadBoardLayout(AT_ONE, READABLE_LAYOUT_VERSIONS)).toBe(true);
    expect(isAcceptableStamp(createDocumentMeta(), AT_ONE)).toBe(true);
    expect(isAcceptableStamp({ schemaVersion: 1, layoutVersion: 1 }, stamped)).toBe(false);
  });

  it('refuses a build reading layouts 1 and 2 once this build stamped a current-layout board', () => {
    const stamped = readBoardLayout(internalsOf(createFixtureStore()).doc);
    expect(canReadBoardLayout(stamped, [1, 2])).toBe(false);
    // This build still opens a board stamped 2, and stamps it 3 on its first write.
    const atTwo = { isStamped: true, layoutVersion: 2 } as const;
    expect(canReadBoardLayout(atTwo, READABLE_LAYOUT_VERSIONS)).toBe(true);
    expect(isAcceptableStamp(createDocumentMeta(), atTwo)).toBe(true);
    expect(isAcceptableStamp({ schemaVersion: 1, layoutVersion: 2 }, stamped)).toBe(false);
  });

  it('refuses a build reading layouts 1 to 3 once this build stamped a current-layout board', () => {
    const stamped = readBoardLayout(internalsOf(createFixtureStore()).doc);
    expect(canReadBoardLayout(stamped, [1, 2, 3])).toBe(false);
    // This build still opens a board stamped 3, and stamps it 4 on its first write.
    const atThree = { isStamped: true, layoutVersion: 3 } as const;
    expect(canReadBoardLayout(atThree, READABLE_LAYOUT_VERSIONS)).toBe(true);
    expect(isAcceptableStamp(createDocumentMeta(), atThree)).toBe(true);
    expect(isAcceptableStamp({ schemaVersion: 2, layoutVersion: 3 }, stamped)).toBe(false);
  });

  it('lets this build open the boards it stamps', () => {
    expect(
      canReadBoardLayout(
        { isStamped: true, layoutVersion: DOCUMENT_LAYOUT_VERSION },
        READABLE_LAYOUT_VERSIONS,
      ),
    ).toBe(true);
  });
});

describe('readBoardLayout', () => {
  it('finds no stamp on a document nobody wrote to', () => {
    expect(readBoardLayout(new Y.Doc())).toEqual(UNSTAMPED);
  });

  it('reads the layout a store stamped with its first write', () => {
    const doc = internalsOf(createFixtureStore()).doc;
    expect(readBoardLayout(doc)).toEqual({
      isStamped: true,
      layoutVersion: createDocumentMeta().layoutVersion,
    });
  });

  it('reports a stamp whose value names no layout as stamped at an unknown layout', () => {
    const doc = new Y.Doc();
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 1 });
    expect(readBoardLayout(doc)).toEqual(STAMP_UNKNOWN);
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, 'garbage');
    expect(readBoardLayout(doc)).toEqual(STAMP_UNKNOWN);
  });

  it('keeps a board stamped after its stamp is deleted', () => {
    const doc = new Y.Doc();
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    doc.getMap(META_MAP_NAME).delete(DOCUMENT_META_KEY);
    expect(readBoardLayout(doc)).toEqual(STAMP_UNKNOWN);
  });
});

describe('the gate’s refusal', () => {
  it('closes with a private-use code and names its terminal reasons', () => {
    expect(LAYOUT_GATE_CLOSE_CODE).toBeGreaterThanOrEqual(4000);
    expect(LAYOUT_GATE_CLOSE_CODE).not.toBe(4401);
    expect(LAYOUT_GATE_CLOSE_CODE).not.toBe(4403);
    expect(isLayoutGateReason(UNREADABLE_LAYOUT_REASON)).toBe(true);
    expect(isLayoutGateReason(UNSTAMPED_WRITE_REASON)).toBe(true);
    expect(isLayoutGateReason(INVALID_STAMP_REASON)).toBe(true);
    expect(isLayoutGateReason(UPDATE_DEPTH_REASON)).toBe(true);
    expect(isLayoutGateReason(UPDATE_MALFORMED_REASON)).toBe(true);
    expect(isLayoutGateReason('expired')).toBe(false);
  });

  it('holds back an unprovable update with a code of its own, which is not terminal', () => {
    expect(INCOMPLETE_UPDATE_CLOSE_CODE).toBeGreaterThanOrEqual(4000);
    expect([LAYOUT_GATE_CLOSE_CODE, 4401, 4403]).not.toContain(INCOMPLETE_UPDATE_CLOSE_CODE);
    expect(isLayoutGateReason(INCOMPLETE_UPDATE_REASON)).toBe(false);
  });
});

describe('isAcceptableStamp', () => {
  const atLayoutOne: BoardLayout = { isStamped: true, layoutVersion: 1 };

  it('accepts this build’s stamp, and a newer schema or layout, on a board at layout 1', () => {
    expect(isAcceptableStamp(createDocumentMeta(), atLayoutOne)).toBe(true);
    expect(isAcceptableStamp({ schemaVersion: 99, layoutVersion: 2 }, atLayoutOne)).toBe(true);
    expect(
      isAcceptableStamp(createDocumentMeta(), { isStamped: false, layoutVersion: undefined }),
    ).toBe(true);
  });

  it('refuses a stamp above the highest layout known by the relay', () => {
    expect(
      isAcceptableStamp(
        { schemaVersion: 1, layoutVersion: DOCUMENT_LAYOUT_VERSION + 1 },
        atLayoutOne,
      ),
    ).toBe(false);
    expect(
      isAcceptableStamp({ schemaVersion: 1, layoutVersion: DOCUMENT_LAYOUT_VERSION }, atLayoutOne),
    ).toBe(true);
  });

  it('refuses a stamp that would take the board back to a lower layout', () => {
    const atLayoutTwo: BoardLayout = { isStamped: true, layoutVersion: 2 };
    expect(isAcceptableStamp({ schemaVersion: 1, layoutVersion: 1 }, atLayoutTwo)).toBe(false);
  });

  it('refuses a value that is not two positive whole numbers', () => {
    for (const value of [
      undefined,
      null,
      'layout 1',
      [1, 1],
      Uint8Array.of(1),
      {},
      { schemaVersion: 1 },
      { schemaVersion: 1, layoutVersion: '1' },
      { schemaVersion: 1, layoutVersion: 0 },
      { schemaVersion: 1, layoutVersion: 1.5 },
      { schemaVersion: -1, layoutVersion: 1 },
      { schemaVersion: 1, layoutVersion: Number.POSITIVE_INFINITY },
    ]) {
      expect(isAcceptableStamp(value, atLayoutOne)).toBe(false);
    }
  });
});

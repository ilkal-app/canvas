import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { InstanceBuffer } from '../scene/instance-buffer.js';
import type { InstanceRange } from '../scene/scene-culler.js';
import type { SceneHandles } from '../scene/scene-handles.js';

import { VisibleSlotTable } from './visible-slot-table.js';

const id = (value: string) => value as ObjectId;

/** A scene stand-in: each object's slots and revision under its handle, in one pass. */
class FakeHandles {
  readonly handleById = new Map<ObjectId, number>();
  readonly slots: (number[] | undefined)[] = [];
  readonly revisions: number[] = [];
  private revision = 0;

  set(objectId: string, slots: number[] | undefined): void {
    let handle = this.handleById.get(id(objectId));
    if (handle === undefined) {
      handle = this.handleById.size;
      this.handleById.set(id(objectId), handle);
    }
    this.slots[handle] = slots;
    this.revisions[handle] = slots === undefined ? 0 : ++this.revision;
  }

  /**
   * Gives an object a revision but no slots, as a stale source might.
   *
   * @param objectId - The object.
   */
  setRevisionOnly(objectId: string): void {
    this.set(objectId, undefined);
    const handle = this.handleById.get(id(objectId)) ?? -1;
    this.revisions[handle] = ++this.revision;
  }

  handleOf = (objectId: ObjectId) => this.handleById.get(objectId);
  slotsOf = (handle: number) => this.slots[handle];
  revisionOf = (handle: number) => this.revisions[handle] ?? 0;
}

function source(handles: FakeHandles, recordCount = 64) {
  return {
    handles: handles as unknown as SceneHandles,
    instanceBufferOf: () => ({ recordCount }) as unknown as InstanceBuffer,
  };
}

const ranges = (table: VisibleSlotTable): InstanceRange[] => [...table.ranges];

describe('VisibleSlotTable', () => {
  it('draws consecutive and scattered slots, and unmarks them when they change or leave', () => {
    const handles = new FakeHandles();
    handles.set('run', [0, 1, 2]);
    handles.set('scattered', [10, 12, 13]);
    const scene = source(handles);
    const table = new VisibleSlotTable(0);
    const members = new Set([id('run'), id('scattered')]);
    table.update(scene, 0, 'pass', members, new Set(), [members]);
    expect(ranges(table)).toEqual([
      { start: 0, count: 3 },
      { start: 10, count: 1 },
      { start: 12, count: 2 },
    ]);
    // The scattered object moves to other scattered slots; the run leaves the view.
    handles.set('scattered', [20, 22]);
    table.update(scene, 0, 'pass', new Set([id('scattered')]), new Set(), [
      [id('scattered'), id('run'), id('never-drawn')],
    ]);
    expect(ranges(table)).toEqual([
      { start: 20, count: 1 },
      { start: 22, count: 1 },
    ]);
    expect(table.latestChange.revision).toBe(2);
  });

  it('builds scattered slots on a reset, and skips hidden objects and those with no handle or slots', () => {
    const handles = new FakeHandles();
    handles.set('scattered', [3, 5]);
    handles.set('empty', undefined);
    const table = new VisibleSlotTable(0);
    handles.set('hidden', [8]);
    const members = new Set([id('scattered'), id('empty'), id('unknown'), id('hidden')]);
    table.update(source(handles), 0, 'pass', members, new Set([id('hidden')]), [members]);
    expect(ranges(table)).toEqual([
      { start: 3, count: 1 },
      { start: 5, count: 1 },
    ]);
  });

  it('treats a revision without slots as drawing nothing, and grows its tables for new handles', () => {
    const handles = new FakeHandles();
    for (let index = 0; index < 100; index++) handles.set(`s${String(index)}`, [index]);
    const scene = source(handles, 256);
    const table = new VisibleSlotTable(0);
    table.update(scene, 0, 'pass', new Set(), new Set(), [[]]);
    handles.setRevisionOnly('ghost');
    const members = new Set([...handles.handleById.keys()]);
    table.update(scene, 0, 'pass', members, new Set(), [members]);
    expect(ranges(table)).toEqual([{ start: 0, count: 100 }]);
  });

  it('leaves out hidden objects and keeps the same change when nothing moved', () => {
    const handles = new FakeHandles();
    handles.set('a', [0]);
    handles.set('b', [1]);
    const scene = source(handles);
    const table = new VisibleSlotTable(0);
    const members = new Set([id('a'), id('b')]);
    table.update(scene, 0, 'pass', members, new Set(), [[]]);
    const hidden = new Set([id('b')]);
    table.update(scene, 0, 'pass', members, hidden, [[id('b')]]);
    expect(ranges(table)).toEqual([{ start: 0, count: 1 }]);
    const change = table.latestChange;
    table.update(scene, 0, 'pass', members, hidden, [[id('a'), id('b')]]);
    expect(table.latestChange).toBe(change);
  });
});

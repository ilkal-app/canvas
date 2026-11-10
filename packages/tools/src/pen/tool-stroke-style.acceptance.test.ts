import { describe, expect, it } from 'vitest';

import { createPenModeContext } from './__fixtures__/pen-mode-context.js';
import { PathSession } from './path-session.js';

const styled = {
  stroke: { color: [0.1, 0.1, 0.1, 1] as [number, number, number, number], width: 2 },
  fill: null,
  strokeDash: { pattern: [8, 8] },
  strokeJoin: 'miter' as const,
  strokeMiterLimit: 8,
  strokeCap: 'square' as const,
};

describe('new pen path stroke style', () => {
  it('carries set stroke options from newPathStyle into a draft and created path', () => {
    const { context, store } = createPenModeContext();
    const session = new PathSession({ ...context, newPathStyle: () => styled });
    session.startDraft({ x: 10, y: 20 });
    expect(session.path()).toMatchObject({
      strokeDash: { pattern: [8, 8] },
      strokeJoin: 'miter',
      strokeMiterLimit: 8,
      strokeCap: 'square',
    });
    const empty = { vertices: [], segments: [] };
    const network = {
      vertices: [
        { id: 'v1', x: 0, y: 0, mirror: 'none' as const },
        { id: 'v2', x: 50, y: 0, mirror: 'none' as const },
      ],
      segments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } }],
    };
    expect(session.write(empty, network)).toBe('written');
    const id = session.id;
    if (id === undefined) throw new Error('The pen path has no id.');
    expect(store.get(id)).toMatchObject({
      strokeDash: { pattern: [8, 8] },
      strokeJoin: 'miter',
      strokeMiterLimit: 8,
      strokeCap: 'square',
    });
  });

  it('omits unset options from a new draft', () => {
    const { context } = createPenModeContext();
    const session = new PathSession(context);
    session.startDraft({ x: 10, y: 20 });
    const path = session.path();
    for (const key of ['strokeDash', 'strokeJoin', 'strokeMiterLimit', 'strokeCap']) {
      expect(Object.hasOwn(path ?? {}, key)).toBe(false);
    }
  });
});

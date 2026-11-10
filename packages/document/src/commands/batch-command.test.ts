// A batch writes each object and token once, and an object's text, vertex, segment or
// delete operation first writes what the earlier items kept for it.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { BoardObject, ObjectId, TokenId } from '@canvas/schema';

import type { DocumentTransaction } from '../store/document-store.js';
import type { TokenWrite } from '../tokens/token-writes.js';

import { batchCommand } from './batch-command.js';
import type { BoardReader, Command, CommandContext } from './command.js';

const ID = 'box' as ObjectId;
const BOX = { id: ID, type: 'shape', parentId: null, x: 0, y: 0 } as unknown as BoardObject;
const TOKEN = 'brand' as TokenId;

/** What one item does to the transaction. */
type Step = (transaction: DocumentTransaction) => unknown;

/**
 * A batch over a command whose items are steps, applied to a transaction that records each call
 * and reads `BOX` as stored.
 *
 * @param steps - The items.
 * @returns The calls the batch made, by method name and first argument; the token creations
 *   written; and the results.
 */
function run(steps: readonly Step[]) {
  const command: Command<z.ZodNumber, null, unknown> = {
    name: 'step',
    description: 'Runs a step.',
    input: z.number(),
    validate: () => ({ isValid: true, plan: null }),
    apply: (transaction, index) => steps[index]?.(transaction),
  };
  const calls: [string, unknown][] = [];
  const creations: unknown[] = [];
  const inner = new Proxy({} as DocumentTransaction, {
    get: (unused, method: string) => {
      if (method === 'get') return (id: ObjectId) => (id === ID ? BOX : undefined);
      if (method === 'origin') return { kind: 'agent' };
      return (first: unknown, second: unknown) => {
        calls.push([method, first]);
        if (method === 'setToken') creations.push(second);
        return true;
      };
    },
  });
  const plan = { items: steps.map((unused, index) => ({ input: index, plan: null })) };
  const result = batchCommand(command, 'steps').apply(inner, { steps: [] }, plan);
  return { calls, creations, result };
}

describe('batchCommand apply', () => {
  it('writes an object written by several items once, merged in order, at the end', () => {
    const { calls } = run([
      (t) => {
        t.patchObject(ID, { x: 1 });
      },
      (t) => t.get(ID),
      (t) => {
        t.patchObject(ID, { y: 2 });
      },
    ]);
    expect(calls).toEqual([['setObject', { ...BOX, x: 1, y: 2 }]]);
  });

  it('returns each item result in order under the key', () => {
    const { result } = run([() => 'a', (t) => t.origin, () => 'c']);
    expect(result).toEqual({ steps: ['a', { kind: 'agent' }, 'c'] });
  });

  it.each([
    [
      'insertText',
      (t: DocumentTransaction) => {
        t.insertText(ID, 0, 'hi', {} as never);
      },
    ],
    [
      'deleteText',
      (t: DocumentTransaction) => {
        t.deleteText(ID, 0, 1);
      },
    ],
    [
      'formatText',
      (t: DocumentTransaction) => {
        t.formatText(ID, 0, 1, {});
      },
    ],
    [
      'setVertex',
      (t: DocumentTransaction) => {
        t.setVertex(ID, {} as never);
      },
    ],
    ['deleteVertex', (t: DocumentTransaction) => t.deleteVertex(ID, 'v')],
    [
      'setSegment',
      (t: DocumentTransaction) => {
        t.setSegment(ID, {} as never);
      },
    ],
    ['deleteSegment', (t: DocumentTransaction) => t.deleteSegment(ID, 's')],
  ])('writes what is kept for an object before its %s', (method, step: Step) => {
    const { calls } = run([
      (t) => {
        t.patchObject(ID, { x: 1 });
      },
      step,
    ]);
    expect(calls).toEqual([
      ['setObject', { ...BOX, x: 1 }],
      [method, ID],
    ]);
  });

  it('runs an operation on an object nothing is kept for straight through', () => {
    expect(
      run([
        (t) => {
          t.deleteText(ID, 0, 1);
        },
      ]).calls,
    ).toEqual([['deleteText', ID]]);
  });

  it('drops what is kept for a deleted object and patches an unknown one straight through', () => {
    const other = 'other' as ObjectId;
    const { calls } = run([
      (t) => {
        t.patchObject(ID, { x: 1 });
      },
      (t) => t.deleteObject(ID),
      (t) => {
        t.patchObject(other, { x: 1 });
      },
    ]);
    expect(calls).toEqual([
      ['deleteObject', ID],
      ['patchObject', other],
    ]);
  });

  it('writes a token once with its first creation, and forgets it when deleted', () => {
    const write = (name: string): TokenWrite => ({ id: TOKEN, name }) as unknown as TokenWrite;
    const kept = run([
      (t) => {
        t.setToken(write('A'), { createdBy: 'first' } as never);
      },
      (t) => {
        t.setToken(write('B'), { createdBy: 'second' } as never);
      },
    ]);
    expect(kept.calls).toEqual([['setToken', write('B')]]);
    expect(kept.creations).toEqual([{ createdBy: 'first' }]);
    const deleted = run([
      (t) => {
        t.setToken(write('A'), {} as never);
      },
      (t) => t.deleteToken(TOKEN),
    ]);
    expect(deleted.calls).toEqual([['deleteToken', TOKEN]]);
  });

  it('passes pages, restore markers and token reads straight through', () => {
    const { calls } = run([
      (t) => t.pages(),
      (t) => {
        t.setPage({ id: 'p' } as never, {} as never);
      },
      (t) => t.deletePage('p' as never),
      (t) => t.tokens(),
      (t) => {
        t.markRestore({} as never);
      },
      (t) => {
        t.setObject(BOX);
      },
    ]);
    expect(calls.map(([method]) => method)).toEqual([
      'pages',
      'setPage',
      'deletePage',
      'tokens',
      'markRestore',
      'setObject',
    ]);
  });

  it('passes the board timer and the sticky author setting straight through', () => {
    const { calls } = run([
      (t) => {
        t.setBoardTimer(undefined);
      },
      (t) => {
        t.setStickyAuthors(true);
      },
    ]);
    expect(calls).toEqual([
      ['setBoardTimer', undefined],
      ['setStickyAuthors', true],
    ]);
  });
});

/**
 * Validates a batch over a command whose items are steps, against a board holding `BOX`.
 *
 * @param steps - The items.
 * @param defaultPageId - The board's default page, if it has one.
 * @returns The validation, and the default page each item saw.
 */
function validate(steps: readonly Step[], defaultPageId?: string) {
  const seen: unknown[] = [];
  const command: Command<z.ZodNumber, null, unknown> = {
    name: 'step',
    description: 'Runs a step.',
    input: z.number(),
    validate: (context) => {
      seen.push(context.board.defaultPageId?.());
      return { isValid: true, plan: null };
    },
    apply: (transaction, index) => steps[index]?.(transaction),
  };
  const board: BoardReader = {
    get: (id) => (id === ID ? BOX : undefined),
    references: {} as BoardReader['references'],
    ...(defaultPageId === undefined ? {} : { defaultPageId: () => defaultPageId as never }),
  };
  const context = { board, origin: { kind: 'agent' }, now: 0 } as unknown as CommandContext;
  const batch = batchCommand(command, 'steps');
  return { validation: batch.validate(context, { steps: steps.map((unused, i) => i) }), seen };
}

describe('batchCommand validate', () => {
  it("hands each item the board's default page, when it has one", () => {
    expect(validate([() => undefined], 'page').seen).toEqual(['page']);
    expect(validate([() => undefined]).seen).toEqual([undefined]);
  });

  it('accepts items rewriting, and items leaving, an object an earlier item wrote', () => {
    const { validation } = validate([
      (t) => {
        t.patchObject(ID, { x: 1 });
      },
      (t) => {
        t.patchObject(ID, { y: 2 });
      },
      () => undefined,
    ]);
    expect(validation.isValid).toBe(true);
  });

  it('refuses an item that creates, deletes, re-creates or reparents an object, by index', () => {
    const { validation } = validate([
      (t) => {
        t.setObject({ ...BOX, id: 'new' as ObjectId });
      },
      (t) => t.deleteObject(ID),
      (t) => {
        t.setObject(BOX);
      },
    ]);
    const moved = validate([
      (t) => {
        t.patchObject(ID, { parentId: 'frame' as ObjectId });
      },
    ]);
    if (validation.isValid || moved.validation.isValid) throw new Error('expected refusals');
    expect(validation.errors.map((error) => error.path)).toEqual([
      ['steps', 0],
      ['steps', 1],
      ['steps', 2],
    ]);
    expect(moved.validation.errors).toMatchObject([{ code: 'invalid-input', objectId: ID }]);
  });

  it("keeps a place-preserving command's flag", () => {
    const command = { ...batchCommand({} as Command<z.ZodNumber, null, unknown>, 'a') };
    expect(command.isPlacePreserving).toBeUndefined();
    const preserving = { isPlacePreserving: true } as unknown as Command<z.ZodNumber, null, null>;
    expect(batchCommand({ ...preserving, input: z.number() }, 'a').isPlacePreserving).toBe(true);
  });
});

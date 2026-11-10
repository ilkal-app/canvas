import { afterEach, expect, it, vi } from 'vitest';

import {
  deleteObjectsCommand,
  RunStoppedError,
  YjsDocumentStore,
  type CommandError,
} from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import {
  noticeHandlers,
  runStepped,
  stagingFor,
  STEPPED_MAX_WRITES,
  STOPPED_NOTICE,
  stoppedOrFault,
} from './run-stepped.js';

const started = vi.hoisted((): { outcome: Promise<unknown> } => ({ outcome: Promise.resolve() }));

vi.mock(import('@canvas/document'), async (importOriginal) => ({
  ...(await importOriginal()),
  startRun: () => started.outcome as never,
}));

const ORIGIN = { kind: 'user' as const, principalId: 'user:stepped' as PrincipalId };
const ENVIRONMENT = { clock: () => 1, createId: () => 'new' as ObjectId };

afterEach(() => {
  vi.unstubAllGlobals();
});

it('reports a rejection that is no stop as a fault, wrapping what is not an Error', async () => {
  const store = new YjsDocumentStore();
  const onFault = vi.fn();
  started.outcome = Promise.reject(new Error('broken'));
  runStepped(store, ORIGIN, deleteObjectsCommand, { ids: [] }, ENVIRONMENT, { onFault });
  await vi.waitFor(() => {
    expect(onFault).toHaveBeenCalledWith(new Error('broken'));
  });
  const reported = vi.fn();
  vi.stubGlobal('reportError', reported);
  stoppedOrFault('odd', {});
  expect(reported).toHaveBeenCalledWith(new Error('odd'));
  store.destroy();
});

it('tells a refusal and a stop as notices', () => {
  const notify = vi.fn();
  const handlers = noticeHandlers(notify);
  const errors: CommandError[] = [
    { code: 'locked', objectId: null, path: [], message: 'the object is locked' },
  ];
  handlers.onRefused?.(errors);
  expect(notify).toHaveBeenLastCalledWith('That change could not be made: the object is locked.');
  stoppedOrFault(new RunStoppedError(1, undefined, new Error('stop')), handlers);
  expect(notify).toHaveBeenLastCalledWith(STOPPED_NOTICE);
});

it('plans in stages only a change of more objects than a part writes', () => {
  expect(stagingFor(STEPPED_MAX_WRITES)).toEqual({ isPlanStaged: false });
  expect(stagingFor(STEPPED_MAX_WRITES + 1)).toEqual({ isPlanStaged: true });
});

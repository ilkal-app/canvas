// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand, YjsDocumentStore } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { ObjectId, PrincipalId } from '@canvas/schema';
import { FrameNameMode } from '@canvas/tools';

import { BUSY_NOTICE } from '../index.js';

import { bindFrameNameInput } from './frame-name-input.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1, createId: () => 'id' as ObjectId };
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 200, dpr: 1 };

afterEach(() => {
  document.body.replaceChildren();
});

it('keeps the frame name editor open when Enter arrives during a run', () => {
  const store = new YjsDocumentStore();
  runCommand(
    store,
    ORIGIN,
    createObjectCommand,
    {
      object: {
        type: 'frame',
        id: 'f',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        name: 'Old',
        clip: false,
        background: null,
      },
    },
    ENVIRONMENT,
  );
  const mode = new FrameNameMode(
    {
      store,
      origin: ORIGIN,
      environment: ENVIRONMENT,
      capture: {
        command: (run: () => void) => {
          run();
        },
      },
      requestExit: () => undefined,
      onChange: () => undefined,
    },
    'f' as ObjectId,
  );
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const onNotice = vi.fn();
  const bind = bindFrameNameInput as unknown as (
    canvas: HTMLCanvasElement,
    activeMode: () => unknown,
    camera: () => Camera,
    options: { store: YjsDocumentStore; onNotice(message: string): void },
  ) => ReturnType<typeof bindFrameNameInput>;
  const input = bind(
    canvas,
    () => mode,
    () => CAMERA,
    { store, onNotice },
  );
  input.sync();
  input.element.value = 'New';
  input.element.dispatchEvent(new Event('input'));
  const run = store.beginRun();
  input.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  expect(store.get('f' as ObjectId)).toMatchObject({ name: 'Old' });
  expect(input.element.style.display).toBe('block');
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  input.destroy();
  store.destroy();
});

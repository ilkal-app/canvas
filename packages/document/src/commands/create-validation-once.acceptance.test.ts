import { expect, it, vi } from 'vitest';

import { runCommand, startRun, YjsDocumentStore } from '@canvas/document';
import { DEFAULT_PAGE } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import * as validation from '../store/object-validation.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';
import { createObjectsCommand } from './create-objects.js';

it('parses ordinary creates but skips a final certified, unchanged staged create', async () => {
  const store = new YjsDocumentStore();
  const parse = vi.spyOn(validation, 'parseObject');
  const environment = testEnvironment();
  try {
    const ordinary = runCommand(
      store,
      ADA,
      createObjectsCommand,
      {
        objects: [newRectangle('ordinary', null, { x: 0, y: 0, width: 2, height: 2 })],
        pageId: DEFAULT_PAGE.id,
      },
      environment,
    );
    expect(ordinary.status).toBe('applied');
    expect(parse.mock.calls.filter((args) => args[1] === undefined).length).toBeGreaterThan(0);
    parse.mockClear();
    const options = {
      maxWrites: 4,
      yieldToBrowser: () => Promise.resolve(),
      isPlanStaged: true,
    };
    const pending = startRun(
      store,
      ADA,
      createObjectsCommand,
      {
        objects: [newRectangle('certified', null, { x: 10, y: 0, width: 2, height: 2 })],
        pageId: DEFAULT_PAGE.id,
      },
      environment,
      options,
    );
    if (!(pending instanceof Promise)) throw new Error('expected staged run');
    await pending;
    expect(parse.mock.calls.filter((args) => args[1] === undefined)).toHaveLength(0);
  } finally {
    parse.mockRestore();
    store.destroy();
  }
});

it('keeps store validation when placement adds the missing root page', async () => {
  const store = new YjsDocumentStore();
  const parse = vi.spyOn(validation, 'parseObject');
  try {
    const pending = startRun(
      store,
      ADA,
      createObjectsCommand,
      { objects: [newRectangle('needs-page', null, { x: 0, y: 0, width: 2, height: 2 })] },
      testEnvironment(),
      {
        maxWrites: 4,
        yieldToBrowser: () => Promise.resolve(),
        isPlanStaged: true,
      },
    );
    if (!(pending instanceof Promise)) throw new Error('expected staged run');
    await pending;
    expect(parse.mock.calls.filter((args) => args[1] === undefined)).toHaveLength(1);
  } finally {
    parse.mockRestore();
    store.destroy();
  }
});

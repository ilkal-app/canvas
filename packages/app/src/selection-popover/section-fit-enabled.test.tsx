// @vitest-environment jsdom
// Fit to content is enabled only when the section has a child
// the fit counts; connectors and comments do not, and the command refuses a section with none.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import type { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';

import {
  CONNECTOR,
  mount,
  preparePopover,
  propsOf,
  SHAPE,
} from './popover-shape-connector-fixtures.js';
import { FRAME } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Mounts the popover on one section holding some children.
 *
 * @param children - Its children.
 * @returns Whether Fit to content is disabled.
 */
function isFitDisabled(children: readonly BoardObject[]): boolean {
  const props = propsOf([FRAME]);
  (props.engine as FakeMountedEngine).store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const child of children) transaction.setObject({ ...child, parentId: FRAME.id });
  });
  mount(props);
  return (
    screen.getByRole('button', { name: 'Fit to content' }).getAttribute('aria-disabled') === 'true'
  );
}

it('is disabled for a section holding only a connector, enabled once it holds a shape', () => {
  expect(isFitDisabled([CONNECTOR])).toBe(true);
  cleanup();
  expect(isFitDisabled([CONNECTOR, SHAPE])).toBe(false);
});

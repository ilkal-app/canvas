import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { everyShellAction } from './__fixtures__/every-shell-action.js';
import { isEditingAction } from './editing-actions.js';
import type { ComponentAction } from './shell-action.js';

const action = {
  type: 'component',
  command: 'setSwapOptions',
  id: 'badge-in-card' as ObjectId,
  options: ['check' as ObjectId],
} as unknown as ComponentAction;

describe('setSwapOptions shell action', () => {
  it('is represented in the every-shell-action fixture', () => {
    expect(everyShellAction('badge-in-card' as ObjectId)).toContainEqual(action);
  });

  it('is an editing action that a viewer cannot dispatch', () => {
    expect(isEditingAction(action)).toBe(true);
  });
});

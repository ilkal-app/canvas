// The component board of `component-board.ts` mounted as the app mounts a board
// (`createEngineDocument`: the page-scoped view, the whole board's definitions, the pages), for
// the app tests that run canvas actions on it.
import { vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { InstanceObject, ObjectId } from '@canvas/schema';

import type { CanvasAction, ComponentAction } from '../../state/shell-action.js';
import { createEngineDocument } from '../create-engine-document.js';
import { LOCAL_USER_ORIGIN } from '../demo-document.js';

import { createComponentBoard } from './component-board.js';

/** A component action without its `type`, each command with its own fields. */
export type ComponentInput = ComponentAction extends infer Action
  ? Action extends ComponentAction
    ? Omit<Action, 'type'>
    : never
  : never;

/**
 * The card board mounted as the app mounts a board.
 *
 * @param isInstanceOnSecondPage - Whether the card's instance is on a second page.
 * @param hasDesignTools - Whether the chrome has the design tools; always when absent.
 * @returns The board, the mount's parts, a notice spy and helpers to run actions.
 */
export function mountComponentBoard(
  isInstanceOnSecondPage = false,
  hasDesignTools?: () => boolean,
) {
  const board = createComponentBoard({ isInstanceOnSecondPage });
  const { store } = board;
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const onNotice = vi.fn();
  const services = hasDesignTools === undefined ? {} : { hasDesignTools };
  const parts = createEngineDocument({ store, history, onNotice }, () => undefined, services);
  parts.document.attach({ enqueue: () => undefined, showOverlay: () => undefined });
  const run = (action: CanvasAction): boolean => parts.document.runCanvasAction(action, 1);
  const component = (action: ComponentInput): boolean => run({ type: 'component', ...action });
  const instance = (id = 'inst'): InstanceObject => {
    const object = store.get(id as ObjectId);
    if (object?.type !== 'instance') throw new Error(`${id} is not an instance`);
    return object;
  };
  return { ...board, ...parts, history, onNotice, run, component, instance };
}

// @vitest-environment jsdom
// The onboarding hint under a blank floating whiteboard's dock, and its first use.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createMemoryBoardView, memoryShape } from '../panels/__fixtures__/memory-board.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';
import {
  dismissWhiteboardHint,
  isWhiteboardHintDismissed,
  WHITEBOARD_HINT_STORAGE_KEY,
  whiteboardHintText,
} from '../state/whiteboard-hint.js';

import { WhiteboardHint, type WhiteboardHintProps } from './whiteboard-hint.js';

const EDITOR: WhiteboardHintProps['state'] = { ...INITIAL_SHELL_STATE, canEdit: true };

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

/**
 * The hint's element, if shown.
 *
 * @returns It, or null.
 */
function hint(): HTMLElement | null {
  return document.querySelector('[data-whiteboard-hint]');
}

describe('whiteboardHintText', () => {
  it('names the platform’s search key', () => {
    expect(whiteboardHintText('mac')).toBe('Press N for a sticky · Space to pan · ⌘F to search');
    expect(whiteboardHintText('other')).toBe(
      'Press N for a sticky · Space to pan · Ctrl+F to search',
    );
  });
});

describe('the dismissal record', () => {
  it('is kept under its key and survives a failing storage', () => {
    expect(isWhiteboardHintDismissed()).toBe(false);
    dismissWhiteboardHint();
    expect(localStorage.getItem(WHITEBOARD_HINT_STORAGE_KEY)).toBe('dismissed');
    expect(isWhiteboardHintDismissed()).toBe(true);
    const failing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(isWhiteboardHintDismissed(failing)).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(isWhiteboardHintDismissed()).toBe(false);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
    expect(() => {
      dismissWhiteboardHint(failing);
    }).not.toThrow();
  });
});

describe('WhiteboardHint', () => {
  it('shows on a blank board for an editor, marked for the popover to avoid', () => {
    render(<WhiteboardHint board={createMemoryBoardView([])} state={EDITOR} platform="mac" />);
    expect(screen.getByText(whiteboardHintText('mac'))).toBe(hint());
    expect(hint()?.hasAttribute('data-popover-avoid')).toBe(true);
  });

  it('does not show before an engine runs, on a board with objects, to a viewer or once dismissed', () => {
    const { rerender } = render(<WhiteboardHint board={undefined} state={EDITOR} platform="mac" />);
    expect(hint()).toBeNull();
    rerender(
      <WhiteboardHint
        board={createMemoryBoardView([memoryShape('a', 'a0')])}
        state={EDITOR}
        platform="mac"
      />,
    );
    expect(hint()).toBeNull();
    rerender(
      <WhiteboardHint
        board={createMemoryBoardView([])}
        state={{ ...EDITOR, canEdit: false }}
        platform="mac"
      />,
    );
    expect(hint()).toBeNull();
    cleanup();
    dismissWhiteboardHint();
    render(<WhiteboardHint board={createMemoryBoardView([])} state={EDITOR} platform="mac" />);
    expect(hint()).toBeNull();
  });

  it.each([
    ['a tool chosen', { activeTool: 'sticky' as const }],
    ['board search opened', { boardSearchRequests: 1 }],
  ])('is dismissed for good by its first use: %s', (label, change) => {
    const view = createMemoryBoardView([]);
    const { rerender } = render(<WhiteboardHint board={view} state={EDITOR} platform="mac" />);
    expect(hint()).not.toBeNull();
    rerender(<WhiteboardHint board={view} state={{ ...EDITOR, ...change }} platform="mac" />);
    expect(hint()).toBeNull();
    expect(isWhiteboardHintDismissed()).toBe(true);
  });

  it('is dismissed when an object is created or Space is held, not by Space in a field', () => {
    const view = createMemoryBoardView([]);
    render(<WhiteboardHint board={view} state={EDITOR} platform="mac" />);
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: ' ' });
    expect(hint()).not.toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    expect(hint()).toBeNull();
    expect(isWhiteboardHintDismissed()).toBe(true);
    field.remove();
    cleanup();
    localStorage.clear();
    const growing = createMemoryBoardView([]);
    render(<WhiteboardHint board={growing} state={EDITOR} platform="mac" />);
    expect(hint()).not.toBeNull();
    act(() => {
      growing.objects.set('n' as ObjectId, memoryShape('n', 'a0'));
      growing.emit({ created: ['n' as ObjectId], updated: [], deleted: [] });
    });
    expect(hint()).toBeNull();
    expect(isWhiteboardHintDismissed()).toBe(true);
  });

  it('is not dismissed by Space in a field inside a shadow root, or on a button', () => {
    render(<WhiteboardHint board={createMemoryBoardView([])} state={EDITOR} platform="mac" />);
    const host = document.createElement('div');
    document.body.append(host);
    const field = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(field);
    fireEvent.keyDown(field, { key: ' ', bubbles: true, composed: true });
    const button = document.createElement('button');
    document.body.append(button);
    fireEvent.keyDown(button, { key: ' ' });
    expect(hint()).not.toBeNull();
    expect(isWhiteboardHintDismissed()).toBe(false);
    host.remove();
    button.remove();
  });

  it('shows on a blank board after a board with objects, in the same mounted shell', () => {
    const { rerender } = render(
      <WhiteboardHint
        board={createMemoryBoardView([memoryShape('a', 'a0')])}
        state={EDITOR}
        platform="mac"
      />,
    );
    expect(hint()).toBeNull();
    rerender(<WhiteboardHint board={createMemoryBoardView([])} state={EDITOR} platform="mac" />);
    expect(hint()).not.toBeNull();
    expect(isWhiteboardHintDismissed()).toBe(false);
  });
});

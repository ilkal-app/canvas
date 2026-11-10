// @vitest-environment jsdom
// Where the toast region sits (item 4): a spacing step above the dock, measured from the
// dock's own offset and height (so a change of the dock's bottom margin moves the toasts), and
// Escape's guard. The region itself: toast-region.test.tsx.
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLEARS_DOCK_ATTRIBUTE,
  dockClearancePx,
  homeBottomOf,
  isToastEscape,
} from './toast-placement.js';
import {
  ToastHome,
  ToastHost,
  ToastRegionProvider,
  useToast,
  useToastDock,
} from './toast-region.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('dockClearancePx', () => {
  it('is the dock’s top edge above the container’s bottom edge, never negative', () => {
    // A 50 px dock 12 px off the bottom of an 800 px container.
    expect(dockClearancePx(800, 738)).toBe(62);
    // The dock moved to 16 px off the bottom: the toasts follow.
    expect(dockClearancePx(800, 734)).toBe(66);
    expect(dockClearancePx(800, 900)).toBe(0);
    expect(homeBottomOf(62)).toBe('calc(62px + var(--space-3))');
  });
});

/**
 * A shell with its dock at a given top edge, its home in a positioned box, and one toast.
 *
 * @param props - The dock's top, viewport px, and whether a dialog is open.
 * @param props.dockTop - The dock's top edge.
 * @param props.isDialogOpen - Whether a dialog's place is open.
 * @returns The shell.
 */
function Shell(props: { readonly dockTop: number; readonly isDialogOpen?: boolean }): ReactElement {
  const dockRef = useRef<HTMLDivElement>(null);
  useToastDock(dockRef);
  useToast({ kind: 'info', message: 'Moved to Two.' });
  return (
    <div data-testid="shell">
      <div
        ref={(element) => {
          dockRef.current = element;
          if (element !== null) {
            element.getBoundingClientRect = () => ({ top: props.dockTop }) as DOMRect;
          }
        }}
      />
      <ToastHome />
      {props.isDialogOpen === true ? <ToastHost /> : null}
    </div>
  );
}

describe('useDockClearance', () => {
  it('places a home a spacing step above the dock, following the window, and lets go after', () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element): void {
          observed.push(element);
        }
        disconnect(): void {
          observed.length = 0;
        }
      },
    );
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    const { rerender, unmount } = render(
      <ToastRegionProvider>
        <Shell dockTop={738} />
      </ToastRegionProvider>,
    );
    const home = document.querySelector<HTMLElement>('[data-toast-home]:not(:empty)');
    expect(home?.hasAttribute(CLEARS_DOCK_ATTRIBUTE)).toBe(true);
    expect(home?.style.bottom).toBe('calc(62px + var(--space-3))');
    expect(observed.length).toBeGreaterThan(0);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(home?.style.bottom).toBe('calc(0px + var(--space-3))');
    // In a dialog's place, the home is not used and keeps its stylesheet's place.
    rerender(
      <ToastRegionProvider>
        <Shell dockTop={738} isDialogOpen />
      </ToastRegionProvider>,
    );
    expect(home?.hasAttribute(CLEARS_DOCK_ATTRIBUTE)).toBe(false);
    expect(home?.style.bottom).toBe('');
    unmount();
    vi.unstubAllGlobals();
  });

  it('measures from a positioned container’s bottom edge when the home has one', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ bottom: 500 }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(container);
    render(
      <ToastRegionProvider>
        <Shell dockTop={450} />
      </ToastRegionProvider>,
    );
    const home = document.querySelector<HTMLElement>('[data-toast-home]:not(:empty)');
    expect(home?.style.bottom).toBe('calc(50px + var(--space-3))');
    vi.unstubAllGlobals();
  });
});

describe('isToastEscape', () => {
  /**
   * A keydown dispatched on an element, as the document hears it.
   *
   * @param target - Where the key is pressed.
   * @param init - The key.
   * @returns The event.
   * @throws {Error} When the document does not hear it.
   */
  function keyOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
    let heard: KeyboardEvent | undefined;
    const listener = (event: KeyboardEvent): void => {
      heard = event;
    };
    document.addEventListener('keydown', listener);
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    document.removeEventListener('keydown', listener);
    if (heard === undefined) throw new Error('not heard');
    return heard;
  }

  it('takes a plain Escape, never one inside a menu, a listbox, a dialog or a field', () => {
    document.body.innerHTML =
      '<button>Canvas</button><div role="menu"><button>Grid</button></div>' +
      '<div role="listbox"><div>One</div></div><div role="dialog"><button>Close</button></div>' +
      '<textarea></textarea>';
    const [canvas, grid, , close] = [...document.querySelectorAll('button, [role=listbox] div')];
    if (canvas === undefined || grid === undefined || close === undefined) throw new Error();
    expect(isToastEscape(keyOn(canvas, { key: 'Escape' }))).toBe(true);
    expect(isToastEscape(keyOn(canvas, { key: 'Esc' }))).toBe(false);
    expect(isToastEscape(keyOn(grid, { key: 'Escape' }))).toBe(false);
    const option = document.querySelector('[role=listbox] div');
    if (option === null) throw new Error();
    expect(isToastEscape(keyOn(option, { key: 'Escape' }))).toBe(false);
    expect(isToastEscape(keyOn(close, { key: 'Escape' }))).toBe(false);
    const field = document.querySelector('textarea');
    if (field === null) throw new Error();
    expect(isToastEscape(keyOn(field, { key: 'Escape' }))).toBe(false);
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    prevented.preventDefault();
    expect(isToastEscape(prevented)).toBe(false);
    document.body.innerHTML = '';
  });
});

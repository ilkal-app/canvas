// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { ShellAction } from '../state/shell-action.js';

import { mount, preparePopover, propsOf } from './popover-shape-connector-fixtures.js';
import { FRAME, FRAME_2, IMAGE, IMAGE_2 } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

function expectDisabled(name: string): void {
  expect(button(name).getAttribute('aria-disabled')).toBe('true');
}

describe('Fit to content in the section row', () => {
  it('dispatches once for one unlocked frame with a child', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const props = propsOf([FRAME], { dispatch });
    (props.engine as FakeMountedEngine).store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject({ ...IMAGE, id: 'frame-child' as ObjectId, parentId: FRAME.id });
    });
    mount(props);
    expect(button('Fit to content').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(button('Fit to content'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'fitToContent', id: FRAME.id });
  });

  it('is disabled for an empty, locked, auto-layout or multi-frame selection', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([FRAME], { dispatch }));
    expectDisabled('Fit to content');
    cleanup();
    mount(propsOf([{ ...FRAME, locked: true }], { dispatch }));
    expectDisabled('Fit to content');
    cleanup();
    const layout = {
      direction: 'row' as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'start' as const,
      justify: 'start' as const,
      width: 'fixed' as const,
      height: 'fixed' as const,
    };
    const props = propsOf([{ ...FRAME, autoLayout: layout }], { dispatch });
    (props.engine as FakeMountedEngine).store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject({ ...IMAGE, id: 'frame-child' as ObjectId, parentId: FRAME.id });
    });
    mount(props);
    expectDisabled('Fit to content');
    cleanup();
    mount(propsOf([FRAME, FRAME_2], { dispatch }));
    expectDisabled('Fit to content');
    fireEvent.click(button('Fit to content'));
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('Replace in the image row', () => {
  it('calls the supplied picker once with the single unlocked image id', () => {
    const onReplaceImage = vi.fn<(id: ObjectId) => void>();
    mount(propsOf([IMAGE], { onReplaceImage }));
    expect(button('Replace').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(button('Replace'));
    expect(onReplaceImage).toHaveBeenCalledExactlyOnceWith(IMAGE.id);
    expect(button('Border: None').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('is disabled without a picker and for locked or multiple images', () => {
    const onReplaceImage = vi.fn<(id: ObjectId) => void>();
    mount(propsOf([IMAGE]));
    expectDisabled('Replace');
    cleanup();
    mount(propsOf([{ ...IMAGE, locked: true }], { onReplaceImage }));
    expectDisabled('Replace');
    cleanup();
    mount(propsOf([IMAGE, IMAGE_2], { onReplaceImage }));
    expectDisabled('Replace');
    fireEvent.click(button('Replace'));
    expect(onReplaceImage).not.toHaveBeenCalled();
  });
});

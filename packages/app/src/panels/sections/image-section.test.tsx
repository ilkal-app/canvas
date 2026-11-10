// @vitest-environment jsdom
// The style panel's image section in jsdom: Crop and unavailable-image controls, with opacity
// owned by the Layer section. In Chrome:
// tooling/scenario/specs/tools/image.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ImageObject, ObjectId } from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import { ImageAvailabilityProvider } from '../image-availability-context.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import type { StyleToApply } from '../style-changes.js';

import { stylePanelSection, UNAVAILABLE_IMAGE_MESSAGE } from './image-section.js';

/**
 * An image with an opacity.
 *
 * @param id - Its id.
 * @param opacity - Its opacity.
 * @param isLocked - Whether it is locked.
 * @returns The image.
 */
function image(id: string, opacity: number, isLocked = false): ImageObject {
  return { id: id as ObjectId, type: 'image', opacity, locked: isLocked } as ImageObject;
}

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects.
 * @returns The spies.
 */
function renderSection(selection: readonly BoardObject[]) {
  const applyStyle = vi.fn<(style: StyleToApply) => void>();
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = {
    context: 'image',
    selection,
    defaults: undefined,
    applyStyle,
    dispatch,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return { applyStyle, dispatch };
}

afterEach(cleanup);

describe('the image section', () => {
  it('leaves opacity to the Layer section, including for a mixed selection', () => {
    renderSection([image('a', 0.5), { id: 'shape' as ObjectId, type: 'shape' } as BoardObject]);
    expect(screen.queryByRole('slider', { name: 'Opacity' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Opacity' })).toBeNull();
  });
  it('registers for images only, never for a tool’s style', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'image',
      title: 'Image',
      context: 'image',
      isSelectionOnly: true,
    });
  });

  it('crops one unlocked image, and offers no crop otherwise', () => {
    const { dispatch } = renderSection([image('a', 1)]);
    const crop = screen.getByRole<HTMLButtonElement>('button', { name: 'Crop' });
    expect(fireEvent.mouseDown(crop)).toBe(false);
    fireEvent.click(crop);
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'activate' });
    cleanup();
    const two = renderSection([image('a', 1), image('b', 1)]);
    const unavailable = screen.getByRole<HTMLButtonElement>('button', { name: 'Crop' });
    // Still focusable, and its reason is its description, which a screen reader reads with it.
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');
    expect(unavailable).toHaveProperty('disabled', false);
    const hintId = unavailable.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(hintId)?.textContent).toBe(
      'Select one unlocked image to crop it.',
    );
    fireEvent.click(unavailable);
    expect(two.dispatch).not.toHaveBeenCalled();
    cleanup();
    renderSection([image('a', 1, true)]);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Crop' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('says an image this page began uploading never finished, and offers Remove', async () => {
    const stale = { ...image('a', 1), assetId: 'x'.repeat(64), createdAt: 0 } as ImageObject;
    const read = vi.fn(() => Promise.resolve('unfinished' as const));
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const props = {
      context: 'image',
      selection: [stale],
      defaults: undefined,
      applyStyle: vi.fn(),
      dispatch,
    } as unknown as StylePanelSectionProps;
    const view = render(
      <ImageAvailabilityProvider value={read}>
        <stylePanelSection.render {...props} />
      </ImageAvailabilityProvider>,
    );
    expect(await screen.findByText(/never finished uploading/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'delete' });
    expect(read).toHaveBeenCalledWith('x'.repeat(64));
    // A recent image may still be uploading from another page.
    const fresh = { ...stale, createdAt: Date.now() };
    view.rerender(
      <ImageAvailabilityProvider value={read}>
        <stylePanelSection.render {...props} selection={[fresh]} />
      </ImageAvailabilityProvider>,
    );
    expect(await screen.findByText(/has not finished uploading yet/)).toBeTruthy();
  });

  it('only says an image the page never uploaded is not available on this board', async () => {
    const foreign = { ...image('a', 1), assetId: 'z'.repeat(64), createdAt: 0 } as ImageObject;
    const props = {
      context: 'image',
      selection: [foreign],
      defaults: undefined,
      applyStyle: vi.fn(),
      dispatch: vi.fn<(action: ShellAction) => void>(),
    } as unknown as StylePanelSectionProps;
    render(
      <ImageAvailabilityProvider value={() => Promise.resolve('missing' as const)}>
        <stylePanelSection.render {...props} />
      </ImageAvailabilityProvider>,
    );
    expect(await screen.findByText(UNAVAILABLE_IMAGE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/uploading/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('says nothing of an image the board can show, or without the page’s images', async () => {
    renderSection([{ ...image('a', 1), assetId: 'y'.repeat(64) } as ImageObject]);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

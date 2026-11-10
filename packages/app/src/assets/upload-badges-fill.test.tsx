// @vitest-environment jsdom
// An image fill's upload badge (PR 3): Cancel and Remove clear the fill or
// background they uploaded for, and keep the shape or frame.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { fakeEngine, fakeUploads, image, PREPARED } from './__fixtures__/upload-badge-fakes.js';
import { UploadBadges } from './upload-badges.js';

afterEach(cleanup);

describe('UploadBadges over an image fill', () => {
  it('clears an image fill on Cancel and on Remove, keeping its shape and frame', () => {
    const paint = {
      type: 'image',
      assetId: PREPARED.assetId,
      naturalSize: { width: 10, height: 10 },
      fit: 'crop',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
    const card = { ...image(), id: 'card' as ObjectId, type: 'shape', fill: paint };
    const panel = { ...image(), id: 'panel' as ObjectId, type: 'frame', background: paint };
    const cleared = {
      type: 'style',
      changes: [
        { id: 'card', style: { fill: null } },
        { id: 'panel', style: { background: null } },
      ],
    };
    for (const button of ['Cancel upload', 'Remove image']) {
      const { uploads, emit } = fakeUploads();
      const { engine, select, runCanvasAction } = fakeEngine([
        card as unknown as BoardObject,
        panel as unknown as BoardObject,
      ]);
      const { unmount } = render(<UploadBadges uploads={uploads} engine={engine} />);
      act(() => {
        uploads.add(PREPARED, new Blob([]), [card.id, panel.id]);
      });
      emit({ type: 'start' });
      if (button === 'Remove image') emit({ type: 'error', message: 'Busy.' });
      // One overlay over each, each with the button.
      const [first] = screen.getAllByRole('button', { name: button });
      if (first === undefined) throw new Error(`no ${button}`);
      fireEvent.click(first);
      expect(runCanvasAction).toHaveBeenCalledExactlyOnceWith(cleared);
      expect(select).not.toHaveBeenCalled();
      expect(uploads.snapshot()).toEqual([]);
      unmount();
    }
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToastRegionProvider } from '../feedback/toast-region.js';

import { ViewOnlyNoticeMemory } from './view-only-notice-memory.js';
import { ViewOnlyNotice, type ViewOnlyNoticeProps } from './view-only-notice.js';

const LockedNotice = ViewOnlyNotice as ComponentType<
  ViewOnlyNoticeProps & { readonly lock: { readonly boards: number } }
>;

afterEach(cleanup);

describe('view-only notice for a locked board', () => {
  it('names the owner limit when editing is blocked by a plan lock', async () => {
    const memory = new ViewOnlyNoticeMemory(() => undefined);
    render(
      <ToastRegionProvider>
        <LockedNotice boardId="locked-board" canEdit={false} lock={{ boards: 5 }} memory={memory} />
      </ToastRegionProvider>,
    );
    expect(
      await screen.findByText(
        "This board is read-only because its owner's plan includes 5 boards.",
      ),
    ).toBeTruthy();
  });
});

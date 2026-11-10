// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { setFontReplacement } from '../text-input/font-replacement.js';

import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  setFontReplacement(undefined);
});

it('opens and cancels a replacement dialog without interrupting shell hooks', () => {
  const { mount } = createFakeMount();
  render(<AppShell mode="diagram" platform="other" mountEngine={mount} />);
  act(() => {
    setFontReplacement({
      owner: {},
      families: ['Private Mono'],
      replace: () => Promise.resolve(true),
    });
  });
  expect(screen.getByRole('dialog', { name: 'Choose a font to edit this text' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  // The closed inspector has no toggle; its shortcut still opens it after dialog cancellation.
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: '8',
    code: 'Digit8',
    altKey: true,
  });
  expect(screen.getByRole('region', { name: 'Inspector' })).toBeTruthy();
});

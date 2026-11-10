// @vitest-environment jsdom
import { expect, it } from 'vitest';

import { keyRowIndex } from './key-row-index.js';

/**
 * A list of rows numbered as the layers list numbers them, each with a button inside.
 *
 * @returns The list.
 */
function list(): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML =
    '<div data-index="0"><button>a</button></div><div data-index="1"><button>b</button></div>';
  return element;
}

it('reads the row a key came from, inside the row too, not the focus target', () => {
  // After Alt+ArrowDown moved the focused row from 0 to 1, the target still said 0.
  const element = list();
  const row = element.querySelector('[data-index="1"]');
  expect(keyRowIndex(row, 0)).toBe(1);
  expect(keyRowIndex(row?.querySelector('button') ?? null, 0)).toBe(1);
});

it('falls back to the focus target for a key on the list itself or no element', () => {
  expect(keyRowIndex(list(), 1)).toBe(1);
  expect(keyRowIndex(null, 0)).toBe(0);
  const odd = document.createElement('div');
  odd.dataset.index = 'x';
  expect(keyRowIndex(odd, 2)).toBe(2);
});

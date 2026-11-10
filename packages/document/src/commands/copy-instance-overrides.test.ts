import { expect, it } from 'vitest';

import { id } from '../store/__fixtures__/store-fixtures.js';

import { copyInstanceOverrides } from './copy-instance-overrides.js';

it('remaps nested paths only through copied definitions, keeping source suffixes unchanged', () => {
  const record = { text: 'Own text' };
  const overrides = { 'nested/leaf': record };
  const copies = new Map([
    [id('main'), id('main-copy')],
    [id('nested'), id('nested-copy')],
    [id('inner'), id('inner-copy')],
    [id('leaf'), id('leaf-copy')],
  ]);
  const inner = () => id('inner');
  expect(copyInstanceOverrides(overrides, id('main'), copies, inner)).toEqual({
    'nested-copy/leaf-copy': record,
  });
  copies.delete(id('inner'));
  expect(copyInstanceOverrides(overrides, id('main'), copies, inner)).toEqual({
    'nested-copy/leaf': record,
  });
  copies.delete(id('main'));
  copies.set(id('inner'), id('inner-copy'));
  expect(copyInstanceOverrides(overrides, id('main'), copies, inner)).toEqual(overrides);
  expect(overrides).toEqual({ 'nested/leaf': record });
});

it('follows a swap only into a copied definition, and remaps the swap when its main is copied', () => {
  const overrides = {
    slot: { mainId: id('icon-b') },
    'slot/inner/leaf': { isHidden: true },
  };
  const copies = new Map([
    [id('button'), id('button-copy')],
    [id('slot'), id('slot-copy')],
    [id('inner'), id('inner-copy')],
    [id('leaf'), id('leaf-copy')],
  ]);
  const stored = () => id('icon-a');
  // icon-b is not copied, so the path stops being rewritten below the slot.
  expect(copyInstanceOverrides(overrides, id('button'), copies, stored)).toEqual({
    'slot-copy': { mainId: id('icon-b') },
    'slot-copy/inner/leaf': { isHidden: true },
  });
  // Neither the button nor the swapped-in main is copied; nothing changes.
  copies.delete(id('button'));
  expect(copyInstanceOverrides(overrides, id('button'), copies, stored)).toEqual(overrides);
});

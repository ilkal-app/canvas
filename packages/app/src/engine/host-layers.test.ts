import { describe, expect, it, vi } from 'vitest';

import { HostLayers } from './host-layers.js';

describe('HostLayers', () => {
  it('keeps each layer’s latest model for the view attached later, and sends later ones on', () => {
    const layers = new HostLayers();
    layers.show('tint', 1);
    layers.show('tint', 2);
    layers.show('peers', 'a');
    const view = { showLayer: vi.fn() };
    layers.attach(view);
    expect(view.showLayer.mock.calls).toEqual([
      ['tint', 2],
      ['peers', 'a'],
    ]);
    layers.show('peers', 'b');
    expect(view.showLayer).toHaveBeenLastCalledWith('peers', 'b');
    layers.setter('tint')(3);
    expect(view.showLayer).toHaveBeenLastCalledWith('tint', 3);
  });
});

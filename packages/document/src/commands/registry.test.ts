import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { COMMANDS, findCommand } from './registry.js';

describe('the command registry', () => {
  it('lists every command under its own name, with a description and an input schema', () => {
    expect(Object.keys(COMMANDS)).toEqual([
      'detachInstance',
      'resetInstanceOverrides',
      'setConstraints',
      'setAutoLayout',
      'setLayoutChild',
      'patchAutoLayout',
      'setInstanceOverride',
      'setInstanceVariant',
      'setVariantAxes',
      'setVariantPreset',
      'resetVariantPreset',
      'setSwapOptions',
      'createComponent',
      'createInstance',
      'createObject',
      'createObjects',
      'createFrame',
      'renameFrame',
      'renameObject',
      'deleteObjects',
      'moveObjects',
      'resizeObjects',
      'rotateObjects',
      'setStyle',
      'setTextRuns',
      'group',
      'ungroup',
      'connect',
      'bringToFront',
      'sendToBack',
      'bringForward',
      'sendBackward',
      'placeObjects',
      'setLocked',
      'applyLinkUnfurl',
      'setLinkLayout',
      'retryLinkUnfurl',
      'linkCardToText',
      'setLinePoints',
      'setConnectorEnd',
      'editNetwork',
      'addPage',
      'renamePage',
      'reorderPage',
      'duplicatePage',
      'deletePage',
      'moveObjectsToPage',
      'setColorToken',
      'renameColorToken',
      'deleteColorToken',
      'resetColorToken',
      'setTextStyle',
      'deleteTextStyle',
      'replaceFontFamily',
      'setEffectStyle',
      'deleteEffectStyle',
      'setBoardTimer',
      'setStickyAuthors',
      'fitFrameToContent',
      'replaceImage',
    ]);
    for (const [name, command] of Object.entries(COMMANDS)) {
      expect(command.name).toBe(name);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it('describes every input as JSON Schema, which is what agents are shown', () => {
    for (const command of Object.values(COMMANDS)) {
      expect(z.toJSONSchema(command.input, { io: 'input' })).toMatchObject({ type: 'object' });
    }
  });

  it('finds commands by name and nothing else', () => {
    expect(findCommand('moveObjects')).toBe(COMMANDS.moveObjects);
    expect(findCommand('toString')).toBeUndefined();
    expect(findCommand('reorder')).toBeUndefined();
  });
});

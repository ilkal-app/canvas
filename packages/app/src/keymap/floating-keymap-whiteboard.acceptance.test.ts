// The floating whiteboard's complete shortcut contract, including its popover key.
import { describe, expect, it } from 'vitest';

import { createDefaultShortcutRegistry } from './default-keymap.js';
import { createFloatingShortcutRegistry } from './floating-keymap.js';

const REQUIRED_CHORDS = [
  'v',
  'h',
  'f',
  's',
  'i',
  't',
  'c',
  'p',
  'n',
  'm',
  'shift+n',
  'shift+m',
  'shift+1',
  'shift+0',
  'mod+f',
  'mod+/',
] as const;

describe('floating whiteboard shortcuts', () => {
  it.each(['mac', 'other'] as const)(
    'registers every required chord without a clash on %s',
    (platform) => {
      const registry = createFloatingShortcutRegistry(platform);
      const chords = registry.entries.flatMap((entry) => entry.chords);
      for (const chord of REQUIRED_CHORDS) expect(chords).toContain(chord);
      expect(chords).toHaveLength(new Set(chords).size);
    },
  );

  it.each(['mac', 'other'] as const)('maps mod+/ to the selection popover on %s', (platform) => {
    const registry = createFloatingShortcutRegistry(platform);
    expect(registry.entries.find((entry) => entry.id === 'selection.focus-popover')).toMatchObject({
      category: 'selection',
      description: "Focus the selection's properties",
      chords: ['mod+/'],
      action: { type: 'focusSelectionPopover' },
    });
    expect(
      createDefaultShortcutRegistry(platform).entries.some((entry) =>
        entry.chords.includes('mod+/'),
      ),
    ).toBe(false);
  });
});

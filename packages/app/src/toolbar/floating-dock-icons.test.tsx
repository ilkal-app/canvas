// @vitest-environment jsdom
// +: every floating dock button shows the design's icon (the design board's "dock"
// in "Dock tools and their panels", whose buttons swap in Library icons), in the design's order.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { ICON_PATHS, type IconName } from '../icons/icon-paths.js';
import { ICON_SIZE_PX } from '../icons/icon.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';

/** The design's dock, section by section: each button's name and our icon for its Library icon. */
const DESIGN_DOCK: readonly (readonly [
  section: string,
  buttons: readonly (readonly [string, IconName])[],
])[] = [
  [
    'Navigate',
    [
      ['Select', 'select'], // icon/select
      ['Pan', 'hand'], // icon/hand
      ['Section', 'section'], // icon/frame
    ],
  ],
  [
    'Set the stage',
    [
      ['Shapes', 'shapes'], // icon/shapes
      ['Image', 'image'], // icon/image
      ['Text', 'text'], // icon/text
      ['Connector', 'connector'], // icon/connector
      ['Draw', 'pencil'], // icon/pencil
    ],
  ],
  [
    'Collaborate',
    [
      ['Sticky note', 'note'], // icon/note
      ['Comment', 'comment'], // icon/comment
      ['Reactions', 'reactions'], // icon/smile
    ],
  ],
];

afterEach(cleanup);

it('shows the design’s icon on every dock button, in its order and sections, at 20 px', () => {
  render(
    <commentContext.Provider value={writer()}>
      <FloatingDock
        registry={createFloatingShortcutRegistry('mac')}
        state={{ ...INITIAL_SHELL_STATE, canEdit: true }}
        dispatch={() => undefined}
      />
    </commentContext.Provider>,
  );
  const dock = screen.getByRole('toolbar', { name: 'Tools' });
  const groups = within(dock).getAllByRole('group');
  expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(
    DESIGN_DOCK.map(([section]) => section),
  );
  DESIGN_DOCK.forEach(([, buttons], index) => {
    const shown = [...(groups[index]?.querySelectorAll('button') ?? [])].map((button) => {
      const icon = button.querySelector('svg[data-icon]');
      return [
        button.getAttribute('aria-label')?.replace(/ (\(.*\)|— .*)$/, ''),
        icon?.getAttribute('data-icon'),
        icon?.getAttribute('width'),
      ];
    });
    expect(shown).toEqual(buttons.map(([label, icon]) => [label, icon, String(ICON_SIZE_PX)]));
  });
});

it('draws Section as the Library’s frame and Reactions as its smile', () => {
  expect(ICON_PATHS.section).toBe(ICON_PATHS.frame);
  // icon/smile: a face, two eyes and a smile.
  expect(ICON_PATHS.reactions).toMatch(/^M8 2\.4c3\.2 0 5\.6 2\.4 5\.6 5\.6/);
});

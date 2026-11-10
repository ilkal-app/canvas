// CONTRACT: compact floating sections and the editor-only More tools are role-specific and pure.
import { describe, expect, it } from 'vitest';

import type { DockRole } from './dock-layout.js';
import {
  FLOATING_DOCK_SECTIONS,
  floatingMobileBarSectionsFor,
  type FloatingDockSection,
  type FloatingDockToolId,
} from './floating-dock.js';
import * as floatingMobileBar from './floating-mobile-bar.js';

// The module may still be absent; the explicit contract keeps lint useful while typecheck reports
// its missing import.
const { FLOATING_MOBILE_MORE_TOOLS, floatingMobileBarOf } = floatingMobileBar as Record<
  'FLOATING_MOBILE_MORE_TOOLS',
  readonly FloatingDockToolId[]
> & {
  readonly floatingMobileBarOf: (role: DockRole) => {
    readonly sections: readonly FloatingDockSection[];
    readonly more: readonly FloatingDockToolId[];
  };
};

describe('compact floating bar layout', () => {
  it('moves the editor’s four overflow tools into More in their prescribed order', () => {
    expect(FLOATING_MOBILE_MORE_TOOLS).toEqual(['section', 'image', 'connector', 'reactions']);
    expect(floatingMobileBarOf('editor')).toEqual({
      sections: [
        { id: 'navigate', label: 'Navigate', tools: ['select'] },
        { id: 'stage', label: 'Set the stage', tools: ['shapes', 'text', 'draw'] },
        { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment'] },
      ],
      more: ['section', 'image', 'connector', 'reactions'],
    });
  });

  it('keeps every commenter and viewer tool in its section without a More menu', () => {
    for (const role of ['commenter', 'viewer'] as const) {
      expect(floatingMobileBarOf(role)).toEqual({
        sections: floatingMobileBarSectionsFor(role),
        more: [],
      });
    }
    expect(floatingMobileBarOf('commenter').sections).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select'] },
      { id: 'collaborate', label: 'Collaborate', tools: ['comment', 'reactions'] },
    ]);
    expect(floatingMobileBarOf('viewer').sections).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select'] },
    ]);
  });

  it('does not mutate source sections across repeated calls', () => {
    const before = structuredClone(FLOATING_DOCK_SECTIONS);
    const source = floatingMobileBarSectionsFor('editor');
    const result = floatingMobileBarOf('editor');
    expect(FLOATING_DOCK_SECTIONS).toEqual(before);
    expect(source[0]?.tools).toEqual(['select', 'section']);
    expect(floatingMobileBarOf('editor')).toEqual(result);
  });
});

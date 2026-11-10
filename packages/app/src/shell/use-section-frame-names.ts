import { useEffect, useRef } from 'react';

import { FRAME_NAME_PREFIX } from '@canvas/tools';

import { SECTION_NAME_PREFIX } from '../state/floating-dock.js';
import type { ShellAction } from '../state/shell-action.js';

/**
 * Names the frames drawn under the floating dock sections: gives the frame tool the
 * "Section" prefix for new frames' names ("Section 1", not "Frame 1") while the dock shows and the
 * person may edit, and "Frame" again once it no longer shows (the board's mode changed under a
 * mounted shell). The classic chrome, which never had it, is left as it is: "Frame N".
 *
 * @param dispatch - The shell's dispatch.
 * @param isFloatingDock - Whether the floating dock shows (a whiteboard under the floating chrome).
 * @param canEdit - Whether the person may edit.
 */
export function useSectionFrameNames(
  dispatch: (action: ShellAction) => void,
  isFloatingDock: boolean,
  canEdit: boolean,
): void {
  const isSectionRef = useRef(false);
  useEffect(() => {
    const isSection = isFloatingDock && canEdit;
    // Only a change says anything: the classic chrome, which never had Section, gets nothing.
    if (isSection === isSectionRef.current) return;
    isSectionRef.current = isSection;
    dispatch({
      type: 'setToolStyle',
      tool: 'frame',
      style: { framePrefix: isSection ? SECTION_NAME_PREFIX : FRAME_NAME_PREFIX },
    });
  }, [dispatch, isFloatingDock, canEdit]);
}

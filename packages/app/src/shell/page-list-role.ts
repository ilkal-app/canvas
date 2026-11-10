import type { ObjectId } from '@canvas/schema';

import type { NoticeAction } from '../hooks/use-notice.js';
import type { PageListSource } from '../pages/page-switcher.js';

import type { AppShellProps } from './app-shell.js';

/**
 * Whether the floating board bar's pages offer editing (Add page and the list's edits):
 * the loading role while the board loads, then the connection's role, read in the same render.
 * Not the shell state's `canEdit`, which reaches `true` one effect after the connection opens:
 * Add page would leave the bar for that render and come back, and the bar would change width.
 *
 * @param props - The shell's props: whether it is loading and the role it lays out meanwhile.
 * @param canEditByRole - Whether the connection's role may edit, once loaded.
 * @returns Whether the pages offer editing.
 */
export function pageListCanEditOf(
  props: Pick<AppShellProps, 'isLoading' | 'hasEditingLayoutWhileLoading'>,
  canEditByRole: boolean,
): boolean {
  return props.isLoading === true && props.hasEditingLayoutWhileLoading !== undefined
    ? props.hasEditingLayoutWhileLoading
    : canEditByRole;
}

/**
 * What the floating board bar's pages work with: the role (`pageListCanEditOf`), the
 * selection and the notice.
 *
 * @param props - The shell's props: whether it is loading and the role it lays out meanwhile.
 * @param canEditByRole - Whether the connection's role may edit, once loaded.
 * @param selectedIds - The selection.
 * @param onNotice - Shows a notice.
 * @returns The pages' source.
 */
export function pageListOf(
  props: Pick<AppShellProps, 'isLoading' | 'hasEditingLayoutWhileLoading'>,
  canEditByRole: boolean,
  selectedIds: readonly ObjectId[],
  onNotice: (message: string, action?: NoticeAction) => void,
): PageListSource {
  return { canEdit: pageListCanEditOf(props, canEditByRole), selectedIds, onNotice };
}

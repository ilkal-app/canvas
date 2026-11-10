/**
 * The groups the cheat sheet shows shortcuts under, following the canvas's commands:
 * tools, navigation, selection and arrangement, history, and the
 * shell's own help.
 */
export type ShortcutCategory =
  'tools' | 'navigation' | 'selection' | 'arrangement' | 'history' | 'help';

/** A shortcut category with the heading the cheat sheet shows for it. */
export interface ShortcutCategoryInfo {
  /** The category. */
  readonly category: ShortcutCategory;
  /** The heading shown above the category's shortcuts. */
  readonly label: string;
}

/** Every category, in the order the cheat sheet lists them. */
export const SHORTCUT_CATEGORIES: readonly ShortcutCategoryInfo[] = [
  { category: 'tools', label: 'Tools' },
  { category: 'navigation', label: 'Navigation' },
  { category: 'selection', label: 'Selection and editing' },
  { category: 'arrangement', label: 'Arrangement' },
  { category: 'history', label: 'History' },
  { category: 'help', label: 'Help' },
];

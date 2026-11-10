/**
 * The modules of a contribution folder as `import.meta.glob(…, { eager: true })` returns them:
 * each module by its path, holding its named exports.
 */
export type ContributionModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Collects one named export from every module of a contribution folder, in path order: how the
 * shell finds the style panel sections (`panels/sections/*-section.tsx`), the toolbar actions
 * (`toolbar/actions/*-action.ts`) and the extra shortcuts (`keymap/contributions/*-shortcuts.ts`)
 * that later tasks add as files of their own, without editing a list.
 * The modules are taken as values, so a bundler keeps them however strictly it drops side
 * effects.
 *
 * @template TContribution - What each module contributes.
 * @param modules - The folder's modules, by path.
 * @param exportName - The export every module must have.
 * @param isContribution - Whether an export's value is a well-formed contribution.
 * @returns The contributions, in the modules' path order.
 * @throws {Error} When a module lacks the export or exports something else under its name, so
 *   a misnamed file fails the unit tests instead of silently contributing nothing.
 */
export function collectContributions<TContribution>(
  modules: ContributionModules,
  exportName: string,
  isContribution: (value: unknown) => value is TContribution,
): TContribution[] {
  return Object.keys(modules)
    .sort()
    .map((path) => {
      const value = modules[path]?.[exportName];
      if (!isContribution(value)) {
        throw new Error(`${path} must export \`${exportName}\` of the contribution's type.`);
      }
      return value;
    });
}

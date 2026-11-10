import { useEffect, useMemo, useState } from 'react';

import { useDefaultShortcutRegistry } from '../hooks/use-default-shortcut-registry.js';
import type { StylePanelRegistry } from '../panels/panel-sections.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import { createDefaultToolbarActionRegistry } from '../toolbar/default-toolbar-actions.js';
import type { ToolbarActionRegistry } from '../toolbar/toolbar-actions.js';

import { useIsFloatingDock } from './use-floating-dock.js';

/** The shell's registries: what its shortcuts, toolbar actions and style panel sections are. */
export interface ShellRegistries {
  /** The default shortcuts for the platform (`useDefaultShortcutRegistry`). */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The toolbar's action buttons. */
  readonly actions: ToolbarActionRegistry;
  /**
   * The style panel's sections: those given, else the default sections once loaded
   * ({@link loadDefaultStylePanelRegistry}); undefined until then.
   */
  readonly sections: StylePanelRegistry | undefined;
}

/**
 * The shell's registries, each made once: the default shortcuts for the platform (detected if
 * not given; the floating dock's keys on a whiteboard under the floating chrome), and the toolbar's actions and the style panel's sections (those registered by
 * file in `toolbar/actions/` and `panels/sections/` if not given; the default sections load
 * apart from the page's first script). Main thread.
 *
 * @param platform - The keyboard convention, if given.
 * @param toolbarActions - The toolbar's actions, if given.
 * @param stylePanelSections - The style panel's sections, if given.
 * @returns The registries.
 */
export function useShellRegistries(
  platform: KeyboardPlatform | undefined,
  toolbarActions: ToolbarActionRegistry | undefined,
  stylePanelSections: StylePanelRegistry | undefined,
): ShellRegistries {
  const registry = useDefaultShortcutRegistry(platform, useIsFloatingDock());
  const actions = useMemo(
    () => toolbarActions ?? createDefaultToolbarActionRegistry(),
    [toolbarActions],
  );
  const sections = useStylePanelRegistry(stylePanelSections);
  return { registry, actions, sections };
}

/** The default sections' registry, loading or loaded (one load per page). */
let defaultSections: Promise<StylePanelRegistry> | undefined;

/** The default sections' registry once loaded, for a shell mounted after the first load. */
let loadedDefaultSections: StylePanelRegistry | undefined;

/**
 * Loads the default style panel sections (`panels/sections/`, with their controls) apart from
 * the page's first script: the style panel shows once they arrive. One load per page;
 * a failed load is tried again by the next shell that asks.
 *
 * @returns The default sections' registry.
 */
export function loadDefaultStylePanelRegistry(): Promise<StylePanelRegistry> {
  defaultSections ??= import('../panels/default-style-sections.js').then(
    ({ createDefaultStylePanelRegistry }) => {
      loadedDefaultSections = createDefaultStylePanelRegistry();
      return loadedDefaultSections;
    },
    (error: unknown) => {
      defaultSections = undefined;
      throw error;
    },
  );
  return defaultSections;
}

/**
 * The style panel's sections: those given, else the default ones, loaded on first use
 * ({@link loadDefaultStylePanelRegistry}). Main thread.
 *
 * @param given - The sections the shell was given, if any.
 * @returns The sections, or undefined while the default ones load.
 */
function useStylePanelRegistry(
  given: StylePanelRegistry | undefined,
): StylePanelRegistry | undefined {
  const [loaded, setLoaded] = useState(loadedDefaultSections);
  useEffect(() => {
    if (given !== undefined || loaded !== undefined) return undefined;
    let isLive = true;
    loadDefaultStylePanelRegistry().then(
      (registry) => {
        if (isLive) setLoaded(registry);
      },
      (error: unknown) => {
        reportError(new Error('The style panel could not load its sections.', { cause: error }));
      },
    );
    return () => {
      isLive = false;
    };
  }, [given, loaded]);
  return given ?? loaded;
}

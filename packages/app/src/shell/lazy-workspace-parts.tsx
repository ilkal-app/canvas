import {
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from 'react';

import type { StylePanelProps } from '../panels/style-panel.js';
import type { SelectionPopoverProps } from '../selection-popover/selection-popover.js';

import { shellBoardModeContext } from './shell-board-mode.js';
import { loadDefaultStylePanelRegistry } from './use-shell-registries.js';
import { useWhiteboardChrome } from './whiteboard-chrome.js';

/** A component whose code loads apart from the page's first script. */
interface LazyPart<P> {
  /** Loads it: once per page, again after a failure. */
  readonly load: () => Promise<ComponentType<P>>;
  /** It once loaded, for a mount after the load. */
  loaded: ComponentType<P> | undefined;
}

/**
 * A component loaded on first use, kept for every mount after.
 *
 * @param name - What it is, for a failed load's report.
 * @param importer - Imports its module and picks the component.
 * @returns The part.
 */
function lazyPart<P>(name: string, importer: () => Promise<ComponentType<P>>): LazyPart<P> {
  let loading: Promise<ComponentType<P>> | undefined;
  const part: LazyPart<P> = {
    loaded: undefined,
    load: () => {
      loading ??= importer().then(
        (component) => {
          part.loaded = component;
          return component;
        },
        (error: unknown) => {
          loading = undefined;
          throw new Error(`The ${name} could not load.`, { cause: error });
        },
      );
      return loading;
    },
  };
  return part;
}

/**
 * A lazy part's component: at once when loaded, else undefined until its load arrives (a failed
 * load is reported). Main thread.
 *
 * @param part - The part.
 * @returns The component, or undefined while it loads.
 */
function useLazyPart<P>(part: LazyPart<P>): ComponentType<P> | undefined {
  const [component, setComponent] = useState(() => part.loaded);
  useEffect(() => {
    if (component !== undefined) return undefined;
    let isLive = true;
    part.load().then(
      (loaded) => {
        if (isLive) setComponent(() => loaded);
      },
      (error: unknown) => {
        reportError(error);
      },
    );
    return () => {
      isLive = false;
    };
  }, [part, component]);
  return component;
}

/** The style panel. */
const STYLE_PANEL = lazyPart<StylePanelProps>(
  'style panel',
  async () => (await import('../panels/style-panel.js')).StylePanel,
);

/** The selection popover. */
const SELECTION_POPOVER = lazyPart<SelectionPopoverProps>(
  'selection popover',
  async () => (await import('../selection-popover/selection-popover.js')).SelectionPopover,
);

/**
 * Loads the workspace's lazy parts now: the style panel, its default sections and the
 * selection popover, so a shell mounted after shows them at once.
 *
 * @returns Resolves once all are loaded.
 * @throws {Error} When one cannot load.
 */
export async function preloadWorkspaceParts(): Promise<void> {
  await Promise.all([
    STYLE_PANEL.load(),
    SELECTION_POPOVER.load(),
    loadDefaultStylePanelRegistry(),
  ]);
}

/**
 * Starts loading the workspace's lazy parts once the workspace has mounted: their code
 * stays out of the first script but is in hand before the first selection, and before a
 * connection that later drops could keep it away. A failed load here is not reported: a part's
 * own load on first use tries again, and reports.
 */
export function usePreloadedWorkspaceParts(): void {
  useEffect(() => {
    preloadWorkspaceParts().catch(() => undefined);
  }, []);
}

/**
 * The inspector's style panel (`StylePanel`), whose code and sections' controls load apart from
 * the page's first script: nothing shows until they arrive.
 *
 * @param props - The panel's props.
 * @returns The panel, once loaded.
 */
export function LazyStylePanel(props: StylePanelProps): ReactElement | null {
  const panel = useLazyPart(STYLE_PANEL);
  return panel === undefined ? null : createElement(panel, props);
}

/**
 * The selection popover's code, loading on first use: rendered only where it belongs.
 *
 * @param props - The popover's props.
 * @returns The popover once loaded.
 */
function LoadedSelectionPopover(props: SelectionPopoverProps): ReactElement | null {
  const popover = useLazyPart(SELECTION_POPOVER);
  // A mod+/ pressed while the code loads still asks for focus: the popover counts the
  // requests it is first given as old ones, so it is first given the count from before the load.
  const requestsBeforeLoad = useRef(props.focusRequests);
  const [isLoadedOnce, setIsLoadedOnce] = useState(false);
  useEffect(() => {
    if (popover !== undefined) setIsLoadedOnce(true);
  }, [popover]);
  if (popover === undefined) return null;
  return createElement(
    popover,
    isLoadedOnce ? props : { ...props, focusRequests: requestsBeforeLoad.current },
  );
}

/**
 * The selection popover where it belongs, as `WhiteboardSelectionPopover`: on a
 * whiteboard under the floating chrome only, nothing elsewhere. Its code loads apart from the
 * page's first script, the first time it belongs.
 *
 * @param props - The popover's props.
 * @returns The popover once loaded, or nothing.
 */
export function LazySelectionPopover(props: SelectionPopoverProps): ReactElement | null {
  const chrome = useWhiteboardChrome();
  const mode = useContext(shellBoardModeContext)?.mode;
  if (chrome !== 'floating' || mode !== 'whiteboard') return null;
  return <LoadedSelectionPopover {...props} />;
}

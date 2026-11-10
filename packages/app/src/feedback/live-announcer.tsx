import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import styles from './live-announcer.module.css';

/**
 * How long after a region is cleared the message goes in, ms: long enough that a screen reader
 * sees the change, so the same message said twice is read twice.
 */
export const ANNOUNCE_DELAY_MS = 50;

/** Says a message in the page's live region. */
type Announce = (message: string) => void;

const LiveAnnouncerContext = createContext<Announce | undefined>(undefined);

/**
 * The announcer outside any {@link LiveAnnouncerBoundary}: says nothing.
 */
function silent(): void {
  // Nothing to say it in.
}

/**
 * What says a message to a screen reader through the page's one polite live region, for what
 * happens on the board without the person's doing: a vote revealed, someone's reaction.
 * Nothing outside a {@link LiveAnnouncerBoundary}.
 *
 * @returns The announcer.
 */
export function useAnnounce(): Announce {
  return useContext(LiveAnnouncerContext) ?? silent;
}

/** Props of {@link LiveAnnouncerBoundary}. */
export interface LiveAnnouncerBoundaryProps {
  /** What may announce. */
  readonly children?: ReactNode;
}

/**
 * The page's polite live region, `role="status"` and atomic, out of sight: what its
 * children give {@link useAnnounce} is read by a screen reader. Each message clears the region
 * at once and goes in {@link ANNOUNCE_DELAY_MS} later, so a repeat is heard too. Inside another
 * boundary it adds no region of its own, so a page has exactly one.
 *
 * @param props - Its children.
 * @returns The children and, for the outermost boundary, the region.
 */
export function LiveAnnouncerBoundary(props: LiveAnnouncerBoundaryProps): ReactElement {
  const outer = useContext(LiveAnnouncerContext);
  if (outer !== undefined) return <>{props.children}</>;
  return <LiveAnnouncerRegion>{props.children}</LiveAnnouncerRegion>;
}

/**
 * The region and its announcer.
 *
 * @param props - Its children.
 * @returns The children and the region.
 */
function LiveAnnouncerRegion(props: LiveAnnouncerBoundaryProps): ReactElement {
  const region = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const announce = useCallback((message: string) => {
    const element = region.current;
    if (element === null) return;
    clearTimeout(timer.current);
    // The region's text is written here only; React renders it empty and never reconciles it.
    element.textContent = '';
    timer.current = setTimeout(() => {
      element.textContent = message;
    }, ANNOUNCE_DELAY_MS);
  }, []);
  return (
    <LiveAnnouncerContext.Provider value={announce}>
      {props.children}
      <div
        ref={region}
        className={styles.region}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-live-announcer=""
      />
    </LiveAnnouncerContext.Provider>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * What can take the right-hand drawer slot: the inspector, the comments panel
 * or the history panel. One at a time.
 */
export type DrawerOccupant = 'inspector' | 'comments' | 'history';

/** The right-hand drawer slot: who has it, and how to take it or give it back. */
export interface DrawerSlot {
  /**
   * What last took the slot and still has it; undefined when nothing has, when the inspector
   * shows if the selection asks for it.
   */
  readonly occupant: DrawerOccupant | undefined;
  /** Takes the slot, putting away whatever had it. */
  readonly claim: (occupant: DrawerOccupant) => void;
  /** Gives the slot back, if this occupant has it; nothing otherwise. */
  readonly release: (occupant: DrawerOccupant) => void;
}

/** The slot a page shares between the shell and its own panels; none outside a provider. */
const drawerSlotContext = createContext<DrawerSlot | undefined>(undefined);

/**
 * A drawer slot held in this component's state.
 *
 * @returns The slot.
 */
function useDrawerSlotState(): DrawerSlot {
  const [occupant, setOccupant] = useState<DrawerOccupant>();
  const claim = useCallback((next: DrawerOccupant) => {
    setOccupant(next);
  }, []);
  const release = useCallback((current: DrawerOccupant) => {
    setOccupant((held) => (held === current ? undefined : held));
  }, []);
  return useMemo(() => ({ occupant, claim, release }), [occupant, claim, release]);
}

/**
 * The right-hand drawer slot of the provider around this component, so the shell's
 * inspector, the comments panel and the board page's history panel take it one at a time; a
 * slot of the component's own outside a provider (the standalone shell, a panel in a test).
 *
 * @returns The slot.
 */
export function useDrawerSlot(): DrawerSlot {
  const shared = useContext(drawerSlotContext);
  const own = useDrawerSlotState();
  return shared ?? own;
}

/**
 * Shares one right-hand drawer slot among everything inside it: the board page puts
 * it around its comments, its shell and its history panel, so opening one closes the others.
 *
 * @param props - What shares the slot.
 * @param props.children - The subtree.
 * @returns The provider.
 */
export function DrawerSlotProvider(props: { readonly children: ReactNode }): ReactElement {
  const slot = useDrawerSlotState();
  return <drawerSlotContext.Provider value={slot}>{props.children}</drawerSlotContext.Provider>;
}

import { createElement, useEffect, useRef, type ReactElement } from 'react';

import { FloatingSheet } from '../../controls/floating-sheet.js';
import type { ShortcutRegistry } from '../../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../../state/shell-action.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../bottom-chrome.js';
import { ROVING_ITEM_ATTRIBUTE, useRovingFocus } from '../use-roving-focus.js';

import type { AnyToolPanel } from './tool-panel-contribution.js';
import styles from './tool-panel-host.module.css';

/** The attribute the selection popover keeps clear of (`POPOVER_AVOID_ATTRIBUTE`). */
export const POPOVER_AVOID = 'data-popover-avoid';

/** Props of {@link ToolPanelHost}. */
export interface ToolPanelHostProps {
  /** The open panel. */
  readonly panel: AnyToolPanel;
  /** Its choices. */
  readonly choices: unknown;
  /** Changes them. */
  readonly onChange: (choices: unknown) => void;
  /** The shell's shortcuts. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /** Escape pressed inside the panel: it closes, and the dock takes focus back. */
  readonly onEscape: () => void;
  /**
   * Whether it takes focus when it shows, on its roving tab stop: opened from its dock button by
   * Enter or Space. False if absent.
   */
  readonly shouldTakeFocus?: boolean | undefined;
  /** It took focus. */
  readonly onFocused?: (() => void) | undefined;
  /**
   * Whether it is a bottom sheet over the compact bar below 768 px wide: 16 px in
   * from the sides, 8 px above the bar, its items 48 px touch targets. False if absent.
   */
  readonly isSheet?: boolean | undefined;
}

/**
 * The open tool panel: a one-row floating sheet (`FloatingSheet`, 44 px) centred on the
 * floating dock and 8 px above it, after the dock in the focus order so Tab reaches it, its items
 * one tab stop with the arrow keys moving among them (`useRovingFocus`, items marked
 * `data-dock-item`), Escape closing it and handing focus back to the dock. The selection popover keeps clear of it
 * (`data-popover-avoid`).
 *
 * @param props - The panel, its choices and the shell's shortcuts and dispatch.
 * @returns The panel.
 */
export function ToolPanelHost(props: ToolPanelHostProps): ReactElement {
  const { panel, choices, onChange, registry, dispatch, onEscape, shouldTakeFocus, onFocused } =
    props;
  const itemsRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(itemsRef);
  // After the roving stop is set (a layout effect), the keyboard's panel takes focus on it.
  useEffect(() => {
    if (shouldTakeFocus !== true) return;
    const stop = itemsRef.current?.querySelector<HTMLElement>(
      `[${ROVING_ITEM_ATTRIBUTE}][tabindex="0"]`,
    );
    stop?.focus();
    onFocused?.();
  }, [shouldTakeFocus, onFocused]);
  return (
    <FloatingSheet
      shape="toolbar"
      role="toolbar"
      label={`${panel.label} options`}
      className={styles.panel}
      dataAttributes={{
        'data-tool-panel': panel.id,
        [POPOVER_AVOID]: '',
        ...(props.isSheet === true ? { 'data-sheet': '', [BOTTOM_CHROME_ATTRIBUTE]: '' } : {}),
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onEscape();
      }}
    >
      <div
        ref={itemsRef}
        className={styles.items}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {createElement(panel.contents, { choices, onChange, registry, dispatch })}
      </div>
    </FloatingSheet>
  );
}

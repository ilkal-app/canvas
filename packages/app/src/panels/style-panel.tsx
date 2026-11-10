import { useId, type ReactElement } from 'react';

import type { BoardReader } from '@canvas/document';
import { effectiveColorMode, type BoardObject, type ColorMode } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { BoardViewSnapshot } from '../hooks/use-board-view-state.js';
import { Icon } from '../icons/icon.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ToolStyles } from '../state/tool-style.js';
import { actionHint } from '../toolbar/action-hints.js';

import { ConnectorPreference } from './connector-preference.js';
import { ColourTokensProvider, useColourTokens } from './controls/colour-tokens-context.js';
import { isSelectionLocked } from './inspector-header.js';
import {
  sectionsShown,
  type SelectionContext,
  type StylePanelRegistry,
  type StylePanelSection,
  type StylePanelSectionProps,
} from './panel-sections.js';
import {
  isSectionCollapsed,
  SESSION_SECTION_COLLAPSE,
  useSectionCollapse,
  type SectionCollapseStore,
} from './section-collapse.js';
import { patchFor, styleChangesFor, type StyleToApply } from './style-changes.js';
import styles from './style-panel.module.css';

/** Props of {@link StylePanel}. */
export interface StylePanelProps {
  /** The sections that can show. */
  readonly registry: StylePanelRegistry;
  /** The context to show (`panelContextOf` of the selection and the active tool). */
  readonly context: SelectionContext;
  /** The board and the selection. */
  readonly board: BoardViewSnapshot;
  /** The selected objects as stored, primary first. */
  readonly selection: readonly BoardObject[];
  /** The active tool, whose style the panel edits when nothing is selected. */
  readonly activeTool: ToolId;
  /**
   * Each creation tool's style: its registered defaults with the person's choices over them
   * (`resolveToolStyles`).
   */
  readonly toolStyles: ToolStyles;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * The person's "delete connectors with their objects" preference, shown with nothing
   * selected (`ConnectorPreference`); off if absent.
   */
  readonly shouldDeleteConnectors?: boolean;
  /**
   * The shell's shortcuts, whose chords the arrange buttons and the locked banner show; the
   * default keymap for other platforms if absent.
   */
  readonly shortcuts?: ShortcutRegistry<ShellAction>;
  /**
   * Where the person's collapse choices are kept; the page's session store if absent.
   */
  readonly collapse?: SectionCollapseStore;
  /**
   * Whether the person may edit the board: when not, every section shows read-only
   * (a section with its own lock state keeps what only looks, ruling 8). True if absent.
   */
  readonly canEdit?: boolean;
}

/** The shortcuts a panel given none shows: the default keymap's, written for other platforms. */
let fallbackShortcuts: ShortcutRegistry<ShellAction> | undefined;

/**
 * The default keymap for other platforms, built once.
 *
 * @returns The registry.
 */
function defaultShortcuts(): ShortcutRegistry<ShellAction> {
  fallbackShortcuts ??= createDefaultShortcutRegistry('other');
  return fallbackShortcuts;
}

/**
 * The panel's `applyStyle`: the fields on the selected objects that take them, as one style
 * canvas action; with nothing selected, on the active creation tool's style.
 *
 * @param props - The panel's props.
 * @returns The function sections call.
 */
function styleApplier(props: StylePanelProps): (style: StyleToApply, isInkPick?: boolean) => void {
  const { selection, activeTool, dispatch } = props;
  return (style, isInkPick) => {
    if (selection.length === 0) {
      const patch = patchFor(style, undefined);
      // An Ink pick counts even when the style already holds `ink` (the tool's default).
      if (Object.keys(patch).length > 0 || isInkPick !== undefined) {
        const pick = isInkPick === undefined ? {} : { isInkPick };
        dispatch({ type: 'setToolStyle', tool: activeTool, style: patch, ...pick });
      }
      return;
    }
    const changes = styleChangesFor(selection, style);
    if (changes.length > 0) dispatch({ type: 'style', changes });
  };
}

/**
 * The colour mode the panel's colour controls show tokens in: the primary selected
 * object's effective mode over the whole board (`effectiveColorMode`), or the viewer's theme
 * with nothing selected.
 *
 * @param selection - The selected objects, primary first.
 * @param board - The whole board.
 * @param theme - The viewer's theme.
 * @returns The mode.
 */
function selectionColourMode(
  selection: readonly BoardObject[],
  board: BoardReader,
  theme: ColorMode,
): ColorMode {
  const [primary] = selection;
  if (primary === undefined) return theme;
  return effectiveColorMode(primary, { objects: { get: (id) => board.get(id) } }, theme);
}

/** Props of {@link PanelSection}. */
interface PanelSectionProps {
  /** The section. */
  readonly section: StylePanelSection;
  /** What every section is given. */
  readonly sectionProps: StylePanelSectionProps;
  /** The panel's id, the stem of the section's ids. */
  readonly panelId: string;
  /** Where the person's collapse choices are kept. */
  readonly collapse: SectionCollapseStore;
}

/**
 * One section of the panel: a titled region whose header collapses and expands it,
 * the choice remembered for the context for the session; collapsed, the header shows the
 * section's summary. For a locked selection, or a person who cannot edit, the section's controls
 * are disabled, unless the section disables its own (`hasOwnLockState`).
 *
 * @param props - The section, its props, the panel's id and the collapse store.
 * @returns The region.
 */
function PanelSection(props: PanelSectionProps): ReactElement {
  const { section, sectionProps, panelId, collapse } = props;
  const { context, isLocked, canEdit = true } = sectionProps;
  const titleId = `${panelId}-${section.id}`;
  const bodyId = `${titleId}-body`;
  const isCollapsed = isSectionCollapsed(
    collapse.choiceFor(context, section.id),
    section.isCollapsedByDefault?.(sectionProps) ?? false,
  );
  const summary = isCollapsed ? section.summary?.(sectionProps) : undefined;
  const isDisabled = (isLocked || !canEdit) && section.hasOwnLockState !== true;
  return (
    <section
      className={styles.section}
      aria-labelledby={titleId}
      data-section={section.id}
      data-collapsed={isCollapsed ? '' : undefined}
      data-locked={isLocked ? '' : undefined}
    >
      <h3 className={styles.sectionHeading}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={!isCollapsed}
          aria-controls={isCollapsed ? undefined : bodyId}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            collapse.choose(context, section.id, !isCollapsed);
          }}
        >
          <span id={titleId} className={styles.sectionTitle}>
            {section.titleFor?.(sectionProps) ?? section.title}
          </span>
          {summary === undefined ? null : <span className={styles.summary}>{summary}</span>}
          <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} />
        </button>
      </h3>
      {!isCollapsed && (
        <fieldset id={bodyId} className={styles.body} disabled={isDisabled}>
          <section.render {...sectionProps} />
        </fieldset>
      )}
    </section>
  );
}

/**
 * The inspector's contents: the registered sections for the selection's context
 * (`selectionContextOf`) in their order, each collapsible, or, with nothing selected and a creation
 * tool active, that tool's context over its style; with nothing selected and no tool, a hint and
 * the person's connector delete preference. For a locked selection a banner says how to unlock it
 * and every section is disabled; the objects stay selectable. The drawer's header says what is
 * selected (`selectionSummary`, `InspectorHeaderActions`). Its colour controls show the board's
 * colour tokens from the nearest `ColourTokensProvider`, in the primary selected object's
 * effective colour mode.
 *
 * @param props - The sections, context, board, selection, tool, dispatch and shortcuts.
 * @returns The panel.
 */
export function StylePanel(props: StylePanelProps): ReactElement {
  const { registry, context, board, selection, activeTool, toolStyles, dispatch } = props;
  const headingId = useId();
  const collapse = props.collapse ?? SESSION_SECTION_COLLAPSE;
  useSectionCollapse(collapse);
  const shortcuts = props.shortcuts ?? defaultShortcuts();
  const isLocked = isSelectionLocked(selection);
  const sections = sectionsShown(registry, context, selection.length > 0, selection);
  const tokens = useColourTokens();
  const definitions = board.definitions ?? board.board;
  const colourTokens = {
    table: tokens.table,
    mode: selectionColourMode(selection, definitions, tokens.mode),
  };
  const sectionProps: StylePanelSectionProps = {
    context,
    selection,
    board: board.board,
    definitions,
    ...(board.watchDefinitions && { watchDefinitions: board.watchDefinitions }),
    canEdit: props.canEdit ?? true,
    defaults:
      selection.length === 0 && context !== 'none' ? (toolStyles[activeTool] ?? {}) : undefined,
    activeTool,
    isLocked,
    shortcuts,
    dispatch,
    applyStyle: styleApplier(props),
  };
  const lockHint = actionHint(shortcuts, { type: 'selection', command: 'toggleLock' });
  return (
    <aside
      className={styles.panel}
      aria-labelledby={headingId}
      // Out of the Tab order: Firefox makes a scroll container a Tab stop, Chrome skips one that
      // holds controls; keyboard users scroll it by moving through its controls.
      tabIndex={-1}
      data-context={context}
      data-locked={isLocked ? '' : undefined}
    >
      <h2 id={headingId} className={styles.heading}>
        Style
      </h2>
      {isLocked && (
        <p className={styles.banner} role="status">
          <Icon name="lock" />
          <span>
            Locked — unlock to edit
            {lockHint === undefined ? null : ` · ${lockHint.label}`}
          </span>
        </p>
      )}
      {(sections.length === 0 || context === 'none') && (
        <p className={styles.empty}>
          {context === 'none'
            ? 'Select an object to change its style.'
            : 'Nothing to style in this selection.'}
        </p>
      )}
      {context === 'none' && (
        <ConnectorPreference isOn={props.shouldDeleteConnectors ?? false} dispatch={dispatch} />
      )}
      <ColourTokensProvider value={colourTokens}>
        {sections.map((section) => (
          <PanelSection
            key={section.id}
            section={section}
            sectionProps={sectionProps}
            panelId={headingId}
            collapse={collapse}
          />
        ))}
      </ColourTokensProvider>
    </aside>
  );
}

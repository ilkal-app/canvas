import type { ReactNode } from 'react';

import type { BoardReader, ChangeSet, StylePatch } from '@canvas/document';
import type { BoardObject, ObjectId, ObjectType } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import type { StyleToApply } from './style-changes.js';

/**
 * What the style panel is showing controls for (a contextual style panel), in this order: nothing,
 * one kind of object, or a mix.
 */
export const SELECTION_CONTEXTS = [
  'none',
  'text',
  'note',
  'vector',
  'shape',
  'line',
  'image',
  'frame',
  'group',
  'component',
  'instance',
  'mixed',
] as const;

/**
 * One of {@link SELECTION_CONTEXTS}. `none`: nothing selected. `group`: groups only, which have
 * no style of their own but a layout and the arrange row. `component` and `instance`:
 * component mains only, or instances only, each with a section of their own. `mixed`: objects of several
 * contexts, or objects with no context of their own (videos, comments), for which only sections
 * shown in every context (the arrange row) apply.
 */
export type SelectionContext = (typeof SELECTION_CONTEXTS)[number];

/** The style context of each object type, or undefined for a type that has none. */
const CONTEXT_OF_TYPE: Readonly<Record<ObjectType, SelectionContext | undefined>> = {
  text: 'text',
  sticky: 'note',
  path: 'vector',
  // A stroke's options are the draw panel's and its popover's, not a section here.
  freehand: undefined,
  link: undefined,
  shape: 'shape',
  line: 'line',
  connector: 'line',
  image: 'image',
  video: undefined,
  group: 'group',
  frame: 'frame',
  comment: undefined,
  component: 'component',
  instance: 'instance',
};

/**
 * The context of the objects a creation tool makes: while it is active and nothing is selected,
 * the panel shows that context's sections over the tool's style (`ShellState.toolStyles`). A
 * tool id added to `TOOL_IDS` needs an entry here, which the `Record` type enforces.
 */
export const TOOL_CONTEXTS: Readonly<Record<ToolId, SelectionContext>> = {
  select: 'none',
  hand: 'none',
  text: 'text',
  sticky: 'note',
  pen: 'vector',
  // The draw tool's options are its panel's and popover's, not a section here.
  draw: 'none',
  shape: 'shape',
  line: 'line',
  connector: 'line',
  image: 'image',
  frame: 'none',
};

/**
 * The style context of a selection: `none` when nothing selected can be read, the context
 * every selected object shares, or `mixed`. O(selection size).
 *
 * @param selection - The selected ids.
 * @param board - The document, to read their types.
 * @returns The context.
 */
export function selectionContextOf(
  selection: readonly ObjectId[],
  board: Pick<BoardReader, 'get'>,
): SelectionContext {
  let context: SelectionContext = 'none';
  for (const id of selection) {
    const object = board.get(id);
    if (object === undefined) continue;
    const own = CONTEXT_OF_TYPE[object.type] ?? 'mixed';
    if (context !== 'none' && context !== own) return 'mixed';
    context = own;
  }
  return context;
}

/**
 * What the panel shows: the selection's context, or, with nothing selected, the context of the
 * active creation tool (whose style the panel then edits).
 *
 * @param selectionContext - The selection's context (`selectionContextOf`).
 * @param activeTool - The active tool.
 * @returns The context to show.
 */
export function panelContextOf(
  selectionContext: SelectionContext,
  activeTool: ToolId,
): SelectionContext {
  return selectionContext === 'none' ? TOOL_CONTEXTS[activeTool] : selectionContext;
}

/** What a style panel section is given each time the panel renders. */
export interface StylePanelSectionProps {
  /** The context the panel shows. */
  readonly context: SelectionContext;
  /** The selected objects as the document holds them, primary first; empty for defaults. */
  readonly selection: readonly BoardObject[];
  /** The document, for sections that read other objects (a label's host, a group's children). */
  readonly board: BoardReader;
  /**
   * The whole board across pages, where `board` shows one page: an instance's main and its
   * content may be on another page. `board` when absent.
   */
  readonly definitions?: BoardReader;
  /**
   * Listens for every change set of the whole board (`BoardView.subscribeDefinitions`), which
   * the panel's own feed leaves out when it changes another page: a section that reads
   * `definitions` follows what it reads with it. Absent where nothing can be followed.
   */
  readonly watchDefinitions?: (listener: (changes: ChangeSet) => void) => () => void;
  /**
   * Whether the person may edit the board: a section that disables its own controls
   * (`hasOwnLockState`) disables its editing ones when not, and keeps those that only look
   * (going to a main). True when absent.
   */
  readonly canEdit?: boolean;
  /**
   * With nothing selected and a creation tool active, the style that tool gives new objects
   * (what the person set so far; fields not set are the tool's own defaults); else undefined.
   */
  readonly defaults: StylePatch | undefined;
  /**
   * The active tool, whose style `defaults` is with nothing selected (the line section offers a
   * curved route for the connector tool's); the select tool if absent.
   */
  readonly activeTool?: ToolId;
  /**
   * Whether every selected object is locked: the panel then disables every section,
   * and the arrange row says why its buttons do nothing. False with nothing selected.
   */
  readonly isLocked: boolean;
  /** The shell's shortcuts, whose chords the arrange row's tooltips and names show. */
  readonly shortcuts: ShortcutRegistry<ShellAction>;
  /** Dispatches a shell action (the arrange row's `ArrangeCommand`s, a notice). */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Sets style fields: on the selected objects that take them, as one `setStyle` command and so
   * one undo step; or, with nothing selected, on the active creation tool's style. Only the
   * given fields change, so a value chosen in a mixed state sets that field alone. A function
   * gives each object its own patch (a stroke colour keeping each object's width); it is called
   * with undefined for the tool's style. `isInkPick` says, for the colour the tool creates with
   * (a stroke's, the text tool's text's), whether this choice is the Ink swatch (true) or a
   * fixed colour or none (false); it only matters to a tool's style (`ShellState.pickedInk`).
   */
  readonly applyStyle: (style: StyleToApply, isInkPick?: boolean) => void;
}

/**
 * One section of the contextual style panel: a titled group of
 * controls for one or more contexts. The task that owns an object type registers its section
 * (text, note, vector, image, shape, line) by adding a file `panels/sections/<name>-section.tsx`
 * that exports it as `stylePanelSection`; the shell finds it (`DEFAULT_STYLE_PANEL_SECTIONS`) and
 * no list is edited.
 */
export interface StylePanelSection {
  /** Unique id, kebab-case (`text-style`); also the section element's `data-section`. */
  readonly id: string;
  /** The section's heading. */
  readonly title: string;
  /**
   * The heading for what the panel shows, when it depends on it ("Stroke" for
   * frames, which have no Fill there); {@link StylePanelSection.title} if absent.
   */
  readonly titleFor?: (props: StylePanelSectionProps) => string;
  /** The context or contexts it shows in. */
  readonly context: SelectionContext | readonly SelectionContext[];
  /** Where it sits among the context's sections, lowest first; ties by id. */
  readonly order: number;
  /**
   * Whether it shows only for a selection, never for a creation tool's style (the arrange
   * row); false if absent.
   */
  readonly isSelectionOnly?: boolean;
  /**
   * Whether the section starts collapsed for what the panel shows (the note's layout,
   * a shape's text until it has a label); expanded if absent. The person's own choice, once
   * made, wins for that context for the rest of the session (`SectionCollapseStore`).
   */
  readonly isCollapsedByDefault?: (props: StylePanelSectionProps) => boolean;
  /**
   * What the section's header says while it is collapsed (the layout's "176 × 120 at 412,
   * 268"); nothing if absent or undefined.
   */
  readonly summary?: (props: StylePanelSectionProps) => string | undefined;
  /**
   * Whether the section disables its own controls for a locked selection (`isLocked`), as the
   * arrange row does so its buttons keep their tooltips; the panel disables every other
   * section's controls itself. False if absent.
   */
  readonly hasOwnLockState?: boolean;
  /**
   * Whether the section shows for the selected objects, beyond its contexts (auto
   * layout in a `mixed` selection only when every object is a frame or a main); shown if absent.
   * Asked only for a selection, never for a creation tool's style.
   */
  readonly isShownFor?: (selection: readonly BoardObject[]) => boolean;
  /**
   * Renders the controls. The panel mounts it as a component (`<Render {...props} />`), so it
   * may use hooks; controls should come from `panels/controls/` so mixed values look the same
   * everywhere, and a press should not take focus from the text editor.
   */
  readonly render: (props: StylePanelSectionProps) => ReactNode;
}

/** An immutable set of style panel sections, sorted by `order`, then `id`. */
export interface StylePanelRegistry {
  /** The sections. */
  readonly sections: readonly StylePanelSection[];
}

/**
 * An empty registry.
 *
 * @returns The registry.
 */
export function createStylePanelRegistry(): StylePanelRegistry {
  return { sections: [] };
}

/**
 * Adds a section to a registry, returning a new registry; the input is never changed.
 *
 * @param registry - The registry.
 * @param section - The section.
 * @returns The registry with the section in its place.
 * @throws {Error} When a section with the same id is already registered.
 */
export function registerStylePanelSection(
  registry: StylePanelRegistry,
  section: StylePanelSection,
): StylePanelRegistry {
  if (registry.sections.some((existing) => existing.id === section.id)) {
    throw new Error(`A style panel section "${section.id}" is already registered.`);
  }
  const sections = [...registry.sections, section].sort(
    (first, second) => first.order - second.order || first.id.localeCompare(second.id),
  );
  return { sections };
}

/**
 * Whether a section shows in a context.
 *
 * @param section - The section.
 * @param context - The context.
 * @returns True when the section lists the context.
 */
export function showsInContext(section: StylePanelSection, context: SelectionContext): boolean {
  return typeof section.context === 'string'
    ? section.context === context
    : section.context.includes(context);
}

/**
 * The sections to show for a context, in order.
 *
 * @param registry - The registry.
 * @param context - The context.
 * @returns The sections.
 */
export function sectionsForContext(
  registry: StylePanelRegistry,
  context: SelectionContext,
): StylePanelSection[] {
  return registry.sections.filter((section) => showsInContext(section, context));
}

/**
 * The sections the panel shows: those of the context, without the selection-only ones while
 * the panel edits a creation tool's style, and, for a selection, without the ones that do not
 * show for those objects (`isShownFor`).
 *
 * @param registry - The registry.
 * @param context - The context.
 * @param hasSelection - Whether anything is selected.
 * @param selection - The selected objects, for the sections that show only for some
 *   (`isShownFor`); empty when absent.
 * @returns The sections, in order.
 */
export function sectionsShown(
  registry: StylePanelRegistry,
  context: SelectionContext,
  hasSelection: boolean,
  selection: readonly BoardObject[] = [],
): StylePanelSection[] {
  return sectionsForContext(registry, context).filter((section) =>
    hasSelection
      ? section.isShownFor === undefined || section.isShownFor(selection)
      : section.isSelectionOnly !== true,
  );
}

/**
 * Tells whether a value has the shape of a {@link StylePanelSection}, for the section files
 * the shell collects.
 *
 * @param value - An export of a section file.
 * @returns True when it has an id, title, context, order and render function.
 */
export function isStylePanelSection(value: unknown): value is StylePanelSection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof StylePanelSection, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (typeof candidate.context === 'string' || Array.isArray(candidate.context)) &&
    typeof candidate.order === 'number' &&
    typeof candidate.render === 'function'
  );
}

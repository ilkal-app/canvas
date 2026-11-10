import type { BoardObject, ObjectId, ObjectType } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import { TOOL_LABELS } from '../state/tool-labels.js';
import { SHAPE_KIND_LABELS } from '../state/tool-variants.js';

/** What the inspector's header says it is showing (Figma "Inspector by selection"). */
export interface SelectionSummary {
  /** The header's title: the object's name, a count, a tool's or "Style". */
  readonly title: string;
  /** The quieter caption under it: a count, a name, "Locked", or whose style it is. */
  readonly detail?: string;
}

/** Each object type's name, one and many, as the header says it, and its short name in a list. */
const TYPE_NAMES: Readonly<Record<ObjectType, readonly [string, string, string]>> = {
  text: ['Text', 'texts', 'text'],
  sticky: ['Sticky note', 'sticky notes', 'note'],
  image: ['Image', 'images', 'image'],
  video: ['Video', 'videos', 'video'],
  shape: ['Shape', 'shapes', 'shape'],
  line: ['Line', 'lines', 'line'],
  connector: ['Connector', 'connectors', 'connector'],
  path: ['Pen path', 'pen paths', 'path'],
  freehand: ['Drawing', 'drawings', 'drawing'],
  link: ['Link', 'links', 'link'],
  group: ['Group', 'groups', 'group'],
  frame: ['Frame', 'frames', 'frame'],
  comment: ['Comment', 'comments', 'comment'],
  component: ['Component', 'components', 'component'],
  instance: ['Instance', 'instances', 'instance'],
};

/** Each creation tool's name in the header, and what it makes (Figma: "Note tool", "the next note"). */
const TOOL_NOUNS: Readonly<Partial<Record<ToolId, readonly [string, string]>>> = {
  text: ['Text', 'text'],
  sticky: ['Note', 'note'],
  pen: ['Pen', 'path'],
  shape: ['Shape', 'shape'],
  line: ['Line', 'line'],
  connector: ['Connector', 'connector'],
  image: ['Image', 'image'],
};

/** What the header reads of the board: a group's children, for its count. */
export interface SummaryReader {
  /** The parent index; a group's caption says "Group" without it. */
  readonly references?: {
    /**
     * The ids of an object's children.
     *
     * @param id - The parent.
     * @returns The children's ids.
     */
    childrenOf(id: ObjectId): { readonly size: number };
  };
}

/**
 * A count of objects in words: "1 object", "4 objects".
 *
 * @param count - How many.
 * @returns The words.
 */
function objectCount(count: number): string {
  return count === 1 ? '1 object' : `${String(count)} objects`;
}

/**
 * One object's name in the header: its shape's kind for a shape ("Rectangle", "Star"), else
 * its type's.
 *
 * @param object - The object.
 * @returns The name.
 */
function nameOf(object: BoardObject): string {
  return object.type === 'shape' ? SHAPE_KIND_LABELS[object.kind] : TYPE_NAMES[object.type][0];
}

/**
 * One object's caption: "Locked" while it is locked, a frame's or a main's name, a group's count of
 * objects, else "1 object".
 *
 * @param object - The object.
 * @param board - The board, for a group's children.
 * @returns The caption.
 */
function captionOf(object: BoardObject, board: SummaryReader | undefined): string {
  if (object.locked) return 'Locked';
  if ((object.type === 'frame' || object.type === 'component') && object.name !== '') {
    return object.name;
  }
  const children = object.type === 'group' ? board?.references?.childrenOf(object.id) : undefined;
  return children === undefined ? objectCount(1) : objectCount(children.size);
}

/**
 * The kinds of a selection of several types, as the caption lists them: "Note, shape,
 * connector", in the order they first come.
 *
 * @param types - The types.
 * @returns The list.
 */
function kindsOf(types: readonly ObjectType[]): string {
  const kinds = [...new Set(types.map((type) => TYPE_NAMES[type][2]))].join(', ');
  return kinds.charAt(0).toUpperCase() + kinds.slice(1);
}

/**
 * The inspector header's words for what it shows (Figma "Inspector by selection"): one
 * object's name ("Rectangle", "Sticky note") over "1 object", its frame's name, its group's
 * count or "Locked"; several of one type counted by type ("3 sticky notes") over "Same kind";
 * several types counted as objects over their kinds ("3 objects", "Note, shape, connector");
 * with nothing selected, the creation tool whose style new objects take ("Note tool", "Style
 * of the next note"), else "Style" over "Nothing selected". Pure.
 *
 * @param selection - The selected objects, primary first.
 * @param activeTool - The active tool.
 * @param isToolStyle - Whether, with nothing selected, the panel edits the tool's style.
 * @param board - The board, for a group's count of objects; a group says "1 object" without it.
 * @returns The title and the caption.
 */
export function selectionSummary(
  selection: readonly BoardObject[],
  activeTool: ToolId,
  isToolStyle: boolean,
  board?: SummaryReader,
): SelectionSummary {
  const [first] = selection;
  if (first === undefined) {
    if (!isToolStyle) return { title: 'Style', detail: 'Nothing selected' };
    const [tool, noun] = TOOL_NOUNS[activeTool] ?? [TOOL_LABELS[activeTool], 'object'];
    return { title: `${tool} tool`, detail: `Style of the next ${noun}` };
  }
  if (selection.length === 1) return { title: nameOf(first), detail: captionOf(first, board) };
  const types = selection.map((object) => object.type);
  const count = String(selection.length);
  const isLocked = selection.every((object) => object.locked);
  if (types.every((type) => type === first.type)) {
    return {
      title: `${count} ${TYPE_NAMES[first.type][1]}`,
      detail: isLocked ? 'Locked' : 'Same kind',
    };
  }
  return { title: `${count} objects`, detail: isLocked ? 'Locked' : kindsOf(types) };
}

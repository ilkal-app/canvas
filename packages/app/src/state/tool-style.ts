import type { StylePatch } from '@canvas/document';
import { TOOL_IDS, type ToolId } from '@canvas/tools';

/**
 * A creation tool's own default style, as the task that owns the tool registers it: a file
 * `tool-styles/<tool>-style.ts` exporting it as `toolStyleDefaults` (the shape tool's fill
 * and stroke, the sticky tool's colour). The style panel shows it while the tool is active and
 * nothing is selected.
 */
export interface ToolStyleDefaults {
  /** The creation tool. */
  readonly tool: ToolId;
  /** The style it gives new objects before the person changes any of it. */
  readonly style: StylePatch;
}

/**
 * A creation tool's own choices that no object stores, kept with its style: the draw tool's
 * eraser sub-tool, which erases strokes rather than drawing one, and the frame tool's
 * name for new frames.
 */
export interface ToolOnlyStyle {
  /** The draw tool: whether the eraser is the sub-tool in use; drawing when absent. */
  readonly isEraser?: boolean;
  /**
   * The frame tool: the words new frames' names start with, "Section" on a floating whiteboard;
   * "Frame" when absent.
   */
  readonly framePrefix?: string;
}

/** A creation tool's style: the style fields its new objects take, and its own choices. */
export type ToolStyle = StylePatch & ToolOnlyStyle;

/** Each creation tool's style, by tool; a tool without an entry has none of its own. */
export type ToolStyles = Readonly<Partial<Record<ToolId, ToolStyle>>>;

/**
 * Merges style fields over a style: the given fields replace the others, text style fields one
 * by one. Neither input is changed.
 *
 * @param base - The style so far, if any.
 * @param style - The fields to set.
 * @returns A new style.
 */
export function mergeStyle(base: ToolStyle | undefined, style: ToolStyle): ToolStyle {
  const merged: ToolStyle = { ...base, ...style };
  if (base?.textStyle === undefined || style.textStyle === undefined) return merged;
  return { ...merged, textStyle: { ...base.textStyle, ...style.textStyle } };
}

/**
 * The style each creation tool gives new objects: its registered defaults with the person's
 * choices from the style panel (`ShellState.toolStyles`) over them.
 *
 * @param defaults - The tools' registered defaults (`DEFAULT_TOOL_STYLES`).
 * @param chosen - What the person chose per tool.
 * @returns Each tool's style; a tool with neither has none.
 */
export function resolveToolStyles(defaults: ToolStyles, chosen: ToolStyles): ToolStyles {
  const resolved: Partial<Record<ToolId, ToolStyle>> = {};
  for (const tool of TOOL_IDS) {
    const base = defaults[tool];
    const own = chosen[tool];
    if (own !== undefined) resolved[tool] = mergeStyle(base, own);
    else if (base !== undefined) resolved[tool] = base;
  }
  return resolved;
}

/**
 * Tells whether a value has the shape of {@link ToolStyleDefaults}, for the files the shell
 * collects.
 *
 * @param value - An export of a tool style file.
 * @returns True when it names a tool and gives a style object.
 */
export function isToolStyleDefaults(value: unknown): value is ToolStyleDefaults {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof ToolStyleDefaults, unknown>>;
  return (
    typeof candidate.tool === 'string' &&
    (TOOL_IDS as readonly string[]).includes(candidate.tool) &&
    typeof candidate.style === 'object' &&
    candidate.style !== null
  );
}

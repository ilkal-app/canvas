import { createObjectCommand, runCommand } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import { stackedStickyOf } from '@canvas/tools';

import type { DocumentCommandContext } from './engine-document-commands.js';

// The note below a note and its gap live in @canvas/tools, which the sticky tool's Shift+click
// stacks with too.
export { STACK_GAP, stackedStickyOf } from '@canvas/tools';

/**
 * Shift+N: with one sticky note selected, places the next note directly below it
 * (`stackedStickyOf`) as one undo step, selects it and starts editing its text; with anything
 * else selected, does nothing.
 *
 * @param context - The document, origin, environment and select tool.
 * @param zoom - The camera's zoom, for the select tool.
 * @returns True: the key is the document side's.
 */
export function stackSticky(context: DocumentCommandContext, zoom: number): boolean {
  const { controller } = context;
  const [id, ...more] = controller.selection.ids;
  const above = id === undefined || more.length > 0 ? undefined : context.store.get(id);
  if (above?.type !== 'sticky') return true;
  const object = stackedStickyOf(above);
  const outcome = runCommand(
    context.store,
    context.origin,
    createObjectCommand,
    { object },
    context.environment,
  );
  if (outcome.status !== 'applied') {
    context.onCommandRefused?.(outcome.errors);
    return true;
  }
  const created: ObjectId = outcome.result.id;
  controller.select([created]);
  controller.handle({ kind: 'enter' }, zoom);
  return true;
}

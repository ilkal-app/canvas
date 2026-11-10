import type { LinkLayout, ObjectId } from '@canvas/schema';

import { createRandomObjectId } from '../ids/random-object-id.js';
import { SYSTEM_ORIGIN, type TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentStore } from '../store/document-store.js';

import { LINK_CARD_SIZES } from './link-card-sizes.js';
import type { LinkUnfurlOutcome } from './link-card.js';
import { COMMANDS } from './registry.js';
import { runCommand, type CommandEnvironment } from './run-command.js';

/** A new link card, as {@link createLinkCard} takes it. */
export interface LinkCardInput {
  /** The page: an http or https URL. */
  readonly url: string;
  /** Where its top-left corner goes, board coordinates (the paste point). */
  readonly x: number;
  /** Where its top-left corner goes, board coordinates. */
  readonly y: number;
  /** Its layout; `vertical` when absent. */
  readonly layout?: LinkLayout;
  /** Names the one fetch whose result it takes (`applyLinkUnfurl`). */
  readonly unfurlKey: string;
}

/** The environment of a run outside a test: the clock and random ids. */
const LIVE_ENVIRONMENT: CommandEnvironment = { clock: Date.now, createId: createRandomObjectId };

/**
 * Creates a pending link card on the board's root: the pasted URL with an empty
 * preview, `pending` until its fetch is applied, in one undo step of `origin`.
 *
 * @param store - The board.
 * @param input - The URL, the paste point, the layout and the fetch's key.
 * @param origin - Who pastes it.
 * @param environment - The clock and ids; the live ones when absent.
 * @returns The new card's id.
 * @throws {RangeError} When the command refuses the card (a bad URL or key).
 */
export function createLinkCard(
  store: DocumentStore,
  input: LinkCardInput,
  origin: TransactionOrigin,
  environment: CommandEnvironment = LIVE_ENVIRONMENT,
): ObjectId {
  const layout = input.layout ?? 'vertical';
  const card = {
    type: 'link' as const,
    x: input.x,
    y: input.y,
    ...LINK_CARD_SIZES[layout],
    url: input.url,
    title: '',
    description: '',
    siteName: '',
    layout,
    status: 'pending' as const,
    unfurlKey: input.unfurlKey,
  };
  const outcome = runCommand(
    store,
    origin,
    COMMANDS.createObjects,
    { objects: [card], parentId: null },
    environment,
  );
  const [id] = outcome.status === 'applied' ? outcome.result.ids : [];
  if (id === undefined) {
    const reasons = outcome.status === 'rejected' ? outcome.errors : [];
    throw new RangeError(`createLinkCard: ${reasons.map((error) => error.message).join('; ')}`);
  }
  return id;
}

/**
 * Writes a fetched page's preview into a pending link card, once: only while the card
 * is pending and its key matches. The write carries the product's origin, `SYSTEM_ORIGIN`, so it
 * is no undo step of its own and undoing the paste removes the card with its preview. Only a
 * person's or an agent's client writes it (the paster's); an undo never does.
 *
 * @param store - The board.
 * @param id - The card.
 * @param update - The fetch's key and what it gave.
 * @param update.unfurlKey - The card's key, naming the fetch.
 * @param update.outcome - The preview, or failure.
 * @param requester - Who pasted the card and fetched its page.
 * @param environment - The clock and ids; the live ones when absent.
 * @returns Whether the card took the result.
 * @throws {RangeError} When the requester is an undo, or the id names no link card.
 */
export function applyLinkUnfurl(
  store: DocumentStore,
  id: ObjectId,
  update: { readonly unfurlKey: string; readonly outcome: LinkUnfurlOutcome },
  requester: TransactionOrigin,
  environment: CommandEnvironment = LIVE_ENVIRONMENT,
): boolean {
  if (requester.kind !== 'user' && requester.kind !== 'agent') {
    throw new RangeError(`applyLinkUnfurl: a ${requester.kind} origin writes no preview`);
  }
  const outcome = runCommand(
    store,
    SYSTEM_ORIGIN,
    COMMANDS.applyLinkUnfurl,
    { id, ...update },
    environment,
  );
  if (outcome.status === 'rejected') {
    throw new RangeError(`applyLinkUnfurl: ${outcome.errors.map((e) => e.message).join('; ')}`);
  }
  return outcome.result.isApplied;
}

/**
 * Sets link cards' layout, as one undo step of `origin`.
 *
 * @param store - The board.
 * @param ids - The cards.
 * @param layout - The image above the text, or beside it.
 * @param origin - Who switches it.
 * @param environment - The clock and ids; the live ones when absent.
 * @returns The cards whose layout changed.
 * @throws {RangeError} When an id names no link card.
 */
export function setLinkLayout(
  store: DocumentStore,
  ids: readonly ObjectId[],
  layout: LinkLayout,
  origin: TransactionOrigin,
  environment: CommandEnvironment = LIVE_ENVIRONMENT,
): readonly ObjectId[] {
  const outcome = runCommand(
    store,
    origin,
    COMMANDS.setLinkLayout,
    { ids: [...ids], layout },
    environment,
  );
  if (outcome.status === 'rejected') {
    throw new RangeError(`setLinkLayout: ${outcome.errors.map((e) => e.message).join('; ')}`);
  }
  return outcome.result.changed;
}

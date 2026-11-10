import { createContext } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import type { BoardMembers, Member, Person } from '../service/board-people.js';

import type { Thread, ThreadPin } from './comment-api.js';
import type { CommentPlacement } from './comment-placement.js';

/** Board comments and actions, shared without importing their provider. */
export interface CommentData {
  /** Live document. */
  readonly connection: BoardConnection;
  /** Current member. */
  readonly user: Person;
  /** Latest fetched threads. */
  readonly threads: readonly Thread[];
  /** Members offered for mentions. */
  readonly members: readonly Member[];
  /**
   * The board's members and agents as last read (sticky authors' names); undefined until
   * read, or when the person may not read them.
   */
  readonly boardMembers?: BoardMembers | undefined;
  /** Open thread id. */
  readonly selectedId: string | undefined;
  /** Pending first-message placement. */
  readonly placement: CommentPlacement | undefined;
  /** Recoverable message. */
  readonly error: string;
  /** A write is running. */
  readonly isBusy: boolean;
  /** Whether the person's role may edit the board, so delete any thread. */
  readonly canEditBoard: boolean;
  /** Writes and refreshes threads after the committed response. */
  change(suffix: string, body?: unknown, method?: 'POST' | 'PUT' | 'DELETE'): Promise<void>;
  /**
   * Deletes a thread: through its pin when the person may edit the board and the pin
   * is in the document (one undo step, which brings the thread back), else in the boards
   * service directly. Closes its card.
   */
  deleteThread(thread: Thread): Promise<void>;
  /**
   * Moves a thread's pin (`PUT …/:threadId/pin`) and fetches threads again; a refused
   * move shows the usual error and rejects. Absent where pins cannot move.
   */
  readonly movePin?: ((thread: Thread, pin: ThreadPin) => Promise<void>) | undefined;
  /** Fetches threads again. */
  refresh(): Promise<void>;
  /** Closes the composer. */
  close(): void;
  /** Opens an existing thread. */
  select(id: string): void;
  /** Opens a first-message composer. */
  place(placement: CommentPlacement): void;
}
/** Absent outside a signed-in board. */
export const commentDataContext = createContext<CommentData | undefined>(undefined);

// The schema's facilitation exports: the board timer's stored shape, its remaining-time
// maths on the relay's clock, the actions people take on it and the relay's clock on the wire,
// re-exported by the package entry.
export { applyTimerAction } from './board-timer-action.js';
export type { BoardTimerAction, BoardTimerActionKind } from './board-timer-action.js';
export {
  boardTimerSchema,
  DEFAULT_TIMER_DURATION_MS,
  isTimerExpired,
  MAX_TIMER_DURATION_MS,
  MIN_TIMER_DURATION_MS,
  timerEndsAt,
  timerRemainingMs,
} from './board-timer.js';
export type { BoardTimer, BoardTimerStatus } from './board-timer.js';
export {
  encodeServerTime,
  encodeTimeRequest,
  MAX_TIME_REQUEST_ID,
  parseServerTime,
  parseTimeRequest,
} from '../relay/server-time.js';
export type { ServerTime } from '../relay/server-time.js';
export {
  encodeReactionDrop,
  encodeReactionEvent,
  parseReactionDrop,
  parseReactionEvent,
  REACTION_EMOJIS,
} from '../relay/reaction.js';
export type { ReactionDrop, ReactionEmoji, ReactionEvent } from '../relay/reaction.js';

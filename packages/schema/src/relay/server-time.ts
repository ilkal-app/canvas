// The relay's clock on the wire: a client asks with a stateless
// `{ "type": "time-request", "id": n }` and the relay answers `{ "type": "server-time", "id": n,
// "nowMs": t }`, its clock in ms since the epoch when it answered. The client times the round
// trip and estimates the offset of the relay's clock from its own (`estimateServerOffset` in
// `@canvas/collab`). Pure: both sides parse strictly and treat anything else as not theirs.

/** The largest request id: ids are 31-bit non-negative integers, so they stay small on the wire. */
export const MAX_TIME_REQUEST_ID = 2 ** 31 - 1;

/**
 * Whether a value is a request id.
 *
 * @param value - Anything.
 * @returns Whether it is an integer in `[0, MAX_TIME_REQUEST_ID]`.
 */
function isRequestId(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TIME_REQUEST_ID
  );
}

/**
 * Parses a stateless payload as a JSON object with exactly the given keys.
 *
 * @param payload - The payload.
 * @param type - The `type` it must carry.
 * @param keys - How many keys it must have.
 * @returns The object, or undefined.
 */
function parseRecord(
  payload: string,
  type: string,
  keys: number,
): Readonly<Record<string, unknown>> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === keys && record.type === type ? record : undefined;
}

/**
 * Encodes a client's request for the relay's clock.
 *
 * @param id - The request's id, echoed in the answer.
 * @returns The stateless payload.
 * @throws {RangeError} When the id is not a request id.
 */
export function encodeTimeRequest(id: number): string {
  if (!isRequestId(id)) throw new RangeError(`not a time request id: ${String(id)}`);
  return JSON.stringify({ type: 'time-request', id });
}

/**
 * Reads a stateless payload as a request for the relay's clock: exactly `type` and `id`.
 *
 * @param payload - The payload, already bounded by the relay's stateless frame limit.
 * @returns The request's id, or undefined for anything else.
 */
export function parseTimeRequest(payload: string): number | undefined {
  const record = parseRecord(payload, 'time-request', 2);
  return record !== undefined && isRequestId(record.id) ? record.id : undefined;
}

/** The relay's answer to a time request. */
export interface ServerTime {
  /** The request's id. */
  readonly id: number;
  /** The relay's clock when it answered, ms since the epoch. */
  readonly nowMs: number;
}

/**
 * Encodes the relay's answer to a time request.
 *
 * @param answer - The id and the relay's clock.
 * @returns The stateless payload.
 */
export function encodeServerTime(answer: ServerTime): string {
  return JSON.stringify({ type: 'server-time', id: answer.id, nowMs: Math.floor(answer.nowMs) });
}

/**
 * Reads a stateless payload as the relay's answer: exactly `type`, `id` and a non-negative
 * integer `nowMs` within the safe integers.
 *
 * @param payload - The payload.
 * @returns The answer, or undefined for anything else.
 */
export function parseServerTime(payload: string): ServerTime | undefined {
  const record = parseRecord(payload, 'server-time', 3);
  if (record === undefined || !isRequestId(record.id)) return undefined;
  const { nowMs } = record;
  const isTime = Number.isSafeInteger(nowMs) && (nowMs as number) >= 0;
  return isTime ? { id: record.id, nowMs: nowMs as number } : undefined;
}

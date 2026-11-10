import { assetRecordSchema, type AssetRecord } from '@canvas/schema';

/**
 * A request the assets service refused, or that did not reach it (`status` 0). Its message is
 * the service's (never a URL), and `retryAfterMs` its `Retry-After` for `429` and `503`.
 */
export class AssetsHttpError extends Error {
  /** The HTTP status; 0 when the request never got an answer. */
  readonly status: number;
  /** The service's error code (`rate-limited`, `hash-mismatch`, `expired`…), or `network`. */
  readonly code: string;
  /** How long to wait before trying again, ms, when the service said. */
  readonly retryAfterMs: number | undefined;
  /** At a plan limit, the limit that applied, in bytes. */
  readonly limit?: number;
  /** At the storage limit, the board owner's bytes in use. */
  readonly used?: number;

  /**
   * Describes the refusal.
   *
   * @param status - The HTTP status, or 0.
   * @param code - The service's error code.
   * @param message - What went wrong.
   * @param retryAfterMs - The service's `Retry-After`, ms.
   */
  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'AssetsHttpError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Reads a JSON value from an object.
 *
 * @param value - The object.
 * @param key - The field.
 * @returns The field's value, or undefined.
 */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Reads a `Retry-After` header expressed as seconds or an HTTP date.
 *
 * @param response - The response.
 * @returns The wait, ms, or undefined.
 */
export function retryAfterOf(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return seconds >= 0 && Number.isFinite(seconds * 1000) ? seconds * 1000 : undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Throws the service's refusal for a response that is not OK.
 *
 * @param response - The response.
 * @returns Nothing: it always throws.
 * @throws {AssetsHttpError} With the service's code and message.
 */
export async function refusal(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = field(body, 'error');
  const message = field(body, 'message');
  const limit = field(body, 'limit');
  const used = field(body, 'used');
  const error = new AssetsHttpError(
    response.status,
    typeof code === 'string' ? code : 'http',
    typeof message === 'string'
      ? message
      : `The assets service answered ${String(response.status)}.`,
    retryAfterOf(response),
  );
  throw Object.assign(error, {
    ...(Number.isSafeInteger(limit) ? { limit } : {}),
    ...(Number.isSafeInteger(used) ? { used } : {}),
  });
}

/**
 * Checks a record the service sent.
 *
 * @param value - The JSON value.
 * @returns The record.
 * @throws {AssetsHttpError} When it is not a valid `AssetRecord`.
 */
export function recordOf(value: unknown): AssetRecord {
  const parsed = assetRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new AssetsHttpError(0, 'invalid-record', 'The assets service sent an invalid record.');
  }
  return parsed.data;
}

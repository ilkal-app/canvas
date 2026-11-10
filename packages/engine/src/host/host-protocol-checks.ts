// The field checks of the host protocol (`host-protocol.ts`): a message that crossed a thread is
// untrusted, so each side checks the shape of what it receives.

/**
 * Checks one received value.
 *
 * @param value - The value.
 * @returns Whether it has the expected shape.
 */
export type Check = (value: unknown) => boolean;

/**
 * Whether a value is a non-null object.
 *
 * @param value - The value.
 * @returns `true` for an object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks for a finite number.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Whether a value is an object whose fields pass their checks.
 *
 * @param value - The value.
 * @param checks - Each field's check.
 * @returns `true` when every field passes.
 */
export function hasFields(value: unknown, checks: Readonly<Record<string, Check>>): boolean {
  return isRecord(value) && Object.entries(checks).every(([key, check]) => check(value[key]));
}

/**
 * Checks for a camera.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isCamera: Check = (value) =>
  hasFields(value, {
    x: isNumber,
    y: isNumber,
    zoom: isNumber,
    viewportWidthPx: isNumber,
    viewportHeightPx: isNumber,
    dpr: isNumber,
  });

/**
 * Checks for a pixel rectangle.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isRect: Check = (value) =>
  hasFields(value, { xPx: isNumber, yPx: isNumber, widthPx: isNumber, heightPx: isNumber });

/**
 * Checks for a colour: four finite numbers.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isColor: Check = (value) =>
  Array.isArray(value) && value.length === 4 && value.every(isNumber);

/**
 * Checks for a pointer input.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isPointer: Check = (value) =>
  hasFields(value, {
    type: (type) => type === 'down' || type === 'move' || type === 'up' || type === 'cancel',
    xPx: isNumber,
    yPx: isNumber,
    buttons: isNumber,
    pointerId: isNumber,
    timestampMs: isNumber,
  });

/**
 * Checks for a cloneable failure: a name and a message.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isFailure: Check = (value) =>
  hasFields(value, {
    name: (name) => typeof name === 'string',
    message: (message) => typeof message === 'string',
  });

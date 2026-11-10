import { z } from 'zod';

/** Printable ASCII, U+0021 to U+007E, as OpenType's name ID 6 allows. */
const PRINTABLE = /^[!-~]{1,63}$/u;

/** The characters name ID 6 forbids among the printable ones. */
const FORBIDDEN = /[[\](){}<>/%]/u;

/**
 * Validates a face's PostScript name, as OpenType's name ID 6 defines it: 1 to 63
 * printable ASCII characters other than `[ ] ( ) { } < > / %`, such as `Inter-CondensedBold`. It
 * picks one face of a family where weight and slant do not (a condensed or display face).
 */
export const postScriptNameSchema = z
  .string()
  .regex(PRINTABLE)
  .refine((name) => !FORBIDDEN.test(name), {
    message: 'A PostScript name may not contain [ ] ( ) { } < > / or %.',
  });

/** A face's PostScript name. */
export type PostScriptName = z.output<typeof postScriptNameSchema>;

/**
 * The face name a style keeps after a restyle: a face belongs to its family, so a patch
 * that moves the style to another family without naming a face drops the old one. A face the
 * patch names wins (`null` removes it); otherwise the style keeps its own.
 *
 * @param current - The style before: its family and face name.
 * @param current.fontFamily - Its family.
 * @param current.postScriptName - Its face name, if any.
 * @param patch - The fields set: a family, a face name or `null`, either absent.
 * @param patch.fontFamily - The new family, if set.
 * @param patch.postScriptName - The new face name, `null` to remove it, if set.
 * @returns The face name after the restyle, or `undefined` for none.
 */
export function restyledFace(
  current: { readonly fontFamily: string; readonly postScriptName?: string | undefined },
  patch: {
    readonly fontFamily?: string | undefined;
    readonly postScriptName?: string | null | undefined;
  },
): string | undefined {
  if (patch.postScriptName !== undefined) return patch.postScriptName ?? undefined;
  if (patch.fontFamily !== undefined && patch.fontFamily !== current.fontFamily) return undefined;
  return current.postScriptName;
}

/**
 * A style with its face name set, or removed for `undefined`.
 *
 * @param style - The style; it is not changed.
 * @param face - The face name, or `undefined` for none.
 * @returns A new style.
 */
export function withPostScriptName<Style extends object>(
  style: Style,
  face: string | undefined,
): Style {
  const rest = Object.fromEntries(
    Object.entries(style).filter(([field]) => field !== 'postScriptName'),
  ) as Style;
  return face === undefined ? rest : { ...rest, postScriptName: face };
}

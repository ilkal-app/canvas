import { z } from 'zod';

/** The longest link an object may store, characters (after trimming). */
export const LINK_MAX_LENGTH = 2048;

/** The only schemes a link may use: web pages and mail. */
export const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

/**
 * A mail address as a link names it, decoded: a local part, `@` and a domain, with no space or
 * control character anywhere (one class, no nesting: no backtracking).
 */
const MAIL_ADDRESS = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;

/** The only headers a mail link may carry: what the mail says, never who else receives it. */
const MAIL_HEADERS: ReadonlySet<string> = new Set(['subject', 'body']);

/**
 * Whether a `mailto:` link only addresses its visible recipients: it names at least one, each
 * (decoded) a plain address with no space or control character, and its query carries no header but `subject` and `body` (no `cc`, `bcc`, `to` or any other, which
 * would add recipients the link does not show), with no line break in either.
 *
 * @param url - The parsed `mailto:` link.
 * @returns True when it is a plain mail link.
 */
function isPlainMailLink(url: URL): boolean {
  let recipients: string;
  try {
    recipients = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (!recipients.split(',').every((address) => MAIL_ADDRESS.test(address))) return false;
  for (const [name, value] of url.searchParams) {
    if (!MAIL_HEADERS.has(name.toLowerCase()) || /[\r\n]/u.test(value)) return false;
  }
  return true;
}

/**
 * A link as an object stores it, or undefined when the text is no safe link: trimmed,
 * at most {@link LINK_MAX_LENGTH} characters, an absolute URL (no guessing of a scheme for a bare
 * domain) with one of {@link LINK_PROTOCOLS}, no user name or password (which can disguise
 * where a link goes), and for a mail link a recipient and no header but `subject` and `body`. Anything else — `javascript:`, `data:`, any other scheme, a relative path —
 * is refused. The URL parser drops tabs and newlines inside a scheme, so `java\tscript:` is read
 * as `javascript:` and refused. Pure.
 *
 * @param text - What was typed or stored.
 * @returns The link, normalised by the URL parser (`HTTPS://Example.com` → `https://example.com/`),
 *   or undefined.
 */
export function normalizeLink(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > LINK_MAX_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (!(LINK_PROTOCOLS as readonly string[]).includes(url.protocol)) return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.protocol === 'mailto:' && !isPlainMailLink(url)) return undefined;
  return url.href.length > LINK_MAX_LENGTH ? undefined : url.href;
}

/**
 * Validates a stored link: only a value {@link normalizeLink} leaves unchanged, so every stored
 * link uses an allowed scheme, carries no credentials or hidden mail recipients, and is already
 * in its normal form. It says nothing of whether the destination is trustworthy: the app shows
 * the destination before opening it.
 */
export const linkSchema = z
  .string()
  .refine((value) => normalizeLink(value) === value, {
    message:
      'A link must be an http, https or mailto URL, without a user name or password, and a mail link without headers but subject and body.',
  })
  .describe('A link the object opens with ⌘-click: an http, https or mailto URL.');

/**
 * The optional `link` a text, a sticky and an image may store (schema version
 * `LINK_VERSION`); absent is no link.
 */
export const linkShape = {
  /** Where ⌘-click on the object goes; absent is no link. */
  link: linkSchema.optional(),
};

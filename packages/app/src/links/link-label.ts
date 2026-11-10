/** The longest label a chip shows for a link, characters; the whole link is its tooltip. */
export const LINK_LABEL_MAX_LENGTH = 48;

/**
 * A link as a chip shows it: a web address without its `http(s)://` and a trailing `/`
 * (`https://example.com/a/` reads `example.com/a`), a mail link as its address, cut to
 * {@link LINK_LABEL_MAX_LENGTH} characters with an ellipsis. Always plain text: the chip never
 * renders it as markup or follows it itself. Pure.
 *
 * @param link - The link, as stored.
 * @returns The label.
 */
export function linkLabelOf(link: string): string {
  const bare = link
    .replace(/^https?:\/\//iu, '')
    .replace(/^mailto:/iu, '')
    .replace(/\/$/u, '');
  const label = bare === '' ? link : bare;
  return label.length > LINK_LABEL_MAX_LENGTH
    ? `${label.slice(0, LINK_LABEL_MAX_LENGTH - 1)}…`
    : label;
}

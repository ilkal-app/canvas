/**
 * Where the board menu's Help and feedback goes: a help page, opened in a new tab, and
 * an address for feedback, opened in place (a `mailto:`). The host gives them (the site its own
 * help page and support address); the shell has none of its own, so without them the menu has no
 * Help and feedback.
 */
export interface HelpLinks {
  /** The help page's address; no Help centre if absent. */
  readonly docsUrl?: string | undefined;
  /** Where feedback goes, as a `mailto:` or a page; no Send feedback if absent. */
  readonly feedbackUrl?: string | undefined;
}

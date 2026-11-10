import type { BuiltinTokenId, ColorMode, Rgba, TokenId } from '@canvas/schema';

/**
 * A change to the board's colour tokens from the Board colours section,
 * each one document command and so one undo step: `set` creates a custom token (no `id`) or sets
 * a token's name and values (`setColorToken`; a built-in keeps its name), `setValue` sets one
 * mode's value, reading the name and other value as it runs, `rename` renames a custom token, `delete` deletes one (objects naming it draw as ink), `reset` gives a built-in
 * its default values back.
 */
export type ColorTokenAction =
  | {
      /** A colour token command. */
      readonly type: 'colorToken';
      /** Create a token, or set a token's name and values (`setColorToken`). */
      readonly command: 'set';
      /** The token; absent to create a custom token. */
      readonly id?: TokenId;
      /** Its name, unique on the board, 1 to 40 characters. */
      readonly name: string;
      /** Its light mode value. */
      readonly light: Rgba;
      /** Its dark mode value. */
      readonly dark: Rgba;
    }
  | {
      /** A colour token command. */
      readonly type: 'colorToken';
      /**
       * Set one mode's value of a token (`setColorToken`), keeping its name and other value as
       * they are when the command runs: an edit held behind a press, or made while a
       * collaborator changed the other value, never writes back a value it read earlier.
       */
      readonly command: 'setValue';
      /** The token. */
      readonly id: TokenId;
      /** The mode whose value is set. */
      readonly mode: ColorMode;
      /** The value. */
      readonly value: Rgba;
    }
  | {
      /** A colour token command. */
      readonly type: 'colorToken';
      /** Rename a custom token (`renameColorToken`). */
      readonly command: 'rename';
      /** The token. */
      readonly id: TokenId;
      /** Its new name. */
      readonly name: string;
    }
  | {
      /** A colour token command. */
      readonly type: 'colorToken';
      /** Delete a custom token (`deleteColorToken`). */
      readonly command: 'delete';
      /** The token. */
      readonly id: TokenId;
    }
  | {
      /** A colour token command. */
      readonly type: 'colorToken';
      /** Give a built-in its default values back (`resetColorToken`). */
      readonly command: 'reset';
      /** The built-in. */
      readonly id: BuiltinTokenId;
    };

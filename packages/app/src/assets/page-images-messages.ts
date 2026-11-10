// The sentences `PageImages` tells the person (split from page-images.ts to keep it under the
// file limit).

/** The sentence when the page has no assets service or board token. */
export const NO_IMAGES_MESSAGE = 'Images need a connection to the board’s server.';

/** The sentence when a paste from another board cannot get that board's token. */
export const CROSS_BOARD_UNAVAILABLE_MESSAGE =
  'The images could not be pasted: this page cannot read the board they were copied from.';

/**
 * The sentence when a paste names a source board this browser did not copy the images from (the
 * record of its copies has no such pair: expired, evicted, made before the record existed, or no
 * storage), or an image the board does not hold. Names no board.
 */
export const CROSS_BOARD_NOT_COPIED_MESSAGE =
  'The images could not be pasted: copy them again on their board, then paste.';

/** The sentence when the service refused to link an image from another board. */
export const CROSS_BOARD_REFUSED_MESSAGE =
  'The images could not be pasted: the board they were copied from does not share them.';

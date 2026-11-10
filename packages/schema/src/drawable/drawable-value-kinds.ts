/**
 * The stored values the door judges, by what they hold:
 *
 * - `placement`: `x`, `y` (coordinates, finite), `rotation` (float32) and `pageId` (absent,
 *   `null` or an id);
 * - `size`: `width`, `height` (sizes) and an instance's `scale`;
 * - `style`: an object's style group: an image's `crop` and `naturalSize`, a fill or frame
 *   background (`paintReason`), a stroke (`strokeValueReason`, a frame's too), a
 *   drop shadow (`shadowValueReason`) and a stroke alignment
 *   (`strokeAlignValueReason`), a layer name (`objectNameValueReason`) and
 *   an object's link (`linkValueReason`),
 *   each judged when present, a frame's `showName`
 *   (absent or a boolean), a path's, line's or connector's stroke style
 *   (`strokeStyleReason`), and a layer's or image's `opacity` (in [0, 1]);
 * - `point`: one point `{ x, y }`, coordinates (a line end);
 * - `points`: a pair of points (a line's two ends stored whole);
 * - `vertex`: a path's vertex, `x` and `y`;
 * - `segment`: a path's segment, its handle offsets `ha` and `hb`;
 * - `stroke-points`: a freehand stroke's flat x, y pairs, coordinates;
 * - `stroke-pressures`: a freehand stroke's pressures, each in [0, 1].
 */
export type DrawableValueKind =
  | 'placement'
  | 'size'
  | 'style'
  | 'point'
  | 'points'
  | 'vertex'
  | 'segment'
  | 'stroke-points'
  | 'stroke-pressures';

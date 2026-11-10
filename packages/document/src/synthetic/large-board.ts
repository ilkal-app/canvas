import {
  createSeededIdGenerator,
  type AssetId,
  type BoardObject,
  type ObjectId,
  type ObjectType,
  type PrincipalId,
  type StyleRun,
  type TextContent,
  type TextStyle,
} from '@canvas/schema';

// A realistic large board for the measurements at the budget sizes: Yjs at 50k
// objects in this package's benchmarks, and the frame-time benchmarks of `tooling/bench`,
// which draw the 1k, 10k and 50k boards. Frames of 100 objects whose children mix
// every object type in rough proportion to a working board (mostly stickies, shapes and
// connectors), text in three style runs, labelled shapes and connectors, pen paths. Ids come
// from the schema's seeded generator and every other value from the object's index, so the
// board is the same on every run.

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};
const BOLD: TextStyle = { ...BODY, weight: 700 };
const ACCENT: TextStyle = { ...BODY, color: [0.8, 0.2, 0.1, 1], italic: true };
const STROKE = { color: [0.1, 0.1, 0.12, 1] as [number, number, number, number], width: 2 };
const WORDS = ['launch', 'plan', 'review', 'ship', 'beta', 'metrics', 'design', 'research'];

/**
 * The types of a frame's 99 children, in order: the board's mix of object types. Freehand strokes
 * have boards of their own in the benchmarks.
 */
type SyntheticObjectType = Exclude<ObjectType, 'component' | 'instance' | 'freehand' | 'link'>;

const CHILD_TYPES: readonly SyntheticObjectType[] = (
  [
    ['sticky', 27],
    ['shape', 20],
    ['connector', 14],
    ['text', 10],
    ['image', 8],
    ['path', 7],
    ['line', 5],
    ['group', 3],
    ['comment', 3],
    ['video', 2],
  ] as const
).flatMap(([type, count]) => Array.from({ length: count }, () => type));

/**
 * Builds text of a few words in three style runs (plain, bold, accent).
 *
 * @param index - The object's index, which picks the words.
 * @returns The text and its runs.
 */
function richText(index: number): TextContent {
  const words = [...Array(4 + (index % 5)).keys()].map((word) => WORDS[(index + word) % 8]);
  const text = words.join(' ');
  const first = Math.max(1, Math.floor(text.length / 3));
  const second = Math.max(1, Math.floor(text.length / 3));
  const runs: StyleRun[] = [
    { length: first, style: BODY },
    { length: second, style: BOLD },
    { length: text.length - first - second, style: ACCENT },
  ];
  return { text, runs };
}

/**
 * Builds the fields of a pen path: six vertices joined by five curved segments.
 *
 * @returns The path's fields beyond the shared ones.
 */
function pathFields(): Record<string, unknown> {
  return {
    vertices: [...Array(6).keys()].map((vertex) => ({
      id: `v${String(vertex)}`,
      x: vertex * 20,
      y: (vertex % 2) * 15,
      mirror: 'angle',
    })),
    segments: [...Array(5).keys()].map((segment) => ({
      id: `s${String(segment)}`,
      a: `v${String(segment)}`,
      b: `v${String(segment + 1)}`,
      ha: { x: 5, y: 5 },
      hb: { x: -5, y: -5 },
    })),
    stroke: STROKE,
    fill: null,
  };
}

/**
 * Builds the type-specific fields of one child.
 *
 * @param type - The child's type.
 * @param index - The child's index on the board.
 * @param previous - The previous box-like child of the same frame, for connectors and comments.
 * @returns The fields beyond the shared ones.
 */
function childFields(
  type: SyntheticObjectType,
  index: number,
  previous: ObjectId,
): Record<string, unknown> {
  const box = { width: 120 + (index % 7) * 10, height: 80 + (index % 5) * 10 };
  const text = { ...richText(index), align: 'left', verticalAlign: 'top' };
  const point = (x: number, y: number) => ({ x, y });
  switch (type) {
    case 'sticky':
      return { ...box, ...text, autoWidth: false, color: [1, 0.92, 0.55, 1] };
    case 'text':
      return { ...box, ...text, autoWidth: true };
    case 'shape':
      return {
        ...box,
        kind: 'rectangle',
        stroke: STROKE,
        fill: [0.66, 0.84, 0.98, 1],
        cornerRadius: 8,
        sides: 4,
        label: index % 2 === 0 ? richText(index) : null,
      };
    case 'connector':
      return {
        from: { kind: 'object', objectId: previous, anchor: null },
        to: { kind: 'point', x: 40, y: 40 },
        route: 'elbow',
        stroke: STROKE,
        startCap: 'none',
        endCap: 'arrow',
        label: index % 3 === 0 ? richText(index) : null,
      };
    case 'image':
      return {
        ...box,
        assetId: `asset-${String(index % 97)}` as AssetId,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        naturalSize: { width: 1600, height: 1200 },
        opacity: 1,
      };
    case 'video':
      return {
        ...box,
        assetId: 'clip',
        poster: null,
        loop: false,
        muted: true,
        trim: null,
      };
    case 'line':
      return {
        points: [point(0, 0), point(100, 20)],
        route: 'straight',
        stroke: STROKE,
        startCap: 'none',
        endCap: 'none',
      };
    case 'path':
      return pathFields();
    case 'comment':
      return {
        threadId: `thread-${String(index)}`,
        anchor: { kind: 'object', objectId: previous, offset: point(10, 10) },
      };
    case 'group':
    case 'frame':
      return {};
  }
}

/**
 * Builds a large board of valid objects: frames of 100 objects each (the frame and 99 children
 * of the mix above, on a 10 × 10 grid of 150 world units inside it). Connectors and comments
 * attach to an earlier child of their frame. Every frame sits at the board origin, one on top
 * of another; a caller that draws the board lays the frames out itself. Pure and deterministic.
 *
 * @param count - How many objects; a multiple of 100 gives whole frames.
 * @param seed - The id generator's seed.
 * @returns The objects, in creation order.
 */
export function createLargeBoardObjects(count: number, seed: number): BoardObject[] {
  const nextId = createSeededIdGenerator(seed);
  const objects: BoardObject[] = [];
  let frameId = nextId();
  let previous = frameId;
  for (let index = 0; index < count; index += 1) {
    const slot = index % 100;
    const type: SyntheticObjectType = slot === 0 ? 'frame' : (CHILD_TYPES[slot - 1] ?? 'sticky');
    const objectId = slot === 0 ? (frameId = nextId()) : nextId();
    const shared = {
      id: objectId,
      type,
      parentId: slot === 0 ? null : frameId,
      x: (index % 10) * 150,
      y: Math.floor(slot / 10) * 150,
      rotation: 0,
      // Integer keys: head `b` states two digits, so `b00` to `b99` are all fractional-index keys.
      z: `b${String(slot).padStart(2, '0')}`,
      locked: false,
      createdBy: 'user:ada' as PrincipalId,
      createdAt: 1_760_000_000_000 + index,
      updatedAt: 1_760_000_000_000 + index,
    };
    const fields =
      slot === 0
        ? {
            width: 1600,
            height: 1600,
            name: `Frame ${String(index / 100)}`,
            clip: false,
            background: null,
          }
        : childFields(type, index, previous);
    objects.push({ ...shared, ...fields } as BoardObject);
    if (type === 'sticky' || type === 'shape' || type === 'text') previous = objectId;
  }
  return objects;
}

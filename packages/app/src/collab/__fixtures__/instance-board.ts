// Cached preview fixtures: a two-page board whose
// first page shows instances of mains kept on the second page, built by hand with valid fields.
import {
  InstanceExpansion,
  visibleWorldBounds,
  type DefinitionSource,
  type PreviewCertificate,
} from '@canvas/engine';
import {
  buildChildIndex,
  createBoard,
  DEFAULT_PAGE,
  type Board,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

type Fields = Readonly<Record<string, unknown>>;

/** The page holding the mains, after the default page in page order. */
export const MAINS_PAGE: Page = { id: 'page-2' as PageId, name: 'Mains', order: 'a1' };

function build(type: string, id: string, parentId: string | null, ...parts: Fields[]): BoardObject {
  const shared: Fields = {
    id,
    type,
    parentId,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  };
  return parts.reduce<Fields>((all, part) => ({ ...all, ...part }), shared) as BoardObject;
}

function component(id: string, fields: Fields = {}): BoardObject {
  return build(
    'component',
    id,
    null,
    { width: 200, height: 100, name: 'Card', retired: false },
    fields,
  );
}

function instance(id: string, mainId: string, fields: Fields = {}): BoardObject {
  return build('instance', id, null, { width: 200, height: 100, mainId, overrides: {} }, fields);
}

function shape(id: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(
    'shape',
    id,
    parentId,
    { width: 40, height: 20, kind: 'rectangle', stroke: null, fill: [0.66, 0.84, 0.98, 1] },
    { cornerRadius: 0, sides: 4, label: null },
    fields,
  );
}

function image(id: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(
    'image',
    id,
    parentId,
    { width: 40, height: 40, assetId: 'asset-photo', crop: { x: 0, y: 0, width: 1, height: 1 } },
    { naturalSize: { width: 100, height: 100 }, opacity: 1 },
    fields,
  );
}

/**
 * The board. On the default page (shown): a plain shape `plain`; an instance `inst` of `main`
 * overriding the photo's asset; an instance `nest` of `outer`, a main holding an instance of
 * `main`; a retired main `gone` (child `old`) with a late instance `late`. On {@link MAINS_PAGE},
 * inside the frame `shelf`: `main` (a shape `title`, an image `photo`) and `outer`; an unrelated
 * shape `stray`.
 *
 * @param options - Leave out the images (the live capture refuses them).
 * @param options.hasImages - Whether `main` holds the image `photo`; true by default.
 * @returns The whole board, its pages included.
 */
export function instanceBoard({ hasImages = true }: { readonly hasImages?: boolean } = {}): Board {
  const page = { pageId: DEFAULT_PAGE.id };
  const mains = { pageId: MAINS_PAGE.id };
  const overrides = hasImages ? { photo: { assetId: 'asset-override' } } : {};
  return createBoard(
    [
      shape('plain', null, { ...page, x: 20, y: 20 }),
      instance('inst', 'main', { ...page, x: 100, y: 100, overrides }),
      instance('nest', 'outer', { ...page, x: 400, y: 100, width: 240, height: 140 }),
      component('gone', { ...page, x: 100, y: 400, retired: true }),
      shape('old', 'gone', { x: 10, y: 10 }),
      instance('late', 'gone', { ...page, x: 400, y: 400 }),
      build(
        'frame',
        'shelf',
        null,
        { ...mains, width: 1000, height: 600, name: 'Shelf', clip: false },
        { background: [1, 1, 1, 1] },
      ),
      component('main', { x: 20, y: 20, parentId: 'shelf' }),
      shape('title', 'main', { x: 10, y: 10, fill: [1, 0, 0, 1] }),
      ...(hasImages ? [image('photo', 'main', { x: 100, y: 40 })] : []),
      component('outer', { x: 400, y: 20, width: 240, height: 140, parentId: 'shelf' }),
      instance('inner', 'main', { x: 20, y: 20, parentId: 'outer' }),
      shape('stray', null, { ...mains, x: 20, y: 300 }),
    ],
    [DEFAULT_PAGE, MAINS_PAGE],
  );
}

/**
 * Whole-board definitions, as the live feed reads them.
 *
 * @param board - The board.
 * @returns The definition source.
 */
export function boardDefinitions(board: Board): DefinitionSource {
  const children = buildChildIndex(board);
  return {
    get: (id) => board.objects.get(id),
    childrenOf: (id) => children.get(id) ?? [],
    instancesOf: (mainId) =>
      [...board.objects.values()]
        .filter((object) => object.type === 'instance' && object.mainId === mainId)
        .map((object) => object.id),
  };
}

/**
 * What the live feed draws for the default page: its objects through `InstanceExpansion` over
 * the whole board.
 *
 * @param board - The board.
 * @returns The drawn objects by scene id, virtual ids included.
 */
export function liveScene(board: Board): Map<string, BoardObject> {
  const page = [...board.objects.values()].filter((object) => !isOnMainsPage(board, object));
  const objects = new Map(page.map((object) => [object.id, object]));
  const changes = new InstanceExpansion(boardDefinitions(board)).expand({
    created: [...objects.keys()],
    updated: [],
    deleted: [],
    get: (id) => objects.get(id),
  });
  const scene = new Map<string, BoardObject>();
  for (const id of changes.created) {
    const object = changes.get(id);
    if (object !== undefined) scene.set(id, object);
  }
  return scene;
}

function isOnMainsPage(board: Board, object: BoardObject): boolean {
  let at: BoardObject | undefined = object;
  while (at !== undefined && at.parentId !== null) at = board.objects.get(at.parentId);
  return at?.pageId === MAINS_PAGE.id;
}

/**
 * A certificate for the default page at the fixture camera, its candidates every scene id the
 * live feed draws (virtual ids included), and its assets those of the drawn images.
 *
 * @param board - The board.
 * @param scene - The session and sequence it certifies.
 * @param scene.session - The mount's session.
 * @param scene.sequence - The stream revision.
 * @returns The certificate.
 */
export function sceneCertificate(
  board: Board,
  scene: PreviewCertificate['scene'],
): PreviewCertificate {
  const drawn = liveScene(board);
  const assets = [...drawn.values()].flatMap((object) =>
    object.type === 'image'
      ? [{ assetId: object.assetId, contentVersion: `v-${object.assetId}` }]
      : [],
  );
  return {
    scene,
    camera: FIXTURE_CAMERA,
    coverage: visibleWorldBounds(FIXTURE_CAMERA),
    fontSetKey: 'font-sha',
    candidates: [...drawn.keys()] as ObjectId[],
    assets: [...new Map(assets.map((asset) => [asset.assetId, asset])).values()],
    imagePlanKey: '[]',
    lodPlanKey: '[]',
    frameIndex: 3,
    resourceGeneration: 1,
  };
}

/** The camera the fixture certificates use: the default page's top left, 1200 by 800. */
export const FIXTURE_CAMERA = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1200,
  viewportHeightPx: 800,
  dpr: 1,
};

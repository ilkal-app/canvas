import type {
  BoardObject,
  CornerRadii,
  ImagePaint,
  LinkObject,
  ObjectId,
  Rgba,
} from '@canvas/schema';

import { SDF_SHAPE_IMAGE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-image-move.generated.js';
import { SDF_SHAPE_IMAGE_SHADER } from '../gpu/shaders/sdf-shape-image.generated.js';
import {
  IMAGE_FILL_LEVEL_OF_DETAIL,
  IMAGE_FILL_TAIL_ATTRIBUTES,
} from '../images/image-fill-record.js';
import { ImageFillRecords } from '../images/image-fill-records.js';
import {
  FRAME_SHAPE_ATTRIBUTES,
  FRAME_SHAPE_FLOATS,
  writeFrameCornerRadii,
} from '../scene/frame-shape-record.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import type {
  SceneObject,
  ScenePass,
  ScenePassEnvironment,
  ScenePassFactory,
} from '../scene/scene-pass.js';

import {
  hasLinkFavicon,
  LINK_CARD_LOOK,
  linkCardParts,
  linkPreviewBox,
  type CardBox,
} from './link-card-geometry.js';
import { IMAGE_FILL_PAGE_BINDINGS } from './shape-image-pass.js';
import { SHAPE_QUAD_CORNER_VERTEX_LAYOUT, SHAPE_KIND_CODES } from './shape-instance-layout.js';
import { SHAPE_QUAD_CORNERS, SHAPE_QUAD_VERTEX_COUNT } from './shape-pipeline.js';

// A link card's two images: the page's preview in the card's image area and the site's
// icon in its footer, each an image fill of the shared texture manager drawn as a rounded box of
// `sdf-shape-image`, as a frame's image background is. A scene pass gives an object one texture
// page, so each image has a pass of its own; the residency tracks each by a stand-in whose box
// is the image's part of the card, the icon's under an id of its own.

/** The link preview pass's name. */
export const LINK_PREVIEW_PASS_NAME = 'link-preview';

/** The link icon pass's name. */
export const LINK_ICON_PASS_NAME = 'link-icon';

/** The record: the frame SDF record with its corner radii, the image-fill tail, the clip index. */
const LINK_IMAGE_INSTANCE_LAYOUT = resolveSceneInstanceLayout([
  ...FRAME_SHAPE_ATTRIBUTES,
  ...IMAGE_FILL_TAIL_ATTRIBUTES,
]);

/** The whole of an image. */
const WHOLE = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** No colour: the image tail colours the box. */
const CLEAR = Object.freeze([0, 0, 0, 0]) as unknown as Rgba;

/** One of a card's two images: which it is, and where and how it draws. */
interface LinkImageKind {
  /** The pass's name. */
  readonly passName: string;
  /** The image's paint, or undefined when the card does not draw it. */
  readonly paintOf: (card: LinkObject) => ImagePaint | undefined;
  /** Its box in the card's frame, and its corner radii. */
  readonly partOf: (card: LinkObject) => { readonly box: CardBox; readonly radii: CornerRadii };
  /** The id the residency tracks it under. */
  readonly idOf: (card: LinkObject) => ObjectId;
}

/**
 * An image paint that covers its box, centred, cutting what overflows (`crop`), as a page's
 * preview is shown: a square image in a wide card keeps its proportions.
 *
 * @param assetId - The image's asset.
 * @param size - Its size in pixels.
 * @param size.width - The width.
 * @param size.height - The height.
 * @returns The paint.
 */
function coverPaint(
  assetId: ImagePaint['assetId'],
  size: { readonly width: number; readonly height: number },
): ImagePaint {
  return { type: 'image', assetId, naturalSize: size, fit: 'crop', crop: WHOLE };
}

/**
 * A card's paint for one image, kept per card version.
 *
 * @param read - The paint of a card.
 * @returns The memoised reader.
 */
function memoisedPaint(
  read: (card: LinkObject) => ImagePaint | undefined,
): (card: LinkObject) => ImagePaint | undefined {
  const paints = new WeakMap<LinkObject, ImagePaint | undefined>();
  return (card) => {
    if (!paints.has(card)) paints.set(card, read(card));
    return paints.get(card);
  };
}

/** The page's preview, in the card's image area, rounded at the card's corners only. */
const PREVIEW: LinkImageKind = {
  passName: LINK_PREVIEW_PASS_NAME,
  paintOf: memoisedPaint((card) =>
    card.status !== 'failed' && card.imageAssetId !== undefined && card.imageSize !== undefined
      ? coverPaint(card.imageAssetId, card.imageSize)
      : undefined,
  ),
  partOf: (card) => {
    const box = linkPreviewBox(card) ?? { x: 0, y: 0, width: 0, height: 0 };
    const radius = LINK_CARD_LOOK.radius - 1;
    const radii: CornerRadii =
      card.layout === 'horizontal' ? [radius, 0, 0, radius] : [radius, radius, 0, 0];
    return { box, radii };
  },
  idOf: (card) => card.id,
};

/** The site's icon, in the footer's square, a little rounded. */
const ICON: LinkImageKind = {
  passName: LINK_ICON_PASS_NAME,
  paintOf: memoisedPaint((card) =>
    hasLinkFavicon(card) && card.faviconAssetId !== undefined && card.faviconSize !== undefined
      ? coverPaint(card.faviconAssetId, card.faviconSize)
      : undefined,
  ),
  partOf: (card) => ({ box: linkCardParts(card).icon, radii: [2, 2, 2, 2] }),
  // Not an object id's alphabet, so it never meets one.
  idOf: (card) => `${card.id}#icon` as ObjectId,
};

/**
 * The stand-in a card's image is tracked by: an object whose box is the image's part of the
 * card, under the image's id, placed by the card's transform at the part's corner. Kept per card
 * version and transform.
 *
 * @param kind - Which image.
 * @returns The placement, for `ImageFillRecords`.
 */
function placementOf(kind: LinkImageKind): (target: SceneObject) => SceneObject {
  const placed = new WeakMap<BoardObject, SceneObject>();
  return (target) => {
    const { object, transform } = target;
    if (object.type !== 'link') return target;
    const cached = placed.get(object);
    if (cached?.transform === transform) return cached;
    const { box } = kind.partOf(object);
    const { cos, sin } = transform;
    const standIn: SceneObject = {
      ...target,
      object: { ...object, id: kind.idOf(object), width: box.width, height: box.height },
      transform: {
        x: transform.x + cos * box.x - sin * box.y,
        y: transform.y + sin * box.x + cos * box.y,
        cos,
        sin,
      },
    };
    placed.set(object, standIn);
    return standIn;
  };
}

/**
 * Builds one image's pass for one renderer.
 *
 * @param kind - Which image.
 * @param environment - The renderer's environment: its backend, level of detail and images.
 * @returns The pass.
 */
function createLinkImagePass(kind: LinkImageKind, environment: ScenePassEnvironment): ScenePass {
  const paintOf = (object: BoardObject): ImagePaint | undefined =>
    object.type === 'link' ? kind.paintOf(object) : undefined;
  const place = placementOf(kind);
  const records = new ImageFillRecords(kind.passName, environment, paintOf, place);
  const pass: ScenePass = {
    isRootMoveOrderStable: true,
    name: kind.passName,
    layout: LINK_IMAGE_INSTANCE_LAYOUT,
    pipelineSpec: {
      shader: SDF_SHAPE_IMAGE_SHADER,
      moveShader: SDF_SHAPE_IMAGE_MOVE_SHADER,
      vertexLayout: SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
      vertices: new Float32Array(SHAPE_QUAD_CORNERS),
      vertexCount: SHAPE_QUAD_VERTEX_COUNT,
      blend: 'premultiplied',
      pageBindings: IMAGE_FILL_PAGE_BINDINGS,
    },
    // Overlapping cards' images on different pages must stay in z order.
    isPaintOrderedAcrossPages: true,
    recordCount: (object) => (paintOf(object) === undefined ? 0 : 1),
    isOccluder: (object) => paintOf(object) !== undefined,
    levelOfDetail: IMAGE_FILL_LEVEL_OF_DETAIL,
    // Residency keeps each image's world bounds: it follows a translating move.
    shouldFollowTranslatedTargets: true,
    retainMoveTarget: (target) => {
      records.retain(target);
    },
    prepare(record, target) {
      const { object } = target;
      if (object.type !== 'link' || kind.paintOf(object) === undefined) return;
      const { transform } = place(target);
      const { box, radii } = kind.partOf(object);
      record[0] = transform.x;
      record[1] = transform.y;
      record[2] = box.width;
      record[3] = box.height;
      record.set(CLEAR, 4);
      record[10] = SHAPE_KIND_CODES['rounded-box'];
      record[11] = transform.cos;
      record[12] = transform.sin;
      writeFrameCornerRadii(record, radii);
      records.write(record, target, FRAME_SHAPE_FLOATS);
    },
    pageOf: (target) => records.pageOf(target),
    pageEntries: (page) => records.pageEntries(page),
    install: (frame) => {
      records.install(frame);
    },
    forget: (id) => {
      records.forget(id);
    },
    destroy: () => {
      records.destroy();
    },
  };
  return records.registerPreview(records.guardRootMoves(pass));
}

/**
 * A link card's preview image: the page's image covering the card's image area
 * (`linkPreviewBox`), rounded at the card's own corners, from the renderer's shared texture
 * manager. Until a level is resident, and below the level-of-detail threshold, it draws the
 * image's average colour; a card without a preview gives it no record. List it right after
 * `SDF_SHAPE_IMAGE_PASS`.
 */
export const LINK_PREVIEW_PASS: ScenePassFactory = {
  name: LINK_PREVIEW_PASS_NAME,
  create: (environment) => createLinkImagePass(PREVIEW, environment),
};

/**
 * A link card's site icon: the site's icon in the footer's square, from the shared
 * texture manager, tracked under an id of its own. A card without an icon gives it no record,
 * and draws a stand-in square in the shape pass instead. List it right after
 * {@link LINK_PREVIEW_PASS}.
 */
export const LINK_ICON_PASS: ScenePassFactory = {
  name: LINK_ICON_PASS_NAME,
  create: (environment) => createLinkImagePass(ICON, environment),
};

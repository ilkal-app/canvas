import { useRef, type ReactElement, type ReactNode } from 'react';

import {
  isGradient,
  isImagePaint,
  resolveColor,
  type ImageFit,
  type ObjectId,
  type Paint,
  type Rgba,
} from '@canvas/schema';

import { ColourControl } from '../controls/colour-control.js';
import { useColourTokens } from '../controls/colour-tokens-context.js';
import controlStyles from '../controls/controls.module.css';
import { commonValue, MIXED, type Mixable } from '../controls/mixed-value.js';
import { useImageReplacer } from '../image-replacement-context.js';

import { GradientEditor } from './gradient-editor.js';
import { paintKindOf, switchPaintKind, PAINT_KINDS, type PaintKind } from './gradient-edits.js';
import { IMAGE_FITS, imagePaintFrom, withImageFit } from './image-paint-edits.js';
import { isSamePaint } from './paint-value.js';
import styles from './paint.module.css';

/**
 * An edit of one target's paint: given the paint it has, the paint it gets. The section applies
 * it to every selected object (or the tool's style) as one `setStyle`.
 */
export type PaintEdit = (paint: Paint | null) => Paint | null;

/** Props of {@link PaintControl}. */
export interface PaintControlProps {
  /** The field's name: "Fill", or a frame's "Background". */
  readonly label: string;
  /** Each target's paint (the selected objects', or the creation tool's), at least one. */
  readonly paints: readonly (Paint | null)[];
  /** Whether the field can be none: shows the solid colour's None toggle. */
  readonly canBeNone?: boolean;
  /** Receives one edit per committed change. */
  readonly onEdit: (edit: PaintEdit) => void;
  /**
   * The objects a chosen image is written to, where the field takes an image fill (a
   * selected shape's fill, a selected frame's background); absent elsewhere (paths, the tools'
   * styles). The upload's badge shows on them.
   */
  readonly imageTargets?: readonly ObjectId[] | undefined;
  /**
   * Enters crop mode on the one target's image fill; absent where its crop cannot be
   * edited (more than one target, a locked one).
   */
  readonly onCrop?: (() => void) | undefined;
}

/** What each kind's button is called; the accessible names are the acceptance contract. */
const KIND_LABELS: Readonly<Record<PaintKind, string>> = {
  solid: 'Solid',
  linear: 'Linear',
  radial: 'Radial',
  image: 'Image',
};

/**
 * A colour chosen for a target, keeping the target's own alpha where it has a solid colour: a
 * colour picked for a mixed selection sets the hue alone (the picker has no alpha). Over a
 * gradient, none or a colour token the colour is set as chosen (a detached token's own alpha).
 *
 * @param colour - The colour chosen.
 * @param own - The target's paint now.
 * @returns The colour to set.
 */
export function withOwnAlpha(colour: Rgba, own: Paint | null): Rgba {
  return Array.isArray(own) ? [colour[0], colour[1], colour[2], own[3]] : colour;
}

/** What each image fit's button is called; the accessible names are the contract. */
const FIT_LABELS: Readonly<Record<ImageFit, string>> = {
  fill: 'Fill',
  fit: 'Fit',
  crop: 'Crop',
  tile: 'Tile',
};

/** Props of {@link PaintKindControl}. */
interface PaintKindControlProps {
  readonly label: string;
  readonly kinds: readonly PaintKind[];
  readonly kind: Mixable<PaintKind>;
  readonly onKind: (kind: PaintKind) => void;
}

/**
 * The segmented Solid | Linear | Radial (| Image) control; none pressed when the targets' kinds
 * differ. A press keeps the focus where it was.
 *
 * @param props - The field's name, the kinds offered, the shared kind and the handler.
 * @returns The group.
 */
function PaintKindControl(props: PaintKindControlProps): ReactElement {
  const { label, kinds, kind, onKind } = props;
  return (
    <div className={styles.kinds} role="group" aria-label={`Kind of ${label.toLowerCase()}`}>
      {kinds.map((each) => (
        <button
          key={each}
          type="button"
          className={controlStyles.toggle}
          aria-pressed={kind === each}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            onKind(each);
          }}
        >
          {KIND_LABELS[each]}
        </button>
      ))}
    </div>
  );
}

/** Props of {@link ImageFillControls}. */
interface ImageFillControlsProps {
  readonly label: string;
  readonly fit: Mixable<ImageFit>;
  readonly onFit: (fit: ImageFit) => void;
  /** Opens the file picker; absent where no image can be chosen. */
  readonly onReplace: (() => void) | undefined;
  /** Enters crop mode on the image fill; absent where it cannot be cropped. */
  readonly onCrop: (() => void) | undefined;
}

/**
 * An image fill's controls: the segmented Fill | Fit | Crop | Tile control (none
 * pressed when the targets' fits differ), "Replace image…" where an image can be chosen and
 * "Crop image…" where the one target's crop can be edited.
 *
 * @param props - The field's name, the shared fit and the handlers.
 * @returns The controls.
 */
function ImageFillControls(props: ImageFillControlsProps): ReactElement {
  const { label, fit, onFit, onReplace, onCrop } = props;
  return (
    <>
      <div className={styles.kinds} role="group" aria-label={`Image fit of ${label.toLowerCase()}`}>
        {IMAGE_FITS.map((each) => (
          <button
            key={each}
            type="button"
            className={controlStyles.toggle}
            aria-pressed={fit === each}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onFit(each);
            }}
          >
            {FIT_LABELS[each]}
          </button>
        ))}
      </div>
      {onReplace !== undefined && (
        <button type="button" className={controlStyles.button} onClick={onReplace}>
          Replace image…
        </button>
      )}
      {onCrop !== undefined && (
        <button type="button" className={controlStyles.button} onClick={onCrop}>
          Crop image…
        </button>
      )}
    </>
  );
}

/** The Image kind's file picker: its opener and its hidden input. */
interface ImagePicker {
  /** Opens the file picker; undefined where no image can be chosen. */
  readonly choose: (() => void) | undefined;
  /** The hidden file input, or nothing. */
  readonly input: ReactNode;
}

/**
 * The Image kind's file picker: where the page has images and the field has targets,
 * a hidden file input whose chosen image the page's images read and upload
 * (`PageImages.replace`), written to each target as one `onEdit` (`imagePaintFrom`), the
 * upload's badge on the targets.
 *
 * @param label - The field's name.
 * @param imageTargets - The objects the image is written to, or undefined.
 * @param onEdit - The field's edit handler.
 * @returns The picker.
 */
function useImagePicker(
  label: string,
  imageTargets: readonly ObjectId[] | undefined,
  onEdit: (edit: PaintEdit) => void,
): ImagePicker {
  const replace = useImageReplacer();
  const picker = useRef<HTMLInputElement>(null);
  if (replace === undefined || imageTargets === undefined || imageTargets.length === 0) {
    return { choose: undefined, input: null };
  }
  const input = (
    <input
      ref={picker}
      type="file"
      accept="image/*"
      aria-label={`Choose image for ${label.toLowerCase()}`}
      tabIndex={-1}
      hidden
      onChange={(event) => {
        const [file] = event.currentTarget.files ?? [];
        event.currentTarget.value = '';
        if (file === undefined) return;
        replace(file, (asset) => {
          onEdit((paint) => imagePaintFrom(asset, paint));
          return imageTargets;
        });
      }}
    />
  );
  return {
    choose: () => {
      picker.current?.click();
    },
    input,
  };
}

/**
 * A fill field that takes gradients and, for selected shapes and frames,
 * images: the Solid | Linear | Radial | Image control, then the solid colour (with
 * None), the gradient editor or the image fill's fit and "Replace image…". Switching kind keeps
 * what it can (`switchPaintKind`); Image opens the file picker, and the image chosen is read and
 * uploaded by the page's images (`PageImages.replace`) and written as a whole-image fill
 * (`imagePaintFrom`). Image is offered only with `imageTargets` and where the page has images;
 * a target already filled with an image shows it pressed. With targets whose paints differ the
 * field shows "Mixed" and a kind, colour or fit chosen applies to each target from its own
 * paint. Every committed change is one `onEdit`, which the section applies as one `setStyle`:
 * one undo step. The solid colour offers the board's colour tokens (a fill or a
 * background may name one, never the `ink` literal), and a token made a gradient starts from its
 * value in the mode shown.
 *
 * @param props - The label, the targets' paints, the edit handler and the image targets.
 * @returns The control.
 */
export function PaintControl(props: PaintControlProps): ReactElement {
  const { label, paints, canBeNone = false, onEdit, imageTargets } = props;
  const { choose, input } = useImagePicker(label, imageTargets, onEdit);
  const { table, mode } = useColourTokens();
  const value = commonValue(paints, (paint) => paint, isSamePaint) ?? null;
  const kind = commonValue(paints, paintKindOf) ?? 'solid';
  const gradient = value !== MIXED && isGradient(value) ? value : undefined;
  // A colour or a token shows as itself; a gradient or an image fill has no one colour.
  const colour = value === MIXED || isGradient(value) || isImagePaint(value) ? MIXED : value;
  const isMixedGradient =
    kind !== 'solid' && kind !== 'image' && kind !== MIXED && gradient === undefined;
  const kinds: readonly PaintKind[] =
    choose !== undefined || kind === 'image' ? [...PAINT_KINDS, 'image'] : PAINT_KINDS;
  const fit = commonValue(paints, (paint) => (isImagePaint(paint) ? paint.fit : undefined));
  return (
    <div className={styles.paint}>
      <PaintKindControl
        label={label}
        kinds={kinds}
        kind={kind}
        onKind={(chosen) => {
          if (chosen === 'image') {
            if (kind !== 'image') choose?.();
            return;
          }
          onEdit((paint) =>
            switchPaintKind(paint, chosen, (token) => resolveColor(token, mode, table)),
          );
        }}
      />
      {(kind === 'solid' || kind === MIXED) && (
        <ColourControl
          label={label}
          value={kind === MIXED ? MIXED : colour}
          canBeNone={canBeNone}
          onChange={(chosen) => {
            onEdit((paint) => (chosen === null ? null : withOwnAlpha(chosen, paint)));
          }}
          onToken={(token) => {
            onEdit(() => token);
          }}
        />
      )}
      {gradient !== undefined && (
        <GradientEditor
          gradient={gradient}
          onChange={(edited) => {
            onEdit(() => edited);
          }}
        />
      )}
      {isMixedGradient && <p className={styles.mixed}>Mixed</p>}
      {kind === 'image' && (
        <ImageFillControls
          label={label}
          fit={fit ?? MIXED}
          onFit={(chosen) => {
            onEdit((paint) => withImageFit(paint, chosen));
          }}
          onReplace={choose}
          onCrop={props.onCrop}
        />
      )}
      {input}
    </div>
  );
}

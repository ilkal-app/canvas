// The label box's geometry and placement live in @canvas/text, which measures labels for agents
// and places them for the vector export too.
export {
  LABEL_PADDING,
  LABEL_PADDING_FRACTION,
  labelPaddingOf,
  shapeLabelBox,
  shapeLabelPlacement,
} from '@canvas/text';
export type { ShapeLabelRect } from '@canvas/text';

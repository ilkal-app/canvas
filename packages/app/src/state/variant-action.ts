import type { ObjectId, OverrideRecord, VariantAxis } from '@canvas/schema';

/**
 * A component command on a variant set from the inspector: an instance's choice, a
 * main's axes, a preset's records, each one document command and so one undo step; and the
 * canvas preview of a preset, which writes nothing.
 */
export type VariantComponentAction =
  | {
      /** A component command. */
      readonly type: 'component';
      /** Choose an instance's value per axis (`setInstanceVariant`). */
      readonly command: 'setVariant';
      /** The instance. */
      readonly id: ObjectId;
      /** The values chosen, by axis; `null` goes back to the axis default. */
      readonly variant: Readonly<Record<string, string | null>>;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Replace a main's variant axes (`setVariantAxes`). */
      readonly command: 'setVariantAxes';
      /** The main. */
      readonly id: ObjectId;
      /** The whole new list; `null` removes variants. */
      readonly axes: readonly VariantAxis[] | null;
      /** Renames, so presets and instances' choices follow (axis names in `values` are new). */
      readonly renames?: {
        /** Axes renamed. */
        readonly axes?: readonly {
          /** The axis's old name. */
          readonly from: string;
          /** Its new name. */
          readonly to: string;
        }[];
        /** Values renamed. */
        readonly values?: readonly {
          /** The axis's new name. */
          readonly axis: string;
          /** The value's old name. */
          readonly from: string;
          /** Its new name. */
          readonly to: string;
        }[];
      };
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Set fields of one child in one axis value's preset (`setVariantPreset`). */
      readonly command: 'setPreset';
      /** The main. */
      readonly id: ObjectId;
      /** The axis. */
      readonly axis: string;
      /** Its value whose preset is edited. */
      readonly value: string;
      /** The child's path in the main. */
      readonly path: string;
      /** The fields to set; the record's others are kept. */
      readonly override: OverrideRecord;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /**
       * Preview a main in one axis value's preset on the canvas, writing nothing; the
       * preview is replaced by the next, and cleared without an axis and value.
       */
      readonly command: 'previewPreset';
      /** The main. */
      readonly id: ObjectId;
      /** The axis; none clears the preview. */
      readonly axis?: string;
      /** Its value whose preset is previewed. */
      readonly value?: string;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Clear one axis value's preset, one child's record of it, or some fields. */
      readonly command: 'resetPreset';
      /** The main. */
      readonly id: ObjectId;
      /** The axis. */
      readonly axis: string;
      /** Its value whose preset is reset. */
      readonly value: string;
      /** The child's path; every child's when absent. */
      readonly path?: string;
      /** The fields to clear; all of them when absent. */
      readonly fields?: readonly (keyof OverrideRecord)[];
    };

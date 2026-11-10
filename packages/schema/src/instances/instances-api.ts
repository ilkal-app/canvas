// The component and instance area's public API (instances, overrides and their layout),
// re-exported by the package entry, src/index.ts, which would otherwise pass 400 lines.
export { MAX_INSTANCES, MAX_INSTANCE_DEPTH } from './instance-limits.js';
export { INSTANCE_SCALE_MAX, INSTANCE_SCALE_MIN } from '../objects/instance-object.js';
export { scaledObject } from '../geometry/scaled-object.js';
export { INSTANCE_SCALE_VERSION } from '../version/schema-version.js';
export {
  instanceOverridesSchema,
  overridePathSchema,
  overrideFieldsSchema,
  overrideRecordSchema,
  overrideRunsIssues,
  instanceOverrideFieldsSchema,
  textStyleOverrideSchema,
} from './instance-overrides.js';
export type { InstanceOverrides, OverrideRecord, TextStyleOverride } from './instance-overrides.js';
export { resolveInstance, virtualObjectId } from './resolve-instance.js';
export type { ResolvedInstance } from './resolve-instance.js';
export { resolveInstanceChild } from './resolve-instance-child.js';
export type {
  HiddenInstanceChild,
  ResolvedInstanceChild,
  ShownInstanceChild,
} from './resolve-instance-child.js';
export { instanceReferenceProblems } from './instance-references.js';
export type { InstanceReferenceIssue, InstanceReferenceProblem } from './instance-references.js';
export { definitionContent } from './definition-content.js';
export {
  applyInstanceOverride,
  editableOverrideFields,
  instanceOverrideFields,
} from './override-content.js';
export { constrainChildren } from './constrain-children.js';
export {
  autoLayoutTree,
  laidInstanceSize,
  unscaledInstance,
  type LayoutReader,
} from './instance-layout.js';
export {
  hasGeometry,
  variantSizedAxes,
  withRecordGeometry,
  type DrawnMain,
  type VariantSizedAxes,
} from './preset-geometry.js';

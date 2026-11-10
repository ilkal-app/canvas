/**
 * The label of a pass's page-count variant pipeline (`pageShaderVariants`).
 *
 * @param passName - The pass's name, its own pipeline's label.
 * @param pageSlots - The page slots the variant covers.
 * @returns The variant pipeline's label.
 */
export function pageVariantPipelineLabel(passName: string, pageSlots: number): string {
  return `${passName} ${String(pageSlots)} pages`;
}

/**
 * Whether a pipeline is a pass's instanced pipeline: its own, labelled with the pass's name, or
 * one of its page-count variants (`pageVariantPipelineLabel`). A test counting a
 * pass's draws by the bound pipeline's label must count both.
 *
 * @param label - The bound pipeline's label.
 * @param passName - The pass's name.
 * @returns Whether the pipeline draws the pass's instances.
 */
export function isPassPipelineLabel(label: string, passName: string): boolean {
  if (label === passName) return true;
  const suffix = label.startsWith(`${passName} `) ? label.slice(passName.length + 1) : '';
  return /^\d+ pages$/.test(suffix);
}

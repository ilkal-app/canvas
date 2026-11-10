// The schema's template exports: the metadata registry and its helpers, and the
// documents' accessor, re-exported by the package entry.
export {
  LEARNING_TEMPLATE,
  searchTemplates,
  seedableTemplateById,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  templateById,
  templatesFor,
  templatesIn,
} from './templates.js';
export type { Template, TemplateCategory, TemplateCategoryId } from './templates.js';
export { templateDocument } from './documents/index.js';

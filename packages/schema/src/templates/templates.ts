// The board templates' metadata: what the New board dialog lists and the boards service
// checks. The documents live apart (`./documents/`), so this module never pulls them in.
import type { BoardMode } from '../board/board-modes.js';

/** A template category's id. */
export type TemplateCategoryId =
  'meetings-retros' | 'brainstorming' | 'planning' | 'diagrams-flows' | 'research-mapping';

/** A template category, as the New board dialog lists it. */
export interface TemplateCategory {
  /** Its id. */
  readonly id: TemplateCategoryId;
  /** Its display name. */
  readonly name: string;
}

/** The template categories, in the dialog's order. */
export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  { id: 'meetings-retros', name: 'Meetings & retros' },
  { id: 'brainstorming', name: 'Brainstorming' },
  { id: 'planning', name: 'Planning' },
  { id: 'diagrams-flows', name: 'Diagrams & flows' },
  { id: 'research-mapping', name: 'Research & mapping' },
];

/** A template's metadata. */
export interface Template {
  /** Its stable kebab-case id. */
  readonly id: string;
  /** Its display name. */
  readonly name: string;
  /** Its category. */
  readonly category: TemplateCategoryId;
  /** The mode of the boards it creates. */
  readonly mode: BoardMode;
  /**
   * The ids of the switch flags that must all be on for a person to use it; always `templates`.
   * Plain strings: the flag registry is private (`@canvas/plans`).
   */
  readonly requires: readonly string[];
}

/** The ids, names and categories of the owner-approved templates, in the dialog's order. */
const APPROVED = [
  ['brainstorm', 'Brainstorm', 'brainstorming'],
  ['retrospective', 'Retrospective', 'meetings-retros'],
  ['daily-standup', 'Daily standup', 'meetings-retros'],
  ['prioritisation-matrix', 'Prioritisation matrix', 'planning'],
  ['kanban', 'Kanban', 'planning'],
  ['user-journey-map', 'User journey map', 'research-mapping'],
  ['quarterly-roadmap', 'Quarterly roadmap', 'planning'],
  ['mind-map', 'Mind map', 'brainstorming'],
  ['affinity-map', 'Affinity map', 'research-mapping'],
  ['swot', 'SWOT analysis', 'planning'],
  ['meeting-agenda', 'Meeting agenda', 'meetings-retros'],
  ['flowchart-starter', 'Flowchart', 'diagrams-flows'],
] as const satisfies readonly (readonly [string, string, TemplateCategoryId])[];

/**
 * Every template, in the dialog's order: the 12 the owner approved, each a whiteboard
 * that needs only the `templates` flag. Every helper takes the list
 * as an argument, so tests pass their own.
 */
export const TEMPLATES: readonly Template[] = APPROVED.map(([id, name, category]) => ({
  id,
  name,
  category,
  mode: 'whiteboard',
  requires: ['templates'],
}));

/**
 * The templates a person may use: those whose required flags are all on (each a switch), in the
 * list's order; none when `templates` is off, since every template requires it. Pure.
 *
 * @param features - The person's flags, each id to its value; a flag is on only when `true`.
 * @param list - The templates; {@link TEMPLATES} by default.
 * @returns A new list of those the person may use.
 */
export function templatesFor<T extends Template>(
  features: Readonly<Record<string, boolean | string>>,
  list: readonly T[] = TEMPLATES as readonly T[],
): T[] {
  return list.filter((template) => template.requires.every((id) => features[id] === true));
}

/**
 * Folds text for a search: lower case, without accents (canonical decomposition with its
 * combining marks dropped), so "RETRO" finds "Rétrospective".
 *
 * @param text - The text.
 * @returns The folded text.
 */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Each category's display name, by id. */
const CATEGORY_NAMES = Object.fromEntries(
  TEMPLATE_CATEGORIES.map((category) => [category.id, category.name]),
) as Readonly<Record<TemplateCategoryId, string>>;

/**
 * The templates a search finds: those where every word of the query appears in the template's
 * name or its category's display name, ignoring case and accents, in the list's order. An empty
 * or blank query finds them all. Pure.
 *
 * @param list - The templates.
 * @param query - The search text.
 * @returns A new list of the matching templates.
 */
export function searchTemplates<T extends Template>(list: readonly T[], query: string): T[] {
  const words = folded(query)
    .split(/\s+/u)
    .filter((word) => word !== '');
  return list.filter((template) => {
    const haystack = folded(`${template.name} ${CATEGORY_NAMES[template.category]}`);
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The templates of one category, in the list's order; `all` keeps every one. Pure.
 *
 * @param list - The templates.
 * @param category - A category's id, or `all`.
 * @returns A new list of the templates in it.
 */
export function templatesIn<T extends Template>(
  list: readonly T[],
  category: TemplateCategoryId | 'all',
): T[] {
  return list.filter((template) => category === 'all' || template.category === category);
}

/**
 * A template by its id. Pure.
 *
 * @param id - The id, untrusted (a request's `templateId`).
 * @param list - The templates; {@link TEMPLATES} by default.
 * @returns The template, or undefined for an id no template has.
 */
export function templateById<T extends Template>(
  id: string,
  list: readonly T[] = TEMPLATES as readonly T[],
): T | undefined {
  return list.find((template) => template.id === id);
}

/**
 * The learning board's template: "Learn the basics", the 60-second tour the home page's
 * Get started checklist opens. It is not one of {@link TEMPLATES}, so neither the New board dialog
 * nor a creation from a template can use it; the boards service makes each person's copy itself
 * (`POST /api/me/learning-board`). No flag gates it. Its category is never shown.
 */
export const LEARNING_TEMPLATE: Template = {
  id: 'learn-the-basics',
  name: 'Learn the basics',
  category: 'brainstorming',
  mode: 'whiteboard',
  requires: [],
};

/**
 * A template a board may be seeded from: one of {@link TEMPLATES}, or
 * {@link LEARNING_TEMPLATE}. The relay seeds by it; the boards service still checks a creation's
 * `templateId` with {@link templateById}, so the learning template has only its own door. Pure.
 *
 * @param id - The id, untrusted.
 * @returns The template, or undefined for an id no seedable template has.
 */
export function seedableTemplateById(id: string): Template | undefined {
  return id === LEARNING_TEMPLATE.id ? LEARNING_TEMPLATE : templateById(id);
}

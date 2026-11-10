// The learning board is seedable but stays outside the public template catalog.
// Its portable document teaches the four first-run actions in a bounded board.
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

import type { Template } from './templates.js';

const LEARNING_ID = 'learn-the-basics';
const exports = schema as Record<string, unknown>;

describe('learning template', () => {
  it('exports ungated whiteboard metadata outside the New board catalog', () => {
    expect(exports.LEARNING_TEMPLATE).toMatchObject({
      id: LEARNING_ID,
      name: 'Learn the basics',
      mode: 'whiteboard',
      requires: [],
    });
    expect(schema.TEMPLATES.map(({ id }) => id)).not.toContain(LEARNING_ID);
    expect(schema.templateById(LEARNING_ID)).toBeUndefined();
    expect(schema.templatesFor({ templates: true }).map(({ id }) => id)).not.toContain(LEARNING_ID);
    expect(
      schema.searchTemplates(schema.TEMPLATES, 'Learn the basics').map(({ id }) => id),
    ).not.toContain(LEARNING_ID);
  });

  it('looks up every seedable template and refuses an unknown id', () => {
    const lookup = exports.seedableTemplateById as
      ((id: string) => Template | undefined) | undefined;
    expect(lookup).toBeTypeOf('function');
    expect(lookup?.(LEARNING_ID)).toEqual(exports.LEARNING_TEMPLATE);
    for (const template of schema.TEMPLATES) expect(lookup?.(template.id)).toEqual(template);
    expect(lookup?.('missing-template')).toBeUndefined();
  });

  it('imports a small document with one named root frame and tour content', () => {
    const document = schema.templateDocument(LEARNING_ID);
    expect(document).toBeDefined();
    if (document === undefined) return;
    expect(document.objects.length).toBeGreaterThan(0);
    expect(document.objects.length).toBeLessThanOrEqual(80);
    const board = schema.importBoard(document);
    expect(schema.validateBoard(board)).toEqual([]);
    expect(board.objects.size).toBe(document.objects.length);
    const objects = [...board.objects.values()];
    expect(objects.filter(({ parentId }) => parentId === null)).toEqual([
      expect.objectContaining({ type: 'frame', name: 'Learn the basics' }),
    ]);
    expect(objects.filter(({ type }) => type === 'sticky').length).toBeGreaterThanOrEqual(4);
    expect(objects.filter(({ type }) => type === 'connector').length).toBeGreaterThanOrEqual(3);
    const words = objects
      .filter((object) => object.type === 'sticky' || object.type === 'text')
      .map((object) => object.text)
      .join(' ');
    for (const word of ['sticky', 'connect', 'comment', 'share'])
      expect(words.toLowerCase()).toContain(word);
  });
});

import { describe, expect, it } from 'vitest';

import { importBoard, TEMPLATES, templateDocument, validateBoard } from '../index.js';

const EXPECTED = [
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
] as const;

describe('approved template registry', () => {
  it('lists exactly the 12 approved ids, names and categories in dialog order', () => {
    expect(TEMPLATES.map(({ id, name, category }) => [id, name, category])).toEqual(EXPECTED);
  });

  it.each(EXPECTED)('%s is a whiteboard gated only by templates', (id) => {
    const template = TEMPLATES.find((entry) => entry.id === id);
    expect(template).toBeDefined();
    expect(template?.mode).toBe('whiteboard');
    expect(template?.requires).toEqual(['templates']);
  });

  it.each(EXPECTED)(
    '%s imports as a valid, seedable document beneath one named frame',
    (id, name) => {
      const document = templateDocument(id);
      expect(document, id).toBeDefined();
      if (document === undefined) return;
      expect(document.objects.length).toBeGreaterThan(0);
      expect(document.objects.length).toBeLessThan(500);
      expect(document.tokens ?? []).toEqual([]);
      expect(document.textStyles ?? []).toEqual([]);
      expect(document.effectStyles ?? []).toEqual([]);
      expect(
        document.objects.some(({ type }) =>
          ['image', 'video', 'component', 'instance'].includes(type),
        ),
      ).toBe(false);
      expect(JSON.stringify(document)).not.toContain('template:');

      const board = importBoard(document);
      expect(validateBoard(board)).toEqual([]);
      expect(board.objects.size).toBe(document.objects.length);
      const roots = [...board.objects.values()].filter(({ parentId }) => parentId === null);
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ type: 'frame', name });
    },
  );
});

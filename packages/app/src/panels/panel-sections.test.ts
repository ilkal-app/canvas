import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, ObjectType } from '@canvas/schema';
import { TOOL_IDS } from '@canvas/tools';

import { DEFAULT_STYLE_PANEL_SECTIONS } from './default-style-sections.js';
import {
  createStylePanelRegistry,
  isStylePanelSection,
  panelContextOf,
  registerStylePanelSection,
  sectionsForContext,
  selectionContextOf,
  SELECTION_CONTEXTS,
  TOOL_CONTEXTS,
  type SelectionContext,
  type StylePanelSection,
} from './panel-sections.js';

/** A board of one object per type, each id its type. */
const BOARD = {
  get: (id: ObjectId): BoardObject | undefined =>
    id === ('missing' as ObjectId) ? undefined : ({ id, type: id } as unknown as BoardObject),
};

function contextOf(...types: string[]): SelectionContext {
  return selectionContextOf(types as ObjectId[], BOARD);
}

function section(id: string, order: number, context: StylePanelSection['context']) {
  return { id, title: id, order, context, render: () => null } satisfies StylePanelSection;
}

describe('selectionContextOf', () => {
  it('is none for an empty selection or one nothing of which can be read', () => {
    expect(contextOf()).toBe('none');
    expect(contextOf('missing')).toBe('none');
  });

  it.each<[ObjectType, SelectionContext]>([
    ['text', 'text'],
    ['sticky', 'note'],
    ['path', 'vector'],
    ['shape', 'shape'],
    ['line', 'line'],
    ['connector', 'line'],
    ['image', 'image'],
    ['video', 'mixed'],
    ['group', 'group'],
    ['frame', 'frame'],
    ['comment', 'mixed'],
    ['component', 'component'],
    ['instance', 'instance'],
  ])('gives a %s the %s context', (type, context) => {
    expect(contextOf(type)).toBe(context);
  });

  it('keeps a context every selected object shares, lines and connectors alike', () => {
    expect(contextOf('text', 'text')).toBe('text');
    expect(contextOf('line', 'connector')).toBe('line');
    expect(contextOf('shape', 'missing', 'shape')).toBe('shape');
  });

  it('is mixed for objects of two contexts', () => {
    expect(contextOf('text', 'sticky')).toBe('mixed');
    expect(contextOf('shape', 'frame')).toBe('mixed');
    expect(contextOf('frame', 'shape')).toBe('mixed');
  });
});

describe('panelContextOf', () => {
  it('shows the selection when there is one', () => {
    expect(panelContextOf('shape', 'text')).toBe('shape');
  });

  it("shows a creation tool's context when nothing is selected", () => {
    expect(panelContextOf('none', 'sticky')).toBe('note');
    expect(panelContextOf('none', 'select')).toBe('none');
  });

  it('knows the context of every tool', () => {
    for (const tool of TOOL_IDS) expect(SELECTION_CONTEXTS).toContain(TOOL_CONTEXTS[tool]);
  });
});

describe('the style panel registry', () => {
  it('keeps sections by order, then id, without changing the registry it was given', () => {
    const empty = createStylePanelRegistry();
    const registry = [
      section('b', 2, 'text'),
      section('c', 1, 'text'),
      section('a', 2, 'text'),
    ].reduce(registerStylePanelSection, empty);
    expect(registry.sections.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
    expect(empty.sections).toEqual([]);
  });

  it('refuses a second section with the same id', () => {
    const registry = registerStylePanelSection(createStylePanelRegistry(), section('a', 1, 'text'));
    expect(() => registerStylePanelSection(registry, section('a', 2, 'note'))).toThrow(
      'A style panel section "a" is already registered.',
    );
  });

  it('lists the sections of a context, one context or several', () => {
    const registry = [
      section('text-only', 1, 'text'),
      section('both', 2, ['text', 'mixed']),
    ].reduce(registerStylePanelSection, createStylePanelRegistry());
    expect(sectionsForContext(registry, 'text').map(({ id }) => id)).toEqual(['text-only', 'both']);
    expect(sectionsForContext(registry, 'mixed').map(({ id }) => id)).toEqual(['both']);
    expect(sectionsForContext(registry, 'none')).toEqual([]);
  });

  it('recognises a section by its shape', () => {
    expect(isStylePanelSection(section('a', 1, ['text']))).toBe(true);
    expect(isStylePanelSection(null)).toBe(false);
    expect(isStylePanelSection('a')).toBe(false);
    expect(isStylePanelSection({ ...section('a', 1, 'text'), render: 'no' })).toBe(false);
    expect(isStylePanelSection({ ...section('a', 1, 'text'), context: 3 })).toBe(false);
  });

  it('finds the section files the shell ships, each one well formed', () => {
    for (const shipped of DEFAULT_STYLE_PANEL_SECTIONS) {
      expect(isStylePanelSection(shipped), shipped.id).toBe(true);
    }
  });
});

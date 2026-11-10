// @vitest-environment jsdom
// The style panel's text section in jsdom, alone, as the panel mounts it, and over the engine's
// document side (one command per committed edit). In Chrome, driving the text being edited:
// tooling/scenario/specs/tools/text-edit.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { setUpTextDocument } from '../../engine/__fixtures__/text-document.js';
import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { DEFAULT_TEXT_STYLE, FONT_FAMILIES } from '../../text-input/font-catalogue.js';
import type { StylePanelSectionProps } from '../panel-sections.js';
import { TextStyleProvider } from '../text-style-control.js';

import { stylePanelSection, TextStyleSection } from './text-style-section.js';

const [FIRST_FAMILY = '', SECOND_FAMILY = ''] = FONT_FAMILIES.map(({ family }) => family);

/** Every field shared: 24 px bold red text in the first family, centred. */
const SHARED: TextStyleContext = {
  style: {
    fontFamily: FIRST_FAMILY,
    fontSize: 24,
    weight: 700,
    italic: false,
    color: [1, 0, 0, 1],
  },
  align: 'center',
  isEditing: true,
};

/** What the panel passes a section with nothing selected and no creation tool. */
const SECTION_PROPS = {
  defaults: undefined,
  applyStyle: () => undefined,
} as unknown as StylePanelSectionProps;

/** Every field mixed. */
const MIXED: TextStyleContext = { style: {}, align: undefined, isEditing: false };

function renderSection(context: TextStyleContext) {
  const onChange = vi.fn<(change: TextStyleChange) => void>();
  render(<TextStyleSection context={context} onChange={onChange} />);
  return onChange;
}

/**
 * Types into an input as the browser does, one `input` event per keystroke, and commits it
 * once, as leaving the field or Enter does (`change`).
 *
 * @param input - The input.
 * @param values - Its value after each keystroke, the last committed.
 */
function typeAndCommit(input: HTMLElement, values: readonly string[]): void {
  for (const value of values) {
    (input as HTMLInputElement).value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(cleanup);

describe('the text style section', () => {
  it('registers for the text context, and shows a hint while no text is targeted', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'text-style',
      title: 'Text',
      context: ['text', 'note', 'shape'],
    });
    render(<stylePanelSection.render {...SECTION_PROPS} />);
    expect(screen.getByText('Click the board to add text, or select a text.')).toBeDefined();
    expect(screen.queryByLabelText('Font')).toBeNull();
  });

  it('says how to add a label for shapes, and edits the shape tool’s label style without alignment', () => {
    const applyStyle = vi.fn();
    const { unmount } = render(<stylePanelSection.render {...SECTION_PROPS} context="shape" />);
    expect(screen.getByText('Double-click a shape to add a label.')).toBeDefined();
    unmount();
    const defaults = { textStyle: { fontSize: 18 } };
    render(
      <stylePanelSection.render
        {...SECTION_PROPS}
        context="shape"
        defaults={defaults}
        applyStyle={applyStyle}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Size').value).toBe('18');
    expect(screen.queryByLabelText('Text left')).toBeNull();
    expect(screen.getByLabelText('Bold')).toBeDefined();
  });

  it('shows and changes the text the shell provides', () => {
    const onChange = vi.fn<(change: TextStyleChange) => void>();
    render(
      <TextStyleProvider value={{ context: SHARED, onChange }}>
        <stylePanelSection.render {...SECTION_PROPS} />
      </TextStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'style', patch: { italic: true } });
  });

  it('edits the text tool’s defaults while the tool is active and no text is targeted', () => {
    const applyStyle = vi.fn();
    const props = {
      ...SECTION_PROPS,
      defaults: { textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 30 }, align: 'right' },
      applyStyle,
    } as StylePanelSectionProps;
    render(<stylePanelSection.render {...props} />);
    expect(screen.getByLabelText<HTMLInputElement>('Size').value).toBe('30');
    const right = screen.getByRole('button', { name: 'Text right' });
    expect(right.getAttribute('aria-pressed')).toBe('true');
    typeAndCommit(screen.getByLabelText('Size'), ['4', '48']);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text left' }));
    expect(applyStyle.mock.calls.map(([patch]) => patch as unknown)).toEqual([
      { textStyle: { fontSize: 48 } },
      { textStyle: { weight: 700 } },
      { align: 'left' },
    ]);
  });

  it('shows the shared fields of the targeted text', () => {
    renderSection(SHARED);
    expect(screen.getByLabelText<HTMLSelectElement>('Font').value).toBe(FIRST_FAMILY);
    expect(screen.getByLabelText<HTMLInputElement>('Size').value).toBe('24');
    expect(screen.getByLabelText<HTMLInputElement>('Colour').value).toBe('#ff0000');
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    const centre = screen.getByRole('button', { name: 'Text centre' });
    expect(centre.getAttribute('aria-pressed')).toBe('true');
    const left = screen.getByRole('button', { name: 'Text left' });
    expect(left.getAttribute('aria-pressed')).toBe('false');
  });

  it('offers Ink for the text colour, pressed for ink text, and sends it as a style change', () => {
    const onChange = renderSection(SHARED);
    const ink = screen.getByRole('button', { name: 'Ink' });
    expect(ink.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(ink);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'style', patch: { color: 'ink' } });
    cleanup();
    renderSection({ ...SHARED, style: { ...SHARED.style, color: 'ink' } });
    expect(screen.getByRole('button', { name: 'Ink' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Colour').value).toBe('#1e1f1c');
  });

  it('shows mixed fields as mixed', () => {
    const { container } = render(<TextStyleSection context={MIXED} onChange={() => undefined} />);
    expect(screen.getByLabelText<HTMLSelectElement>('Font').value).toBe('');
    expect(
      within(screen.getByLabelText('Font')).getByRole('option', { name: 'Mixed' }),
    ).toBeDefined();
    // The spacing fields and their units are mixed too.
    expect(screen.getByLabelText<HTMLInputElement>('Line height (mixed)').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Letter spacing (mixed)').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('Line height unit').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('Letter spacing unit').value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Size (mixed)').value).toBe('');
    expect(container.querySelector('[data-state="mixed"]')).not.toBeNull();
    for (const name of ['Bold', 'Italic', 'Text left', 'Text centre', 'Text right']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('mixed');
    }
  });

  it('sends each control’s committed change, and drops a size out of range', () => {
    const onChange = renderSection(SHARED);
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: SECOND_FAMILY } });
    typeAndCommit(screen.getByLabelText('Size'), ['3', '36']);
    typeAndCommit(screen.getByLabelText('Colour'), ['#0080ff']);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text right' }));
    typeAndCommit(screen.getByLabelText('Size'), ['9999']);
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { fontFamily: SECOND_FAMILY } },
      { kind: 'style', patch: { fontSize: 36 } },
      { kind: 'style', patch: { color: [0, 128 / 255, 1, 1] } },
      { kind: 'style', patch: { weight: 400 } },
      { kind: 'align', align: 'right' },
    ]);
  });
});

/**
 * Two text objects on the demo board, `text-1` ("ab") and `text-2` ("cd", at 40 px), the given
 * ones selected; the section rendered over the document side's text.
 *
 * @param selected - The ids to select.
 * @returns The history, the change sets counted from now, and the text objects' reader.
 * @throws {Error} When no text is targeted after selecting.
 */
function setUpSelectedTexts(selected: readonly string[]) {
  const fixture = setUpTextDocument();
  const { document: engineDocument, press, store, history } = fixture;
  for (const [y, characters] of [
    [20, 'ab'],
    [300, 'cd'],
  ] as const) {
    engineDocument.setActiveTool('text');
    press('pointerDown', 20, y);
    press('pointerUp', 20, y);
    engineDocument.tools.text.session()?.type(characters);
    engineDocument.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
  }
  engineDocument.tools.text.apply({ kind: 'style', patch: { fontSize: 40 } });
  engineDocument.selectTool.select(selected as ObjectId[]);
  history.stopCapturing();
  const context = engineDocument.tools.text.styleContext();
  if (context === undefined) throw new Error('No text is targeted.');
  render(
    <TextStyleSection
      context={context}
      onChange={(change) => engineDocument.tools.text.apply(change)}
    />,
  );
  const changeSets: unknown[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const text = (id: string) => store.get(id as ObjectId) as TextObject;
  return { history, changeSets, text };
}

describe('the text style section over the document', () => {
  it('writes a size typed as 1, 10, 100 once: one change set, one undo step', () => {
    const { history, changeSets, text } = setUpSelectedTexts(['text-1']);
    typeAndCommit(screen.getByLabelText('Size'), ['1', '10', '100']);
    expect(changeSets).toHaveLength(1);
    expect(text('text-1').runs[0]?.style.fontSize).toBe(100);
    history.undo();
    expect(text('text-1').runs[0]?.style.fontSize).toBe(DEFAULT_TEXT_STYLE.fontSize);
  });

  it('writes a colour dragged through the picker once, when it closes', () => {
    const { changeSets, text } = setUpSelectedTexts(['text-1']);
    typeAndCommit(screen.getByLabelText('Colour'), ['#100000', '#400000', '#800000', '#ff0000']);
    expect(changeSets).toHaveLength(1);
    expect(text('text-1').runs[0]?.style.color).toEqual([1, 0, 0, 1]);
  });

  it('restyles a selection of several texts as one command: one change set, one undo step', () => {
    const { history, changeSets, text } = setUpSelectedTexts(['text-1', 'text-2']);
    typeAndCommit(screen.getByLabelText('Size (mixed)'), ['1', '12']);
    expect(changeSets).toHaveLength(1);
    expect(text('text-2').runs[0]?.style.fontSize).toBe(12);
    history.undo();
    expect(text('text-1').runs[0]?.style.fontSize).toBe(DEFAULT_TEXT_STYLE.fontSize);
    expect(text('text-2').runs[0]?.style.fontSize).toBe(40);
  });

  it('shows a mixed size for the mixed selection, and a colour set writes only the colour', () => {
    const { text } = setUpSelectedTexts(['text-1', 'text-2']);
    expect(screen.getByLabelText<HTMLInputElement>('Size (mixed)').value).toBe('');
    typeAndCommit(screen.getByLabelText('Colour'), ['#00ff00']);
    expect(text('text-1').runs[0]?.style).toMatchObject({ fontSize: 24, color: [0, 1, 0, 1] });
    expect(text('text-2').runs[0]?.style).toMatchObject({ fontSize: 40, color: [0, 1, 0, 1] });
  });

  it('shows auto and no spacing, sends typed spacing in its unit and converts a unit change', () => {
    const spaced: TextStyleContext = {
      ...SHARED,
      style: {
        ...SHARED.style,
        letterSpacing: { value: 0, unit: 'percent' },
        lineHeight: 'auto',
      },
    };
    const onChange = renderSection(spaced);
    expect(screen.getByLabelText<HTMLInputElement>('Line height').value).toBe('125');
    expect(screen.getByLabelText<HTMLSelectElement>('Line height unit').value).toBe('auto');
    expect(screen.getByLabelText<HTMLInputElement>('Letter spacing').value).toBe('0');
    typeAndCommit(screen.getByLabelText('Letter spacing'), ['12']);
    typeAndCommit(screen.getByLabelText('Line height'), ['150']);
    fireEvent.change(screen.getByLabelText('Line height unit'), { target: { value: 'px' } });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { letterSpacing: { value: 12, unit: 'percent' } } },
      { kind: 'style', patch: { lineHeight: { value: 150, unit: 'percent' } } },
      { kind: 'style', patch: { lineHeight: { value: 30, unit: 'px' } } },
    ]);
  });

  it('passes an unchanged unit choice through while editing, so Enter hands focus back', () => {
    const editing: TextStyleContext = {
      ...SHARED,
      style: { ...SHARED.style, letterSpacing: { value: 2, unit: 'px' }, lineHeight: 'auto' },
    };
    const onChange = renderSection(editing);
    fireEvent.keyDown(screen.getByLabelText('Line height unit'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('Letter spacing unit'), { key: 'Escape' });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { lineHeight: 'auto' } },
      { kind: 'style', patch: { letterSpacing: { value: 2, unit: 'px' } } },
    ]);
  });

  it('hands focus back with an empty patch when a mixed field has nothing to convert', () => {
    const onChange = renderSection({ ...SHARED, style: { fontSize: 24 } });
    fireEvent.change(screen.getByLabelText('Line height unit'), { target: { value: 'px' } });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([{ kind: 'style', patch: {} }]);
  });

  it('offers the family’s weights, keeps a lacking weight, and sends the weight chosen', () => {
    const onChange = renderSection({ ...SHARED, style: { ...SHARED.style, weight: 600 } });
    const weight = screen.getByLabelText<HTMLSelectElement>('Weight');
    expect(weight.value).toBe('600');
    expect([...weight.options].map((option) => option.textContent)).toEqual([
      'Regular 400',
      'SemiBold 600 (nearest face)',
      'Bold 700',
    ]);
    fireEvent.change(weight, { target: { value: '400' } });
    expect(onChange.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'style', patch: { weight: 400 } },
    ]);
  });

  it('shows a mixed weight as mixed', () => {
    render(<TextStyleSection context={MIXED} onChange={() => undefined} />);
    expect(screen.getByLabelText<HTMLSelectElement>('Weight').value).toBe('');
  });
});

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';

/**
 * What the style panel's text section works on: the text style the engine reports
 * (`MountEngineOptions.onTextStyleChange`: the editing range or caret, or the selected text
 * objects) and where a change goes (`MountedEngine.applyTextStyle`). The text being edited lives
 * in the editor, not in the panel's selection props, so the shell's workspace provides it.
 */
export interface TextStyleControl {
  /** The targeted text's style, or undefined while no text is targeted. */
  readonly context: TextStyleContext | undefined;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/** Outside a provider, no text is targeted and changes go nowhere. */
const textStyleControl = createContext<TextStyleControl>({
  context: undefined,
  onChange: () => undefined,
});

/** Props of {@link TextStyleProvider}. */
export interface TextStyleProviderProps {
  /** The control the text section below reads. */
  readonly value: TextStyleControl;
  /** The panel. */
  readonly children: ReactNode;
}

/**
 * Provides the text section's control to the panel below it.
 *
 * @param props - The control and the panel.
 * @returns The provider.
 */
export function TextStyleProvider(props: TextStyleProviderProps): ReactElement {
  return (
    <textStyleControl.Provider value={props.value}>{props.children}</textStyleControl.Provider>
  );
}

/**
 * The text section's control, from the nearest {@link TextStyleProvider}.
 *
 * @returns The control.
 */
export function useTextStyleControl(): TextStyleControl {
  return useContext(textStyleControl);
}

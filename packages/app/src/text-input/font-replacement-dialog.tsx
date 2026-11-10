import { useState, useSyncExternalStore, type ReactElement } from 'react';

import { Button } from '../controls/button.js';
import { Dialog } from '../dialogs/dialog.js';

import { FontPicker } from './font-picker.js';
import styles from './font-replacement-dialog.module.css';
import {
  readFontReplacement,
  setFontReplacement,
  subscribeFontReplacement,
} from './font-replacement.js';

/**
 * An explicit font replacement choice, for one text or a family board-wide (
 * `scope: 'board'`); cancelling leaves words and runs untouched.
 *
 * @returns The active request, or nothing.
 */
export function FontReplacementDialog(): ReactElement | null {
  const request = useSyncExternalStore(subscribeFontReplacement, readFontReplacement);
  const [problem, setProblem] = useState('');
  if (request === undefined) return null;
  const isBoard = request.scope === 'board';
  const choose = async (family: string) => {
    setProblem('');
    const didChange = await request.replace(family);
    if (readFontReplacement() !== request) return;
    if (didChange) setFontReplacement(undefined);
    else setProblem('That font could not be applied. Choose another available font.');
  };
  return (
    <Dialog
      title={isBoard ? 'Replace a missing font' : 'Choose a font to edit this text'}
      width="narrow"
      compact="sheet"
      onClose={() => {
        setFontReplacement(undefined);
      }}
    >
      <div className={styles.body}>
        {isBoard ? (
          <p>
            Missing font: {request.families.join(', ')}. The font you choose replaces it everywhere
            on this board, for everyone, in one step you can undo. The words stay the same.
          </p>
        ) : (
          <p>
            Missing font: {request.families.join(', ')}. Choosing a replacement changes this text’s
            font for everyone. Its words stay the same.
          </p>
        )}
        <FontPicker
          value=""
          onChange={(family) => {
            void choose(family);
          }}
        />
        {problem && <p role="status">{problem}</p>}
        <Button
          onClick={() => {
            setFontReplacement(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

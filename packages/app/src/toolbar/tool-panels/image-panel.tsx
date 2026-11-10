import { useRef, useState, type ReactElement } from 'react';

import { Icon } from '../../icons/icon.js';
import type { ToolPanelChoiceCodec } from '../../state/tool-panel-choices.js';

import { useImagePanelActions, type ImagePanelActions } from './image-panel-actions.js';
import styles from './image-panel.module.css';
import { PANEL_ITEM } from './panel-controls.js';
import { defineToolPanel } from './tool-panel-contribution.js';

/** The Image panel keeps no choices: it places images, it styles nothing. */
type ImageChoices = Readonly<Record<string, never>>;

/** The Image panel's codec: nothing to keep, whatever was stored. */
const IMAGE_CHOICES: ToolPanelChoiceCodec<ImageChoices> = {
  id: 'image',
  defaults: {},
  parse: () => ({}),
};

/** What the panel says where images cannot be added (no assets service, or no canvas yet). */
export const IMAGE_PANEL_UNAVAILABLE = 'Images can’t be added here';

/** The link field's accessible name. */
export const IMAGE_LINK_LABEL = 'Image link';

/**
 * The From link field and its Add button, shown once From link is pressed (the design draws the
 * button alone): the field takes focus, Enter or Add asks for the link, and the field empties
 * once the image is placed; while asked, Add says so.
 *
 * @param props - The panel's actions.
 * @param props.actions - The panel's actions.
 * @returns The field.
 */
function LinkField(props: { readonly actions: ImagePanelActions }): ReactElement {
  const [url, setUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const add = (): void => {
    const link = url.trim();
    if (link === '' || isAdding) return;
    setIsAdding(true);
    void props.actions.fromLink(link).then((isPlaced) => {
      setIsAdding(false);
      if (isPlaced) setUrl('');
    });
  };
  return (
    <form
      className={styles.link}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        // Shown by pressing From link, for typing at once.
        autoFocus
        type="url"
        className={styles.field}
        aria-label={IMAGE_LINK_LABEL}
        placeholder="Paste an image link"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
        }}
      />
      <button
        type="submit"
        className={styles.action}
        aria-busy={isAdding}
        // Not `disabled`: a disabled item would take no focus and stop the panel's arrows.
        aria-disabled={url.trim() === ''}
        {...PANEL_ITEM}
      >
        {isAdding ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

/**
 * The Image panel's contents (the design's IMAGE card): Upload, which opens the file
 * picker, and From link, which shows the link field. Every image goes at the view's centre. The
 * design's Recent row is left out of v1 (of 2026-10-21).
 *
 * @returns The contents.
 */
function ImagePanelContents(): ReactElement {
  const actions = useImagePanelActions();
  if (actions === undefined) return <span className={styles.hint}>{IMAGE_PANEL_UNAVAILABLE}</span>;
  return <ImagePanelControls actions={actions} />;
}

/**
 * The panel's controls once images can be added.
 *
 * @param props - The panel's actions.
 * @param props.actions - The panel's actions.
 * @returns The controls.
 */
function ImagePanelControls(props: { readonly actions: ImagePanelActions }): ReactElement {
  const { actions } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        multiple
        hidden
        aria-label="Images to upload"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) actions.upload(files);
        }}
      />
      <button
        type="button"
        className={[styles.action, styles.upload].join(' ')}
        {...PANEL_ITEM}
        onClick={() => {
          fileInput.current?.click();
        }}
      >
        <Icon name="upload" />
        Upload
      </button>
      <button
        type="button"
        className={styles.action}
        aria-expanded={isLinkOpen}
        {...PANEL_ITEM}
        onClick={() => {
          setIsLinkOpen(!isLinkOpen);
        }}
      >
        <Icon name="link" />
        From link
      </button>
      {isLinkOpen && <LinkField actions={actions} />}
    </>
  );
}

/**
 * The Image panel: opened by the dock's Image, which has no mode under the floating
 * dock; it keeps no choices and gives no tool style.
 */
export const toolPanel = defineToolPanel<ImageChoices>({
  id: 'image',
  label: 'Image',
  codec: IMAGE_CHOICES,
  contents: ImagePanelContents,
});

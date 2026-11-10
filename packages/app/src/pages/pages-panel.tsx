import { useState, type ReactElement } from 'react';

import type { ObjectId, Page, PageId } from '@canvas/schema';

import { Dialog } from '../dialogs/dialog.js';
import type { NoticeAction } from '../hooks/use-notice.js';
import { Icon } from '../icons/icon.js';

import { LATER_PAGE_CHANGE_NOTICE, undoWhileTopmost } from './page-delete-undo.js';
import { PageMenu, type PageMenuChoices } from './page-menu.js';
import type { PageCommandName, PageNavigation } from './page-navigator.js';
import { PageRow } from './page-row.js';
import styles from './pages-panel.module.css';
import { usePages } from './use-pages.js';

/** Props of {@link PagesPanel}. */
export interface PagesPanelProps {
  /** The pages, or undefined before an engine mounts. */
  readonly pages: PageNavigation | undefined;
  /** Whether the person may edit the board: a viewer only switches pages. */
  readonly canEdit: boolean;
  /** The selection, which "Move selection here" moves. */
  readonly selectedIds: readonly ObjectId[];
  /** Shows a notice, with a button. */
  readonly onNotice: (message: string, action?: NoticeAction) => void;
  /**
   * Undoes the last step: when given, Delete page asks nothing and deletes at once, its
   * notice offering Undo, which brings the page and its objects back in one step; else a dialog
   * confirms it first.
   */
  readonly onUndoDelete?: (() => void) | undefined;
  /**
   * Where Add page is: `header`, the + beside the heading (the design board's panel);
   * `row`, the whiteboard's dropdown ("remove the header row and just add a
   * list item for 'Add Page'"), with no heading and a last row under the pages. Default `header`.
   */
  readonly addPageAs?: 'header' | 'row' | undefined;
  /**
   * Hears another page shown from the list (the whiteboard's sheet closes); not a press on the
   * page shown, which may begin a double-click rename. Nothing if absent.
   */
  readonly onShow?: (() => void) | undefined;
}

/** A page's open menu. */
interface OpenMenu {
  readonly page: Page;
  readonly x: number;
  readonly y: number;
}

/**
 * The page list, a compact region named "Pages" at the top of the sidebar, so the toolbar
 * and the canvas keep their size: the pages in order, the page shown marked; a click shows a page
 * (the address follows, `?page=`). A person who may edit adds a page (shown at once), renames one
 * with a double-click, reorders by dragging, and from a page's menu duplicates, deletes (confirmed
 * with its object count; never the only page) or moves the selection to it, after which the person
 * stays and a notice offers to go there. Given `onUndoDelete` (the whiteboard), Delete
 * asks nothing: its notice offers Undo instead.
 *
 * @param props - The pages, the role, the selection and the notice.
 * @returns The panel.
 */
export function PagesPanel(props: PagesPanelProps): ReactElement {
  const { pages: navigation, canEdit } = props;
  const { pages, current } = usePages(navigation);
  const [renaming, setRenaming] = useState<PageId>();
  const [menu, setMenu] = useState<OpenMenu>();
  const [deleting, setDeleting] = useState<Page>();
  const run = (name: PageCommandName, input: unknown): unknown => navigation?.run(name, input);
  return (
    <section aria-label="Pages" className={styles.panel}>
      {props.addPageAs === 'row' ? null : <PagesHeader {...{ navigation, canEdit }} />}
      <ol className={styles.list}>
        {pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            isCurrent={page.id === current}
            isRenaming={page.id === renaming}
            canEdit={canEdit}
            onShow={() => {
              showFromList(page.id, props);
            }}
            onStartRename={() => {
              setRenaming(page.id);
            }}
            onRename={(name) => {
              setRenaming(undefined);
              if (name !== undefined && name !== page.name) {
                run('renamePage', { pageId: page.id, name });
              }
            }}
            onMenu={(x, y) => {
              setMenu({ page, x, y });
            }}
            onDropPage={(pageId, side) => {
              run('reorderPage', { pageId, [side]: page.id });
            }}
          />
        ))}
      </ol>
      {props.addPageAs === 'row' && canEdit ? (
        <AddPageRow navigation={navigation} onShow={props.onShow} />
      ) : null}
      {menu !== undefined && (
        <PageMenu
          page={menu.page}
          at={menu}
          onClose={() => {
            setMenu(undefined);
          }}
          choices={menuChoices(
            menu.page,
            { ...props, current, pageCount: pages.length },
            {
              rename: () => {
                setRenaming(menu.page.id);
              },
              remove: () => {
                askOrDelete(menu.page, props, setDeleting);
              },
            },
          )}
        />
      )}
      {deleting !== undefined && (
        <DeletePageDialog
          page={deleting}
          objectCount={navigation?.objectCount(deleting.id) ?? 0}
          onClose={() => {
            setDeleting(undefined);
          }}
          onDelete={() => {
            setDeleting(undefined);
            run('deletePage', { pageId: deleting.id });
          }}
        />
      )}
    </section>
  );
}

/**
 * Adds a page after the others and shows it (one undo step).
 *
 * @param navigation - The pages, or undefined before an engine mounts.
 */
export function addPageAndShow(navigation: PageNavigation | undefined): void {
  const added = navigation?.run('addPage', {}) as { readonly pageId?: PageId } | undefined;
  if (added?.pageId !== undefined) navigation?.show(added.pageId);
}

/**
 * What the notice says once a page is deleted: its name, and its objects when it had any.
 *
 * @param name - The page's name.
 * @param objectCount - How many objects went with it.
 * @returns The sentence.
 */
export function deletedPageNotice(name: string, objectCount: number): string {
  if (objectCount === 0) return `Deleted “${name}”.`;
  const objects = objectCount === 1 ? '1 object' : `${String(objectCount)} objects`;
  return `Deleted “${name}” and its ${objects}.`;
}

/**
 * Shows another page the person chose in the list, then tells the panel's `onShow`; a press on
 * the page shown does nothing.
 *
 * @param pageId - The page.
 * @param props - The panel's pages and `onShow`.
 */
function showFromList(pageId: PageId, props: PagesPanelProps): void {
  if (props.pages === undefined || props.pages.current() === pageId) return;
  props.pages.show(pageId);
  props.onShow?.();
}

/**
 * Delete page from a page's menu: without `onUndoDelete`, the dialog asks first; with it
 * (owner: an undo notice, no dialog), the page goes at once and the notice offers Undo,
 * until the person's next edit replaces that notice with one saying why it went.
 *
 * @param page - The page.
 * @param props - The panel's pages, notice and undo.
 * @param ask - Opens the dialog.
 */
function askOrDelete(page: Page, props: PagesPanelProps, ask: (page: Page) => void): void {
  const { pages: navigation, onNotice, onUndoDelete } = props;
  if (onUndoDelete === undefined) {
    ask(page);
    return;
  }
  const objectCount = navigation?.objectCount(page.id) ?? 0;
  if (navigation?.run('deletePage', { pageId: page.id }) === undefined) return;
  const undo = undoWhileTopmost(navigation, () => {
    onNotice(LATER_PAGE_CHANGE_NOTICE);
  });
  onNotice(deletedPageNotice(page.name, objectCount), {
    label: 'Undo',
    run: () => {
      undo(onUndoDelete);
    },
  });
}

/**
 * The design board's panel heading, "Pages", and its + for a person who may edit.
 *
 * @param props - The pages and the role.
 * @param props.navigation - The pages, or undefined before an engine mounts.
 * @param props.canEdit - Whether the person may edit the board.
 * @returns The header.
 */
function PagesHeader(props: {
  readonly navigation: PageNavigation | undefined;
  readonly canEdit: boolean;
}): ReactElement {
  return (
    <div className={styles.header}>
      <h2 className={styles.heading}>Pages</h2>
      {props.canEdit && <AddPageButton navigation={props.navigation} />}
    </div>
  );
}

/** The attribute on the list's Add page row, which the arrow keys reach after the pages. */
export const ADD_PAGE_ROW_ATTRIBUTE = 'data-add-page-row';

/**
 * The list's last row (the whiteboard's dropdown): Add page, under a divider, looking
 * like a page row; it adds a page after the others and shows it, as choosing a row does.
 *
 * @param props - The pages and `onShow`.
 * @param props.navigation - The pages, or undefined before an engine mounts.
 * @param props.onShow - Hears the new page shown (the dropdown closes); nothing if absent.
 * @returns The row.
 */
function AddPageRow(props: {
  readonly navigation: PageNavigation | undefined;
  readonly onShow: (() => void) | undefined;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.addRow}
      {...{ [ADD_PAGE_ROW_ATTRIBUTE]: '' }}
      onClick={() => {
        addPageAndShow(props.navigation);
        props.onShow?.();
      }}
    >
      <Icon name="plus" />
      <span>Add page</span>
    </button>
  );
}

/**
 * The button that adds a page and shows it.
 *
 * @param props - The pages.
 * @param props.navigation - The pages, or undefined before an engine mounts.
 * @returns The button.
 */
function AddPageButton(props: { readonly navigation: PageNavigation | undefined }): ReactElement {
  const { navigation } = props;
  return (
    <button
      type="button"
      className={styles.add}
      aria-label="Add page"
      title="Add page"
      onClick={() => {
        addPageAndShow(navigation);
      }}
    >
      <Icon name="plus" />
    </button>
  );
}

/**
 * What a page's menu offers: rename and delete through the panel's state, duplicate, and moving
 * the selection to the page with a notice that offers to go there (the person
 * stays on the page shown).
 *
 * @param page - The page.
 * @param context - The panel's props, the page shown and how many pages there are.
 * @param local - The panel's own rename and delete.
 * @param local.rename - Starts renaming the page.
 * @param local.remove - Asks to delete the page.
 * @returns The choices.
 */
function menuChoices(
  page: Page,
  context: PagesPanelProps & { readonly current: PageId | undefined; readonly pageCount: number },
  local: { readonly rename: () => void; readonly remove: () => void },
): PageMenuChoices {
  const { pages: navigation, selectedIds, onNotice } = context;
  const moveSelection = (): void => {
    const moved = navigation?.run('moveObjectsToPage', { ids: selectedIds, pageId: page.id });
    if (moved === undefined) return;
    onNotice(`Moved to ${page.name}.`, {
      label: `Go to ${page.name}`,
      run: () => {
        navigation?.show(page.id);
      },
    });
  };
  return {
    rename: local.rename,
    duplicate: () => {
      navigation?.run('duplicatePage', { pageId: page.id });
    },
    remove: context.pageCount > 1 ? local.remove : undefined,
    moveSelection:
      selectedIds.length > 0 && page.id !== context.current ? moveSelection : undefined,
  };
}

/**
 * Confirms deleting a page and its objects.
 *
 * @param props - The page, its object count and the handlers.
 * @param props.page - The page.
 * @param props.objectCount - How many objects go with it.
 * @param props.onClose - Keeps the page.
 * @param props.onDelete - Deletes it.
 * @returns The dialog.
 */
function DeletePageDialog(props: {
  readonly page: Page;
  readonly objectCount: number;
  readonly onClose: () => void;
  readonly onDelete: () => void;
}): ReactElement {
  const { page, objectCount } = props;
  const objects = objectCount === 1 ? '1 object' : `${String(objectCount)} objects`;
  return (
    <div className={styles.overlay}>
      <Dialog title="Delete page" width="narrow" onClose={props.onClose}>
        <p className={styles.question}>
          Delete “{page.name}” and the {objects} on it? Undo brings them back.
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}

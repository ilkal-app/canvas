import { useEffect, type ReactElement } from 'react';

import { Icon } from '../icons/icon.js';

import styles from './board-search-sheet.module.css';
import type { ResultGroup } from './use-search-rows.js';

/** Props of {@link BoardSearchResults}. */
export interface BoardSearchResultsProps {
  /** The listbox's id, which the field controls; each row's id is it, a dash and its index. */
  readonly id: string;
  /** The results, grouped. */
  readonly groups: readonly ResultGroup[];
  /** The active result's index across the groups, or -1. */
  readonly active: number;
  /** Goes to the result at an index (a click). */
  readonly onGoTo: (index: number) => void;
}

/**
 * A result row's id.
 *
 * @param listId - The listbox's id.
 * @param index - The row's index across the groups.
 * @returns The id.
 */
export function searchOptionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`;
}

/**
 * Keeps the active row in view as the arrows move it through a list longer than the sheet.
 *
 * @param listId - The listbox's id.
 * @param active - The active row's index, or -1.
 */
export function useActiveInView(listId: string, active: number): void {
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(searchOptionId(listId, active))?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);
}

/**
 * The board search sheet's results (frame B): a listbox of groups, each under its head
 * ("Stickies · 2", "Comments · 1") with rows of the matching text and its meta (the object's
 * section, the comment's age). A press on a row keeps focus in the field, and its click goes to
 * the result.
 *
 * @param props - The results, the active one and the handler.
 * @returns The list.
 */
export function BoardSearchResults(props: BoardSearchResultsProps): ReactElement {
  let index = 0;
  return (
    <div role="listbox" id={props.id} aria-label="Results" className={styles.results}>
      {props.groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.title} className={styles.group}>
          <div className={styles.head}>
            <span>{`${group.title} · ${String(group.rows.length)}`}</span>
            <Icon name="chevron-down" />
          </div>
          {group.rows.map((row) => {
            const at = index++;
            return (
              <div
                key={row.key}
                id={searchOptionId(props.id, at)}
                role="option"
                aria-selected={at === props.active}
                className={styles.row}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  props.onGoTo(at);
                }}
              >
                <Icon name={row.icon} />
                <span className={styles.label}>{row.text}</span>
                {row.meta === undefined ? null : (
                  <span className={styles.meta} title={row.meta}>
                    {row.meta}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

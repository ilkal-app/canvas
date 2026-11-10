import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import type { TextStyleChange } from '../engine/text-style-types.js';
import type { ShellAction } from '../state/shell-action.js';

import { PopoverStyleControls, type PopoverStyleControlsProps } from './popover-controls.js';

/**
 * Whether two values hold the same data: the same value, or arrays and plain objects whose
 * entries hold the same data. Anything else (a map, an engine, a function) is the same only
 * when it is the same object. Pure.
 *
 * @param first - One value.
 * @param second - The other.
 * @returns True for the same data.
 */
export function isSameData(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((entry, index) => isSameData(entry, second[index]))
    );
  }
  if (!isPlainObject(first) || !isPlainObject(second)) return false;
  const keys = Object.keys(first);
  return (
    keys.length === Object.keys(second).length &&
    keys.every((key) => Object.hasOwn(second, key) && isSameData(first[key], second[key]))
  );
}

/**
 * Whether a value is a plain object (an object literal), whose entries are its data.
 *
 * @param value - The value.
 * @returns True for a plain object.
 */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The style controls' props, and the board's document revision: controls read the board as they
 * render (a section's children enable Fit to content), so a change to it renders them again.
 */
export interface StableControlsProps extends PopoverStyleControlsProps {
  /** Counts the board's document changes while the popover shows. */
  readonly revision: number;
}

/**
 * The style controls, given the revision only to tell a change of the board (they ignore it).
 *
 * @param props - The controls' props and the board's revision.
 * @returns The controls.
 */
function RevisedStyleControls(props: StableControlsProps): ReactElement {
  return <PopoverStyleControls {...props} />;
}

/**
 * The popover's style controls, rendered again only when what they show changes: a
 * click on the selected object or in the edited text hands the popover a new selection array of
 * the same objects and a new text style of the same values, which leave them as they are; a
 * change to the board's document (a child added to a selected section) renders them again.
 */
export const StableStyleControls = memo(RevisedStyleControls, (previous, next) =>
  isSameData(previous, next),
);

/**
 * The style controls' props with callbacks that keep their identity across renders and always
 * call the latest ones passed, so {@link StableStyleControls} can skip a render without
 * holding a stale callback. A callback that is absent stays absent.
 *
 * @param props - The controls' props, as the popover has them now.
 * @returns The same props, their callbacks stable, and the board's document revision.
 */
export function useStableControlsProps(props: PopoverStyleControlsProps): StableControlsProps {
  const revision = useDocumentRevision(props.engine);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const calls = useMemo(
    () => ({
      onTextStyle: (change: TextStyleChange) => latest.current.onTextStyle?.(change),
      dispatch: (action: ShellAction) => {
        latest.current.dispatch(action);
      },
      onEditLabel: (id: Parameters<NonNullable<PopoverStyleControlsProps['onEditLabel']>>[0]) =>
        latest.current.onEditLabel?.(id),
      onSectionTimer: (
        id: Parameters<NonNullable<PopoverStyleControlsProps['onSectionTimer']>>[0],
      ) => latest.current.onSectionTimer?.(id),
      onReplaceImage: (
        id: Parameters<NonNullable<PopoverStyleControlsProps['onReplaceImage']>>[0],
      ) => latest.current.onReplaceImage?.(id),
      onRetryLink: (
        id: Parameters<NonNullable<PopoverStyleControlsProps['onRetryLink']>>[0],
        url: string,
      ) => latest.current.onRetryLink?.(id, url),
      onToggleAuthors: () => latest.current.stickyAuthors?.onToggle(),
    }),
    [],
  );
  const isAuthorsShown = props.stickyAuthors?.isShown;
  const stickyAuthors = useMemo(
    () =>
      isAuthorsShown === undefined
        ? undefined
        : { isShown: isAuthorsShown, onToggle: calls.onToggleAuthors },
    [isAuthorsShown, calls],
  );
  return {
    ...props,
    onTextStyle: props.onTextStyle === undefined ? undefined : calls.onTextStyle,
    dispatch: calls.dispatch,
    onEditLabel: props.onEditLabel === undefined ? undefined : calls.onEditLabel,
    onSectionTimer: props.onSectionTimer === undefined ? undefined : calls.onSectionTimer,
    onReplaceImage: props.onReplaceImage === undefined ? undefined : calls.onReplaceImage,
    onRetryLink: props.onRetryLink === undefined ? undefined : calls.onRetryLink,
    stickyAuthors,
    revision,
  };
}

/**
 * Counts the board's document changes, so what renders from the board renders again.
 *
 * @param engine - The engine, once it runs.
 * @returns The count since the engine was given.
 */
function useDocumentRevision(engine: PopoverStyleControlsProps['engine']): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      engine?.board.subscribe((change) => {
        if (change.kind === 'document') setRevision((was) => was + 1);
      }),
    [engine],
  );
  return revision;
}

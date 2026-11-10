import type { ReactElement } from 'react';

import { CompactDropdown } from '../controls/compact-dropdown.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { MIXED } from '../panels/controls/mixed-value.js';
import type { StyleChange } from '../state/shell-action.js';

import type { PopoverStyleControlsProps } from './popover-controls.js';
import { PopoverLinkButton, runLinkEntriesOf } from './popover-link.js';
import { Divider } from './popover-row-parts.js';
import { PopoverColourButton, TypeControls } from './popover-shared.js';
import { popoverTextValues } from './popover-values.js';
import styles from './selection-popover.module.css';
import {
  capOf,
  capsOf,
  sharedEndsOf,
  sharedRouteOf,
  sharedStrokeColourOf,
  sharedStrokeWidthOf,
  type PopoverEnds,
  type PopoverLine,
  type PopoverRoute,
} from './shape-connector-values.js';
import { StrokeWidthDropdown, strokeColourChanges, strokeWidthChanges } from './shape-controls.js';

/** The routes: each one's value, name and icon. */
const ROUTES: readonly (readonly [PopoverRoute, string, IconName])[] = [
  ['straight', 'Straight', 'line'],
  ['elbow', 'Elbow', 'elbow-connector'],
  ['curved', 'Curved', 'route-curved'],
];

/** The ends: each one's value, name and short mark (the trigger shows the mark). */
const ENDS: readonly (readonly [PopoverEnds, string, string])[] = [
  ['none', 'None', '—'],
  ['end', 'End', '→'],
  ['both', 'Both', '↔'],
];

/**
 * The route toggles: straight, elbow and curved, the shared route pressed; curved is disabled
 * while a legacy line is selected (a line takes no curve).
 *
 * @param props - The lines and the restyle.
 * @param props.lines - The selected connectors and lines.
 * @param props.restyle - Applies changes in one action.
 * @returns The toggles.
 */
function RouteToggles(props: {
  readonly lines: readonly PopoverLine[];
  readonly restyle: (changes: StyleChange[]) => void;
}): ReactElement {
  const { lines } = props;
  const route = sharedRouteOf(lines);
  const hasLegacyLine = lines.some((line) => line.type === 'line');
  return (
    <>
      {ROUTES.map(([value, name, icon]) => {
        const isDisabled = value === 'curved' && hasLegacyLine;
        return (
          <button
            key={value}
            type="button"
            className={styles.iconButton}
            aria-label={name}
            aria-pressed={route === value}
            aria-disabled={isDisabled ? true : undefined}
            onClick={() => {
              if (isDisabled || route === value) return;
              // Only the route: a bound connector keeps its ends where they are attached.
              props.restyle(
                lines.flatMap((line) =>
                  value === 'curved' && line.type === 'line'
                    ? []
                    : [{ id: line.id, style: { route: value } }],
                ),
              );
            }}
          >
            <Icon name={icon} />
          </button>
        );
      })}
    </>
  );
}

/**
 * A connector label's text controls: font, size and text colour of every selected
 * label, through the text style the popover's sticky and text rows use; one undo step each.
 *
 * @param props - The popover's controls' props and the labelled connectors.
 * @param props.controls - The popover's controls' props.
 * @param props.lines - The selected connectors, each with a label.
 * @returns The controls.
 */
function LabelTextControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly lines: readonly PopoverLine[];
}): ReactElement {
  const { controls } = props;
  const values = popoverTextValues(props.lines, controls.textStyle);
  return (
    <>
      <TypeControls controls={controls} values={values} />
      <PopoverColourButton
        kind="text"
        value={values.textColor ?? MIXED}
        controls={controls}
        onChange={(color) => {
          if (color !== null) controls.onTextStyle?.({ kind: 'style', patch: { color } });
        }}
      />
    </>
  );
}

/**
 * The connector and line row (the CONNECTOR OR LINE card): colour and width | straight,
 * elbow and curved | ends | label, and for connectors that all have a label its font, size and
 * text colour. A legacy line is edited the same way, without a curve or a label. Each choice is one change of every selected line, one undo step; none moves an end.
 *
 * @param props - The popover's controls' props, the selection all connectors and lines.
 * @param props.controls - The popover's controls' props.
 * @param props.lines - The selected connectors and lines.
 * @returns The controls.
 */
export function LineControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly lines: readonly PopoverLine[];
}): ReactElement {
  const { controls, lines } = props;
  const restyle = (changes: StyleChange[]): void => {
    if (changes.length > 0) controls.dispatch({ type: 'style', changes });
  };
  const ends = sharedEndsOf(lines);
  const [only] = lines;
  const canLabel = lines.length === 1 && only?.type === 'connector';
  const isLabelled = lines.every((line) => line.type === 'connector' && line.label !== null);
  return (
    <>
      <PopoverColourButton
        kind="line"
        value={sharedStrokeColourOf(lines)}
        controls={controls}
        onChange={(color) => {
          if (color !== null) restyle(strokeColourChanges(lines, color));
        }}
      />
      <StrokeWidthDropdown
        label="Line width"
        width={sharedStrokeWidthOf(lines)}
        onChange={(width) => {
          restyle(strokeWidthChanges(lines, width));
        }}
      />
      <Divider />
      <RouteToggles lines={lines} restyle={restyle} />
      <CompactDropdown
        label="Ends"
        value={ends === MIXED ? 'none' : ends}
        options={ENDS.map(([value, name, mark]) => ({
          value,
          label: name,
          meta: mark,
          triggerLabel: mark,
        }))}
        isNamedByLabel
        isMixed={ends === MIXED}
        width={48}
        onChange={(value) => {
          const caps = capsOf(value, capOf(lines));
          restyle(lines.map((line) => ({ id: line.id, style: caps })));
        }}
      />
      <Divider />
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Label"
        aria-disabled={canLabel ? undefined : true}
        onClick={() => {
          if (!canLabel) return;
          if (controls.onEditLabel !== undefined) controls.onEditLabel(only.id);
          else controls.dispatch({ type: 'selection', command: 'activate' });
        }}
      >
        <Icon name="text" />
      </button>
      {isLabelled ? <LabelTextControls controls={controls} lines={lines} /> : null}
      {/* A label's links: listed only when it carries some. */}
      {runLinkEntriesOf(lines).length > 0 ? (
        <PopoverLinkButton selection={lines} dispatch={controls.dispatch} isListOnly />
      ) : null}
    </>
  );
}

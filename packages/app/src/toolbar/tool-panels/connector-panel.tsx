import type { ReactElement } from 'react';

import { CompactDropdown } from '../../controls/compact-dropdown.js';
import type { IconName } from '../../icons/icon-paths.js';
import {
  CONNECTOR_CHOICES,
  CONNECTOR_PANEL_CAPS,
  CONNECTOR_PANEL_ENDS,
  CONNECTOR_PANEL_WIDTHS,
  connectorToolStyle,
  type ConnectorChoices,
  type ConnectorPanelCap,
  type ConnectorPanelEnds,
  type ConnectorPanelRoute,
} from '../../state/panel-choices/connector-choices.js';

import { PANEL_ITEM, PanelDivider, PanelIconButton } from './panel-controls.js';
import styles from './panel-controls.module.css';
import { PanelColourButton } from './shapes-panel.js';
import { defineToolPanel, type ToolPanelContentsProps } from './tool-panel-contribution.js';

/** Each route's name and icon in the Connector panel. */
const ROUTES: readonly {
  readonly route: ConnectorPanelRoute;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { route: 'straight', label: 'Straight', icon: 'line' },
  { route: 'elbow', label: 'Elbow', icon: 'elbow-connector' },
  { route: 'curved', label: 'Curved', icon: 'route-curved' },
];

/** What the ends menu calls each setting, and the trigger's short form. */
const ENDS: Readonly<
  Record<ConnectorPanelEnds, { readonly label: string; readonly short: string }>
> = {
  none: { label: 'No ends (a line)', short: '—' },
  end: { label: 'At the end', short: '→' },
  both: { label: 'At both ends', short: '↔' },
};

/** What the cap menu calls each cap. */
const CAPS: Readonly<Record<ConnectorPanelCap, string>> = {
  arrow: 'Arrow',
  triangle: 'Triangle',
  circle: 'Circle',
  diamond: 'Diamond',
};

/**
 * The Connector panel's contents (the design's CONNECTOR card): straight, elbow or
 * curved, a divider, then the ends (none makes a plain line), their cap, the width (1, 2 or 4
 * px) and the colour. Each choice is the next connector's.
 *
 * @param props - The choices and their setter.
 * @returns The contents.
 */
function ConnectorPanelContents(props: ToolPanelContentsProps<ConnectorChoices>): ReactElement {
  const { choices, onChange } = props;
  return (
    <>
      <div role="group" aria-label="Route" className={styles.group}>
        {ROUTES.map(({ route, label, icon }) => (
          <PanelIconButton
            key={route}
            label={label}
            icon={icon}
            isPressed={choices.route === route}
            onSelect={() => {
              onChange({ ...choices, route });
            }}
          />
        ))}
      </div>
      <PanelDivider />
      <CompactDropdown
        label="Ends"
        value={choices.ends}
        options={CONNECTOR_PANEL_ENDS.map((ends) => ({
          value: ends,
          label: ENDS[ends].label,
          triggerLabel: ENDS[ends].short,
        }))}
        // The design's ends and width dropdowns are 48 and 58 px whatever they hold.
        width={48}
        dataAttributes={PANEL_ITEM}
        onChange={(ends) => {
          onChange({ ...choices, ends });
        }}
      />
      <CompactDropdown
        label="Cap"
        value={choices.cap}
        options={CONNECTOR_PANEL_CAPS.map((cap) => ({ value: cap, label: CAPS[cap] }))}
        isDisabled={choices.ends === 'none'}
        // A disabled control is no roving item: the arrows step over it to Width and Colour.
        dataAttributes={choices.ends === 'none' ? undefined : PANEL_ITEM}
        onChange={(cap) => {
          onChange({ ...choices, cap });
        }}
      />
      <CompactDropdown
        label="Width"
        value={String(choices.width) as `${(typeof CONNECTOR_PANEL_WIDTHS)[number]}`}
        options={CONNECTOR_PANEL_WIDTHS.map((width) => ({
          value: String(width) as `${typeof width}`,
          label: `${String(width)} px`,
        }))}
        width={58}
        dataAttributes={PANEL_ITEM}
        onChange={(width) => {
          const chosen = CONNECTOR_PANEL_WIDTHS.find((option) => String(option) === width);
          if (chosen !== undefined) onChange({ ...choices, width: chosen });
        }}
      />
      <PanelColourButton
        label="Colour"
        color={choices.color}
        canBeInk
        canBeNone={false}
        onChange={(color) => {
          if (color !== null) onChange({ ...choices, color });
        }}
      />
    </>
  );
}

/**
 * The Connector panel: its route, ends, width and colour become the connector tool's
 * style; a connector drawn with no ends is a plain line, which replaces the Line tool.
 */
export const toolPanel = defineToolPanel<ConnectorChoices>({
  id: 'connector',
  label: 'Connector',
  codec: CONNECTOR_CHOICES,
  toolStyle: (choices) => ({ tool: 'connector', style: connectorToolStyle(choices) }),
  contents: ConnectorPanelContents,
});

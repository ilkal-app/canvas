import { useRef, type ReactElement } from 'react';

import { ControlStatesSheet } from '../controls/control-states-sheet.js';
import { useTheme } from '../hooks/use-theme.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';

import type { ChromeFontSet } from './chrome-fonts.js';
import { nextThemePreference, type ThemePreference } from './theme-preference.js';
import { THEME_LABELS } from './theme-tokens.js';
import styles from './token-sheet.module.css';

/** What {@link TokenSheet} takes. */
export interface TokenSheetProps {
  /** The theme preference to start with; the stored one if absent. */
  readonly initialThemePreference?: ThemePreference;
  /** The fonts the chrome is set in; the shell's own if absent. */
  readonly chromeFonts?: ChromeFontSet;
  /** The whiteboard chrome whose controls the control states sheet shows; `classic` if absent. */
  readonly chrome?: WhiteboardChrome | undefined;
}

const SURFACES = [
  ['ground/mat', styles.mat],
  ['ground/grid', styles.grid],
  ['surface/sheet', styles.sheetSurface],
  ['surface/raised', styles.raised],
  ['surface/pressed', styles.pressed],
] as const;

const LINES = [
  ['line/hairline', styles.hairline],
  ['line/strong', styles.strong],
  ['line/control', styles.control],
] as const;

const SWATCHES = [
  ['hand/you', styles.you],
  ['hand/agent', styles.agent],
  ['mark/red-pencil', styles.redPencil],
  ['mark/live', styles.live],
  ['peer/mira', styles.mira],
  ['peer/jonas', styles.jonas],
] as const;

const TEXT_SAMPLES = [
  ['UI/Title', styles.textTitle, 'Share this board'],
  ['UI/Body', styles.textBody, 'Everyone with the link can view.'],
  ['UI/Label', styles.textLabel, 'Can edit'],
  ['UI/Section', styles.textSection, 'Layers'],
  ['UI/Caption', styles.textCaption, 'Edited 2 minutes ago'],
  ['Mono/Value', styles.textMonoValue, '1440 × 900 · 100%'],
  ['Mono/Key', styles.textMonoKey, '⌘ ⇧ K'],
] as const;

/**
 * The whiteboard's text styles beyond the classic set (milestone baselines,'s design
 * check), shown only under the floating chrome so the classic token sheet keeps its baseline.
 */
const FLOATING_TEXT_SAMPLES = [
  ['UI/Strong', styles.textStrong, 'Retro board'],
  ['Mono/Code', styles.textMonoCode, 'chrome=floating'],
] as const;

/**
 * The token sheet: one page with every surface, line, ink, hand, mark and peer colour,
 * every text style and the float shadow of the theme it is in, the control states sheet (UI-18,
 * `ControlStatesSheet`) and the theme button, for the
 * shell's screenshot baselines and the accessibility checks. The harness page shows it for
 * `?view=tokens`. Faint ink appears only as a disabled button, the one place it is used; the
 * danger ink only in the board menu's Delete board, which the sheet does not show.
 *
 * @param props - The starting theme preference and the chrome.
 * @returns The sheet.
 */
export function TokenSheet(props: TokenSheetProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  const theme = useTheme(rootRef, props.initialThemePreference, props.chromeFonts);
  const { themeName, preference, setPreference } = theme;
  const preferenceLabel = preference === 'system' ? 'System' : THEME_LABELS[preference];
  return (
    <main ref={rootRef} className={styles.sheet} data-token-sheet={themeName}>
      <header className={styles.header}>
        <h1 className={styles.title}>{THEME_LABELS[themeName]} tokens</h1>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setPreference(nextThemePreference(preference));
          }}
        >
          Theme: {preferenceLabel}
        </button>
      </header>
      <h2 className={styles.section}>Surfaces</h2>
      <div className={styles.row}>
        {SURFACES.map(([name, className]) => (
          <div key={name} className={className}>
            <p>{name}</p>
            {/* Secondary ink is not set on the pressed surface (4.2:1 in Graphite). */}
            {name === 'surface/pressed' ? (
              <p>Primary ink</p>
            ) : (
              <p className={styles.secondary}>Secondary ink</p>
            )}
          </div>
        ))}
      </div>
      <h2 className={styles.section}>Lines</h2>
      <div className={styles.row}>
        {LINES.map(([name, className]) => (
          <div key={name} className={className}>
            {name}
          </div>
        ))}
      </div>
      <h2 className={styles.section}>Hands, marks and peers</h2>
      <div className={styles.row}>
        {SWATCHES.map(([name, className]) => (
          <span key={name} className={styles.swatch}>
            <span className={className} aria-hidden="true" />
            {name}
          </span>
        ))}
      </div>
      <h2 className={styles.section}>Controls</h2>
      <div className={styles.row}>
        <button type="button" className={styles.primary}>
          Invite
        </button>
        <button type="button" className={styles.button}>
          Copy link
        </button>
        <button type="button" className={styles.button} disabled>
          Present — not available yet
        </button>
      </div>
      <h2 className={styles.section}>Text styles</h2>
      <dl className={styles.styles}>
        {[...TEXT_SAMPLES, ...(props.chrome === 'floating' ? FLOATING_TEXT_SAMPLES : [])].map(
          ([name, className, sample]) => (
            <div key={name} className={styles.pair}>
              <dt>{name}</dt>
              <dd className={className}>{sample}</dd>
            </div>
          ),
        )}
      </dl>
      <h2 className={styles.section}>Float</h2>
      <div className={styles.float}>A sheet floating over the board.</div>
      <h2 className={styles.section}>Control states</h2>
      <ControlStatesSheet chrome={props.chrome} />
    </main>
  );
}

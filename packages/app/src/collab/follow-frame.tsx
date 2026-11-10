import type { CSSProperties, ReactElement } from 'react';

import { useIsMobileSite } from '../shell/mobile-site.js';

import { avatarColorsOf } from './avatar-colors.js';
import styles from './follow-frame.module.css';
import { useFollowController, useFollowView } from './use-follow.js';

/**
 * The follow frame and its chip (frames F3–F6 and P1): while the person follows
 * someone, a coloured frame round the canvas and a chip centred along its top saying whom ("Following
 * Ana", or "Ana's spotlight") with Stop; while they share the spotlight, the frame in the
 * spotlight colour and "You're spotlighting · N following" with Stop. Stop is keyboard-reachable;
 * Esc stops a follow too. On a phone (frame P1) the chip sits centred under the compact bar.
 * Nothing while neither.
 *
 * @returns The frame and chip, or nothing.
 */
export function FollowFrame(): ReactElement | null {
  const controller = useFollowController();
  const view = useFollowView(controller);
  const compact = useIsMobileSite() ? '' : undefined;
  if (controller === undefined) return null;
  const { follow } = view;
  if (view.isSpotlighting) {
    const here = `${String(view.audience)} following`;
    return (
      <div className={styles.frame} data-follow="spotlighting" data-compact={compact}>
        <div className={styles.chip} role="group" aria-label="Spotlight">
          <span className={styles.label}>
            You&apos;re spotlighting <span className={styles.count}>· {here}</span>
          </span>
          <button
            type="button"
            className={styles.stop}
            onClick={() => {
              controller.endSpotlight();
            }}
          >
            Stop
          </button>
        </div>
      </div>
    );
  }
  if (follow.kind !== 'following') return null;
  const isSpotlight = follow.cause === 'spotlight';
  // The followed person's own colour (frames F3, F5), its ink legible on it.
  const color = controller.colorOf(follow.principalId);
  const colors = color === undefined ? undefined : avatarColorsOf(color);
  // The person's colour is data (their presence colour), so it is set here, not in the sheet.
  const frameStyle: CSSProperties | undefined =
    colors === undefined ? undefined : { borderColor: colors.fill };
  const chipStyle: CSSProperties | undefined =
    colors === undefined ? undefined : { backgroundColor: colors.fill };
  return (
    <div
      className={styles.frame}
      data-follow={isSpotlight ? 'spotlight' : 'following'}
      data-compact={compact}
      style={frameStyle}
    >
      <div
        className={styles.chip}
        style={chipStyle}
        data-ink={colors?.ink}
        role="group"
        aria-label={isSpotlight ? `${follow.name}'s spotlight` : `Following ${follow.name}`}
      >
        <span className={styles.label}>
          {isSpotlight ? `${follow.name}'s spotlight` : `Following ${follow.name}`}
        </span>
        <button
          type="button"
          className={styles.stop}
          onClick={() => {
            controller.stop('button');
          }}
        >
          {isSpotlight ? 'Stop following' : 'Stop'}
        </button>
        {isSpotlight ? null : (
          <kbd className={styles.key} aria-hidden="true">
            Esc
          </kbd>
        )}
      </div>
    </div>
  );
}

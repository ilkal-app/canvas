// @vitest-environment jsdom
// The floating dock's Reactions flyout (the design's frame B).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { boardReactions } from './__fixtures__/board-reactions.js';
import { ReactionsFlyout, repeatNameOf } from './reactions-flyout.js';

afterEach(cleanup);

describe('ReactionsFlyout', () => {
  it('offers the seven reactions and "+1", in the design’s order, kept clear of popovers', () => {
    render(<ReactionsFlyout reactions={boardReactions()} />);
    const flyout = screen.getByRole('toolbar', { name: 'Reactions' });
    expect(flyout.hasAttribute('data-popover-avoid')).toBe(true);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '👍',
      '❤️',
      '🎉',
      '👀',
      '🙌',
      '🤔',
      '😂',
      '+1',
    ]);
  });

  it('arms a reaction, pressed, and disarms it when pressed again', () => {
    const reactions = boardReactions({ armed: '🎉' });
    render(<ReactionsFlyout reactions={reactions} />);
    const party = screen.getByRole('button', { name: 'React with 🎉' });
    expect(party.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(party);
    expect(reactions.arm).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'React with 👍' }));
    expect(reactions.arm).toHaveBeenCalledWith('👍');
  });

  it('sends a reaction chosen with Enter or Space at the view’s centre, without arming it', () => {
    const reactions = boardReactions();
    render(<ReactionsFlyout reactions={reactions} />);
    const thumbs = screen.getByRole('button', { name: 'React with 👍' });
    fireEvent.keyDown(thumbs, { key: 'Enter' });
    fireEvent.keyDown(thumbs, { key: ' ' });
    fireEvent.keyDown(thumbs, { key: 'Enter', repeat: true });
    fireEvent.keyDown(thumbs, { key: 'a' });
    expect(reactions.sendAtCentre).toHaveBeenCalledTimes(2);
    expect(reactions.sendAtCentre).toHaveBeenCalledWith('👍');
    expect(reactions.arm).not.toHaveBeenCalled();
  });

  it('repeats the last reaction with "+1", disabled before the first', () => {
    const none = boardReactions();
    const { rerender } = render(<ReactionsFlyout reactions={none} />);
    const repeat = screen.getByRole('button', { name: 'Repeat the last reaction (none yet)' });
    expect((repeat as HTMLButtonElement).disabled).toBe(true);
    const reactions = boardReactions({ last: { emoji: '😂', x: 0, y: 0, pageId: 'page-1' } });
    rerender(<ReactionsFlyout reactions={reactions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repeat 😂' }));
    expect(reactions.repeat).toHaveBeenCalled();
  });

  it('closes on Escape, and leaves other keys alone', () => {
    const reactions = boardReactions();
    render(<ReactionsFlyout reactions={reactions} />);
    const flyout = screen.getByRole('toolbar', { name: 'Reactions' });
    fireEvent.keyDown(flyout, { key: 'ArrowRight' });
    expect(reactions.close).not.toHaveBeenCalled();
    fireEvent.keyDown(flyout, { key: 'Escape' });
    expect(reactions.close).toHaveBeenCalled();
    expect(repeatNameOf('👍')).toBe('Repeat 👍');
  });
});

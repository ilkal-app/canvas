import type { SerializableChangeSet } from '@canvas/engine';
import type { RootMovePreview } from '@canvas/tools';

type Command = NonNullable<SerializableChangeSet['retainedMove']>;
type Preview = Pick<RootMovePreview, 'ids' | 'objects' | 'positions'>;

/** Orders retained move session boundaries around ordinary document batches. */
export class HostMoveQueue {
  private nextSession = 0;
  private sent:
    | { ids: RootMovePreview['ids']; session: number; sequence: number; begin: Float64Array }
    | undefined;
  private pending: Preview | undefined;
  private readonly ends: Command[] = [];

  /**
   * Whether a placement update or session boundary is waiting.
   *
   * @returns True while commands are pending.
   */
  get hasPending(): boolean {
    return this.pending !== undefined || this.ends.length > 0;
  }

  /**
   * Keeps only the latest complete snapshot; earlier pointer timestamps stay with HostView.
   *
   * @param model - The current root preview, or undefined when its gesture ends.
   */
  show(model: Preview | undefined): void {
    if (model === undefined) this.stop();
    else this.pending = model;
  }

  /** Ends retention before an ordinary change; subsequent moves start a fresh session. */
  stop(): void {
    if (this.sent) {
      this.ends.push({ kind: 'end', session: this.sent.session, sequence: this.sent.sequence + 1 });
      this.sent = undefined;
    }
    this.pending = undefined;
  }

  /**
   * Takes session ends before an ordinary batch is delivered.
   *
   * @returns The ordered ends.
   */
  takeEnds(): readonly Command[] {
    return this.ends.splice(0);
  }

  /**
   * Takes the latest move after the ordinary batch; stable membership sends no objects again.
   *
   * @returns Ordered end/begin or update commands, or none.
   */
  takeMove(): readonly Command[] {
    const model = this.pending;
    this.pending = undefined;
    if (!model) return [];
    if (this.sent?.ids === model.ids) {
      this.sent.sequence++;
      const { session, sequence, begin } = this.sent;
      // A pure translation of the begin positions (a drag) goes as one pair.
      const delta = translationOf(begin, model.positions);
      return [
        delta
          ? { kind: 'update', session, sequence, delta }
          : { kind: 'update', session, sequence, positions: model.positions },
      ];
    }
    this.stop();
    const ends = this.takeEnds();
    this.sent = {
      ids: model.ids,
      session: ++this.nextSession,
      sequence: 0,
      begin: model.positions,
    };
    return [
      ...ends,
      {
        kind: 'begin',
        session: this.sent.session,
        sequence: 0,
        objects: model.objects,
        positions: model.positions,
      },
    ];
  }

  /** Drops all pending references on disposal. */
  clear(): void {
    this.sent = undefined;
    this.pending = undefined;
    this.ends.length = 0;
  }
}

/**
 * The one translation that takes every begin position exactly to its position now, as the
 * engine applies a delta (`begin + delta`, in doubles), if there is one.
 *
 * @param begin - The begin positions, `x, y` per root.
 * @param positions - The positions now.
 * @returns The translation `[dx, dy]`, or undefined when the roots do not all move by it.
 */
function translationOf(
  begin: Float64Array,
  positions: Float64Array,
): readonly [number, number] | undefined {
  if (begin.length !== positions.length || begin.length < 2) return undefined;
  const dx = (positions[0] ?? 0) - (begin[0] ?? 0);
  const dy = (positions[1] ?? 0) - (begin[1] ?? 0);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
  for (let index = 0; index < begin.length; index += 2) {
    if ((begin[index] ?? 0) + dx !== positions[index]) return undefined;
    if ((begin[index + 1] ?? 0) + dy !== positions[index + 1]) return undefined;
  }
  return [dx, dy];
}

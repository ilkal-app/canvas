/** One server-sent event, as the assets service's `/events` stream sends them. */
export interface ServerSentEvent {
  /** The event's `id:` (the asset record's version), or the last one seen before it. */
  readonly id: string | undefined;
  /** The event's `event:` name; `message` when it has none. */
  readonly event: string;
  /** Its `data:` lines, joined by line breaks. */
  readonly data: string;
}

/**
 * Parses a `text/event-stream` body as it arrives, chunk by chunk (the HTML standard's
 * "Server-sent events" interpretation): lines end with CR, LF or CRLF, even across chunks; a
 * blank line dispatches the event gathered so far, one with data only; `:` lines are comments
 * (the service's keep-alives); `id:` persists until the next one, as `Last-Event-ID` does; fields
 * the service does not send (`retry:`) and unknown ones are ignored. Pure apart from its buffer.
 */
export class EventStreamParser {
  private buffer = '';
  private lastId: string | undefined;
  private event = '';
  private data: string[] = [];
  private isAfterCarriageReturn = false;

  /**
   * The last event id seen, for `Last-Event-ID` when the stream is opened again.
   *
   * @returns The id, or undefined before any.
   */
  get lastEventId(): string | undefined {
    return this.lastId;
  }

  /**
   * Feeds a chunk of the body.
   *
   * @param chunk - Decoded text, any length.
   * @returns The events the chunk completed, in order.
   */
  push(chunk: string): ServerSentEvent[] {
    let text = chunk;
    // A CRLF split across chunks: the LF that follows a chunk's final CR ends nothing new.
    if (this.isAfterCarriageReturn && text.startsWith('\n')) text = text.slice(1);
    this.isAfterCarriageReturn = text.endsWith('\r');
    this.buffer += text;
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? '';
    const events: ServerSentEvent[] = [];
    for (const line of lines) {
      const event = this.line(line);
      if (event !== undefined) events.push(event);
    }
    return events;
  }

  /**
   * Handles one complete line.
   *
   * @param line - The line, without its ending.
   * @returns The event a blank line dispatched, if any.
   */
  private line(line: string): ServerSentEvent | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
    return undefined;
  }

  /**
   * Ends the event gathered so far.
   *
   * @returns It, or undefined when it has no data.
   */
  private dispatch(): ServerSentEvent | undefined {
    const { data, event } = this;
    this.data = [];
    this.event = '';
    if (data.length === 0) return undefined;
    return { id: this.lastId, event: event === '' ? 'message' : event, data: data.join('\n') };
  }
}

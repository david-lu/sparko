/** Incremental SSE reader shared by the cloud adapter and authenticated browser fetch. */
export async function* readServerEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '', data = '', size = 0;
  const limit = 8 * 1024 * 1024;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let newline: RegExpExecArray | null;
      // Keep a trailing CR until the next chunk, in case it is half of CRLF.
      const lineEnd = chunk.done ? /\r\n|\n|\r/ : /\r\n|\n|\r(?!$)/;
      while ((newline = lineEnd.exec(buffer))) {
        const line = buffer.slice(0, newline.index);
        buffer = buffer.slice(newline.index + newline[0].length);
        size += line.length;
        if (size > limit) throw new Error('Event exceeds the stream size limit.');
        if (!line) {
          if (data) yield { event: event || 'message', data: data.slice(0, -1) };
          event = ''; data = ''; size = 0;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          if (field === 'data') data += value + '\n';
        }
      }
      if (size + buffer.length > limit) throw new Error('Event exceeds the stream size limit.');
      if (chunk.done) return;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// Portions by Pickle Team; modified 2026-09-26: pure async generator, strict
// frames, bounded buffers, explicit termination and cancellation. See LICENSE.
const { streamError } = require('./errors');
async function* parseStream(body, signal) {
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', terminal = false, size = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  // Adapted from the single-request service's processLine routine. Framing and
  // validation are stricter: malformed JSON and premature EOF fail explicitly.
  const processFrame = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data === '[DONE]') { terminal = true; return ''; }
    if (!data) return '';
    let json;
    try { json = JSON.parse(data); } catch { throw streamError({}, { code: 'SSE_INVALID_JSON' }); }
    if (json.error || /^event:\s*error$/m.test(frame)) throw streamError({}, { code: 'SSE_PROVIDER_ERROR' });
    const choice = json.choices?.[0];
    if (choice?.finish_reason === 'stop') terminal = true;
    else if (choice?.finish_reason) throw streamError({}, { code: 'STREAM_TRUNCATED' });
    const token = choice?.delta?.content || '';
    if (typeof token !== 'string') throw streamError({}, { code: 'SSE_INVALID_TOKEN' });
    return token;
  };
  try {
    if (signal?.aborted) throw streamError({}, { code: 'ABORTED' });
    while (!terminal) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw streamError({}, { code: 'ABORTED' });
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) { const token = processFrame(buffer); if (token) yield token; }
        if (!terminal) throw streamError({}, { code: 'STREAM_PREMATURE_CLOSE' });
        break;
      }
      size += value.byteLength;
      if (size > 65536) throw streamError({}, { code: 'STREAM_TOO_LARGE' });
      buffer += decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const token = processFrame(frame);
        if (token) yield token;
        if (terminal) break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
module.exports = { parseStream };

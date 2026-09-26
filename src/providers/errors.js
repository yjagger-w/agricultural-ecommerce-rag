'use strict';
function streamError(detail, { phase = 'stream', termination = 'provider-error', code = 'PROVIDER_ERROR' } = {}) {
  // Never expose provider messages, bodies, headers, prompts or parser excerpts.
  const error = new Error('Model service unavailable');
  error.code = code;
  error.status = Number(detail?.status) || null;
  error.phase = phase;
  error.termination = termination;
  return error;
}
module.exports = { streamError };

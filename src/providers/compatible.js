// SPDX-License-Identifier: GPL-3.0-only
// Portions by Pickle Team; modified 2026-09-26: inject fetch, sanitize errors,
// remove desktop dependencies. See LICENSE and THIRD_PARTY_NOTICES.md.
const { streamError } = require('./errors');
function createStreamingLLM({ apiKey, baseURL, model, maxCompletionTokens, signal: defaultSignal, fetchImpl = fetch }) {
    const url = new URL(baseURL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid model base URL');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote models require HTTPS');
    return {
        streamChat: async (messages, { signal = defaultSignal } = {}) => {
            const endpoint = baseURL.replace(/\/+$/, '') + '/chat/completions';
            const payload = { model, messages, stream: true };
            if (Number.isInteger(maxCompletionTokens) && maxCompletionTokens > 0) {
                payload.max_completion_tokens = maxCompletionTokens;
            }
            let response;
            try { response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal,
            }); } catch (cause) {
                throw streamError(cause, { phase: 'request', termination: signal?.aborted ? 'user-abort' : 'request-failure' });
            }
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                throw streamError({ status: response.status },
                    { phase: 'http-response', termination: 'http-error', code: 'HTTP_' + response.status });
            }
            if (!response.body) {
                throw streamError({}, { phase: 'http-response', termination: 'missing-body', code: 'STREAM_MISSING_BODY' });
            }
            return response;
        },
    };
}
module.exports = { createStreamingLLM };

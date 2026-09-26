'use strict';
// Every test run disables fetch. The real adapter is tested with injected fetch
// stubs; HTTP integration tests are restricted to loopback, with no internet.
globalThis.fetch = async () => { throw new Error('Network fetch disabled during offline tests'); };
for (const name of ['node:http', 'node:https']) {
  const module = require(name), original = module.request;
  module.request = function guardedRequest(options, ...args) {
    const host = typeof options === 'string' || options instanceof URL ? new URL(options).hostname : options.hostname || options.host || 'localhost';
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('Non-loopback HTTP disabled during tests');
    return original.call(this, options, ...args);
  };
}

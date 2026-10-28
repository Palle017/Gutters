import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../site/js/request-api.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const retryMessage = 'The connection ended before a save could be confirmed. Retry safely using the same request.';

// Response headers arrive immediately, while a native stream keeps the body open.
// Advance only the helper's deadline; these tests perform no network or real wait.
function photoRead(t) {
  let body, signal, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const timers = [];
  const response = new Response(new ReadableStream({start(controller) { body = controller; }}), {headers: {'Content-Type': 'image/jpeg'}});
  const context = vm.createContext({
    URL, FormData, AbortController, TypeError,
    location: {origin: 'http://127.0.0.1:18965', protocol: 'http:'},
    setTimeout(callback, milliseconds) { const timer = {callback, milliseconds, cleared: false}; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
    fetch: async (_url, options) => {
      signal = options.signal;
      signal.addEventListener('abort', () => body.error(new DOMException('Photo body aborted.', 'AbortError')), {once: true});
      return {ok: response.ok, blob() { markStarted(); return response.blob(); }};
    },
  });
  vm.runInContext(source, context);
  const pending = context.api('/conversations/synthetic/photos/synthetic', {binary: true});
  // A failed assertion must still consume the pending body's cleanup rejection.
  pending.catch(() => {});
  t.after(async () => { body.error(new DOMException('Test cleanup.', 'AbortError')); await pending.catch(() => {}); });
  return {
    pending, started, timers,
    signal: () => signal,
    complete(bytes) { body.enqueue(bytes); body.close(); },
    fail(error) { body.error(error); },
    expire() { for (const timer of timers) if (!timer.cleared) timer.callback(); },
  };
}

test('a photo body retains the existing deadline after headers and aborts with safe retry guidance', async t => {
  const read = photoRead(t);
  await read.started;
  assert.equal(read.timers.length, 1);
  assert.equal(read.timers[0].milliseconds, 25000);
  assert.equal(read.timers[0].cleared, false, 'the photo body is still being read');
  read.expire();
  assert.equal(read.signal().aborted, true);
  await assert.rejects(read.pending, error => error.message === retryMessage);
  assert.equal(read.timers[0].cleared, true, 'the settled read releases its timer');
});

test('a completed photo body returns its bytes and clears the deadline without aborting', async t => {
  const read = photoRead(t);
  await read.started;
  assert.equal(read.timers[0].cleared, false);
  const bytes = new Uint8Array([255, 216, 255, 217]);
  read.complete(bytes);
  const photo = await read.pending;
  assert.equal(photo.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), bytes);
  assert.equal(read.timers[0].cleared, true);
  assert.equal(read.signal().aborted, false);
});

test('a photo connection failure after headers uses the existing retry guidance and clears its deadline', async t => {
  const read = photoRead(t);
  await read.started;
  read.fail(new TypeError('Synthetic connection lost while reading the photo.'));
  await assert.rejects(read.pending, error => error.message === retryMessage);
  assert.equal(read.timers[0].cleared, true);
});

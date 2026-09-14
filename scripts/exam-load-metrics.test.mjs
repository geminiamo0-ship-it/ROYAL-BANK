import test from 'node:test';
import assert from 'node:assert/strict';
import { runStage, summarize } from './exam-load-metrics.mjs';

test('invalid sessions and HTTP failures cannot count as successes', () => {
  const summary = summarize([{ ok: true, ms: 20 }, { ok: false, ms: 1 }, { ms: 2 }]);
  assert.equal(summary.successful, 1);
  assert.equal(summary.errors, 2);
  assert.equal(summary.p95_ms, 20);
  assert.equal(summarize([]).p95_ms, null);
});
test('open-loop stage reports complete successful schedule', async () => {
  const result = await runStage({ rate: 10, durationSeconds: 0.3, users: 3,
    send: async () => ({ ok: true, ms: 10 }) });
  assert.equal(result.requests, 3);
  assert.equal(result.passed, true);
});
test('first failed request stops subsequent arrivals and fails stage', async () => {
  const result = await runStage({ rate: 10, durationSeconds: 1, users: 10,
    send: async () => ({ ok: false, ms: 1, status: 503 }) });
  assert.equal(result.requests, 1);
  assert.equal(result.passed, false);
  assert.equal(result.stop_reason, 'request_failed');
});
test('slow successes fail the latency gate', async () => {
  const result = await runStage({ rate: 10, durationSeconds: 1, users: 10,
    send: async () => ({ ok: true, ms: 6000 }) });
  assert.equal(result.passed, false);
  assert.equal(result.stop_reason, 'latency_limit');
});
test('generator exceptions cannot produce a green result', async () => {
  const result = await runStage({ rate: 10, durationSeconds: 1, users: 10,
    send: async () => { throw new Error('network'); } });
  assert.equal(result.passed, false);
  assert.equal(result.stop_reason, 'generator_exception');
});

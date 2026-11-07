// Unit tests for correlation-id validation: an incoming X-Request-ID is
// client-supplied and must be treated as untrusted (see src/lib/requestId.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRequestId } from '../../src/lib/requestId.ts';

test('a well-formed incoming id is reused as-is', () => {
  assert.equal(resolveRequestId('abc-123.DEF_456'), 'abc-123.DEF_456');
});

test('null (no header sent) gets a fresh generated id', () => {
  const id = resolveRequestId(null);
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('empty string gets a fresh generated id, not an empty one', () => {
  const id = resolveRequestId('');
  assert.notEqual(id, '');
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('an id over 128 characters is replaced, not truncated and reused', () => {
  const tooLong = 'a'.repeat(129);
  const id = resolveRequestId(tooLong);
  assert.notEqual(id, tooLong);
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('an id at exactly 128 characters is accepted', () => {
  const max = 'a'.repeat(128);
  assert.equal(resolveRequestId(max), max);
});

test('control characters (log/header injection attempt) are rejected', () => {
  for (const bad of ['abc\r\nX-Injected: 1', 'abc\ndef', 'abc\tdef', 'abc\0def']) {
    const id = resolveRequestId(bad);
    assert.notEqual(id, bad);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});

test('whitespace and other unsafe characters are rejected', () => {
  for (const bad of ['has space', 'semi;colon', 'slash/es', 'quote"here', "<script>"]) {
    const id = resolveRequestId(bad);
    assert.notEqual(id, bad);
  }
});

test('generated ids are unique across calls', () => {
  const a = resolveRequestId(null);
  const b = resolveRequestId(null);
  assert.notEqual(a, b);
});

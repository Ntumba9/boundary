// Unit tests for log redaction and the test runner's target allowlist.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact } from '../../src/lib/redact.ts';
import { checkTarget } from '../../test-runner/config.ts';

test('redact removes sensitive keys recursively', () => {
  const out = redact({
    email: 'a@b.example',
    password: 'hunter2hunter2',
    nested: { sessionToken: 'abc', cookie: 'x=y', body: 'secret document text', ok: 1 },
    list: [{ csrf: 'z' }],
  }) as Record<string, unknown>;
  assert.equal(out.email, 'a@b.example');
  assert.equal(out.password, '[REDACTED]');
  assert.deepEqual(out.nested, { sessionToken: '[REDACTED]', cookie: '[REDACTED]', body: '[REDACTED]', ok: 1 });
  assert.deepEqual(out.list, [{ csrf: '[REDACTED]' }]);
});

test('redact masks 64-hex tokens inside free text', () => {
  const token = 'a'.repeat(64);
  assert.equal(redact(`token was ${token}`), 'token was [REDACTED_TOKEN]');
});

test('runner allows loopback targets', () => {
  for (const u of ['http://localhost:3000', 'http://127.0.0.1:3300', 'http://[::1]:3000']) {
    const r = checkTarget(u, false);
    assert.equal(r.ok && r.isLocal, true, u);
  }
});

test('runner refuses non-allowlisted hosts even with --i-am-authorized', () => {
  assert.equal(checkTarget('https://example.com', true).ok, false);
  assert.equal(checkTarget('http://localhost.example.com', true).ok, false);
});

test('runner refuses odd schemes and embedded credentials', () => {
  assert.equal(checkTarget('file:///etc/passwd', true).ok, false);
  assert.equal(checkTarget('http://user:pw@localhost:3000', true).ok, false);
});

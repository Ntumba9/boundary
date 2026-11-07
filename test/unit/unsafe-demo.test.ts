// Unit tests for the unsafe-demo guard: it must be OFF unless every condition holds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostnameFromHostHeader, isUnsafeDemoEnabled } from '../../src/lib/unsafe-demo.ts';

const on = { BOUNDARY_UNSAFE_DEMO_MODE: '1', BOUNDARY_ALLOW_UNSAFE: 'local-demo-only', NODE_ENV: 'development' };

test('off by default', () => {
  assert.equal(isUnsafeDemoEnabled({}, 'localhost:3000'), false);
  assert.equal(isUnsafeDemoEnabled({ NODE_ENV: 'development' }, 'localhost:3000'), false);
});

test('on only when both env vars, non-production and localhost host', () => {
  assert.equal(isUnsafeDemoEnabled(on, 'localhost:3000'), true);
  assert.equal(isUnsafeDemoEnabled(on, '127.0.0.1:3300'), true);
  assert.equal(isUnsafeDemoEnabled(on, '[::1]:3000'), true);
});

test('either env var alone is not enough', () => {
  assert.equal(isUnsafeDemoEnabled({ ...on, BOUNDARY_ALLOW_UNSAFE: undefined }, 'localhost'), false);
  assert.equal(isUnsafeDemoEnabled({ ...on, BOUNDARY_UNSAFE_DEMO_MODE: undefined }, 'localhost'), false);
  assert.equal(isUnsafeDemoEnabled({ ...on, BOUNDARY_UNSAFE_DEMO_MODE: 'true' }, 'localhost'), false);
  assert.equal(isUnsafeDemoEnabled({ ...on, BOUNDARY_ALLOW_UNSAFE: 'yes' }, 'localhost'), false);
});

test('never in production', () => {
  assert.equal(isUnsafeDemoEnabled({ ...on, NODE_ENV: 'production' }, 'localhost:3000'), false);
});

test('never for non-local hosts', () => {
  for (const h of ['example.com', 'localhost.evil.com', '10.0.0.8:3000', 'evil.com:3000', '', null, undefined]) {
    assert.equal(isUnsafeDemoEnabled(on, h), false, String(h));
  }
});

test('host header parsing', () => {
  assert.equal(hostnameFromHostHeader('LocalHost:3000'), 'localhost');
  assert.equal(hostnameFromHostHeader('[::1]:8080'), '[::1]');
  assert.equal(hostnameFromHostHeader(null), '');
});

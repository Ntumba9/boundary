// Redaction for log output. No imports, so it is unit-testable with node:test.
//
// Policy: never log passwords, raw tokens, cookies, or document bodies.
// Any key whose name matches SENSITIVE_KEY is replaced with "[REDACTED]",
// recursively. Strings that look like our 64-hex-char tokens are also masked
// in case one ends up in a free-text message.

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|csrf|session|body|hash/i;
const HEX_TOKEN = /\b[a-f0-9]{64}\b/gi;
const MAX_DEPTH = 6;

export function redactString(value: string): string {
  return value.replace(HEX_TOKEN, '[REDACTED_TOKEN]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Error) {
      return { name: value.name, message: redactString(value.message) };
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

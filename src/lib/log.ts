import 'server-only';
import { redact, redactString } from './redact';
import { getRequestId } from './requestContext';

// Tiny structured logger. Everything passes through redact() first, so callers
// cannot accidentally log a password, token, cookie or document body by
// passing the wrong object. Callers should still log IDs and outcomes, not
// payloads.

type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields?: Record<string, unknown>): void {
  const requestId = getRequestId();
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    event: redactString(event),
    ...(requestId ? { requestId } : {}),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};

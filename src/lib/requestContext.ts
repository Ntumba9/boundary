import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

// Makes the current request's correlation id available to any code running
// inside the request (services, db.ts, log.ts) without threading it through
// every function signature. AsyncLocalStorage propagates across `await`, so
// this works through service calls, transactions and nested log.* calls.
const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

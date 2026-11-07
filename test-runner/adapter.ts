// ENDPOINT ADAPTER
//
// The test cases (cases.ts) never build URLs or know about cookies. They call
// the small typed interface below. BoundaryHttpAdapter implements it against
// THIS app's HTTP API (routes under src/app/api).
//
// This runner does NOT understand arbitrary APIs. To test a different
// application you must write a new class implementing AuthzTargetAdapter
// against that application's real endpoints, auth mechanism and CSRF scheme,
// and update fixtures.ts with that application's test identities and IDs.
// Only do that for systems you own or are explicitly authorized to test.

import { safeFetch } from './safe-http.ts';

export interface ApiResult<T = unknown> {
  status: number;
  body: T | null;
}

/** An authenticated client identity. Holds cookies in memory only; never printed or written to disk. */
export interface Session {
  readonly label: string;
  readonly cookies: Map<string, string>;
  csrfToken: string;
}

export interface LoginResult {
  status: number;
  session: Session | null;
}

export type Role = 'admin' | 'member';

export interface DocumentInput {
  title: string;
  body: string;
}

export interface AuthzTargetAdapter {
  health(): Promise<ApiResult<{ ok: boolean; unsafeDemoMode: boolean }>>;
  login(label: string, email: string, password: string): Promise<LoginResult>;
  me(s: Session): Promise<ApiResult<{ userId: string; role: Role; companyId: string }>>;

  getDocument(s: Session, id: string): Promise<ApiResult<{ id: string; companyId: string; body: string; title: string }>>;
  listDocuments(s: Session, projectId: string): Promise<ApiResult<Array<{ id: string; companyId: string }>>>;
  createDocument(s: Session, projectId: string, input: DocumentInput): Promise<ApiResult<{ id: string; ownerUserId: string; companyId: string }>>;
  updateDocument(s: Session, id: string, input: Partial<DocumentInput>): Promise<ApiResult<{ id: string; body: string; title: string }>>;
  deleteDocument(s: Session, id: string): Promise<ApiResult>;

  getProject(s: Session, id: string): Promise<ApiResult<{ id: string; name: string }>>;
  createProject(s: Session, name: string): Promise<ApiResult<{ id: string }>>;
  updateProject(s: Session, id: string, name: string): Promise<ApiResult>;
  deleteProject(s: Session, id: string): Promise<ApiResult>;

  listUsers(s: Session): Promise<ApiResult<Array<{ id: string; email: string; role: Role; isActive: boolean }>>>;
  createUser(s: Session, email: string, password: string): Promise<ApiResult<{ id: string; role: Role }>>;
  changeRole(s: Session, userId: string, role: Role): Promise<ApiResult>;
  deactivateUser(s: Session, userId: string): Promise<ApiResult>;
}

/** Options for raw requests used by the app-specific "defense extras" cases (CSRF, mass assignment). */
export interface RawOptions {
  body?: unknown;
  /** Send the JSON body chunked (streamed, no Content-Length) instead of with a declared length. */
  chunked?: boolean;
  /** 'session' = correct token (default), 'omit' = no header, or a literal wrong value. */
  csrf?: 'session' | 'omit' | { value: string };
  /** Replace the session cookie value (forged-token test). */
  sessionCookieOverride?: string;
}

const SESSION_COOKIE = 'boundary_session';
const CSRF_COOKIE = 'boundary_csrf';

export class BoundaryHttpAdapter implements AuthzTargetAdapter {
  private readonly origin: string;

  constructor(baseUrl: URL) {
    this.origin = baseUrl.origin;
  }

  /** Low-level request. Exposed for the BOUNDARY-specific extra cases; normal cases use the typed methods. */
  async raw<T = unknown>(s: Session | null, method: string, path: string, opts: RawOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (s) {
      const jar = new Map(s.cookies);
      if (opts.sessionCookieOverride !== undefined) jar.set(SESSION_COOKIE, opts.sessionCookieOverride);
      headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (method !== 'GET') {
        const csrf = opts.csrf ?? 'session';
        if (csrf === 'session') headers['x-csrf-token'] = s.csrfToken;
        else if (csrf !== 'omit') headers['x-csrf-token'] = csrf.value;
      }
    }
    let reqBody: string | ReadableStream<Uint8Array> | undefined;
    if (opts.body !== undefined) {
      const text = JSON.stringify(opts.body);
      if (opts.chunked) {
        const bytes = new TextEncoder().encode(text);
        // Two chunks, so the request really exercises a streamed body.
        reqBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 64));
            controller.enqueue(bytes.subarray(64));
            controller.close();
          },
        });
      } else {
        reqBody = text;
      }
    }
    const res = await safeFetch(this.origin, this.origin + path, { method, headers, body: reqBody });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: res.status, body: body as T };
  }

  health() {
    return this.raw<{ ok: boolean; unsafeDemoMode: boolean }>(null, 'GET', '/api/health');
  }

  async login(label: string, email: string, password: string): Promise<LoginResult> {
    const res = await safeFetch(this.origin, `${this.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await res.body?.cancel();
    if (res.status !== 200) return { status: res.status, session: null };
    const cookies = new Map<string, string>();
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const csrfToken = cookies.get(CSRF_COOKIE) ?? '';
    if (!cookies.get(SESSION_COOKIE) || !csrfToken) return { status: res.status, session: null };
    return { status: res.status, session: { label, cookies, csrfToken } };
  }

  me(s: Session) {
    return this.raw<{ userId: string; role: Role; companyId: string }>(s, 'GET', '/api/me');
  }

  getDocument(s: Session, id: string) {
    return this.raw<{ id: string; companyId: string; body: string; title: string }>(s, 'GET', `/api/documents/${enc(id)}`);
  }

  async listDocuments(s: Session, projectId: string) {
    return firstPage(await this.raw<Page<{ id: string; companyId: string }>>(s, 'GET', `/api/projects/${enc(projectId)}/documents`));
  }

  createDocument(s: Session, projectId: string, input: DocumentInput) {
    return this.raw<{ id: string; ownerUserId: string; companyId: string }>(s, 'POST', `/api/projects/${enc(projectId)}/documents`, { body: input });
  }

  updateDocument(s: Session, id: string, input: Partial<DocumentInput>) {
    return this.raw<{ id: string; body: string; title: string }>(s, 'PATCH', `/api/documents/${enc(id)}`, { body: input });
  }

  deleteDocument(s: Session, id: string) {
    return this.raw(s, 'DELETE', `/api/documents/${enc(id)}`);
  }

  getProject(s: Session, id: string) {
    return this.raw<{ id: string; name: string }>(s, 'GET', `/api/projects/${enc(id)}`);
  }

  createProject(s: Session, name: string) {
    return this.raw<{ id: string }>(s, 'POST', '/api/projects', { body: { name } });
  }

  updateProject(s: Session, id: string, name: string) {
    return this.raw(s, 'PATCH', `/api/projects/${enc(id)}`, { body: { name } });
  }

  deleteProject(s: Session, id: string) {
    return this.raw(s, 'DELETE', `/api/projects/${enc(id)}`);
  }

  async listUsers(s: Session) {
    return firstPage(
      await this.raw<Page<{ id: string; email: string; role: Role; isActive: boolean }>>(s, 'GET', '/api/admin/users'),
    );
  }

  createUser(s: Session, email: string, password: string) {
    return this.raw<{ id: string; role: Role }>(s, 'POST', '/api/admin/users', { body: { email, password } });
  }

  changeRole(s: Session, userId: string, role: Role) {
    return this.raw(s, 'PUT', `/api/admin/users/${enc(userId)}/role`, { body: { role } });
  }

  deactivateUser(s: Session, userId: string) {
    return this.raw(s, 'PUT', `/api/admin/users/${enc(userId)}/active`, { body: { isActive: false } });
  }
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

/** List endpoints return `{ items, nextCursor }` (keyset pagination). */
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The adapter interface exposes lists as plain arrays so cases.ts stays
 * independent of this app's pagination envelope. Only the first page is
 * returned; the seeded fixtures fit well within the default page size.
 * Error responses keep their status; their body becomes null (cases only
 * assert on the status of a failed list call).
 */
function firstPage<T>(res: ApiResult<Page<T>>): ApiResult<T[]> {
  const b = res.body as unknown;
  if (b && typeof b === 'object' && Array.isArray((b as Page<T>).items)) {
    return { status: res.status, body: (b as Page<T>).items };
  }
  return { status: res.status, body: null };
}

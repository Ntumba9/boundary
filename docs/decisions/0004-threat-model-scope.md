# 4. Threat model scope: what this project does and does not try to prove

## Status

Accepted. Restated here because it's the decision every other ADR, and every test case, is answerable to: "is this in scope?"

## Context

A demo project that claims to be "about security" without a stated scope invites two bad outcomes: reviewers assume it covers more than it does (and get burned when it doesn't), or the author keeps adding unrelated hardening (MFA, rate limiting everywhere, secret rotation) that dilutes the one thing it's actually trying to prove cleanly. BOUNDARY exists to demonstrate a specific, narrow claim well -- tenant isolation and role enforcement, done carefully and provably -- not to be a general secure-coding showcase.

## Decision

Scope the threat model explicitly, in the README, and hold every feature and test case to it:

**In scope** (each has dedicated test-runner groups):
- Tenant isolation / horizontal escalation (IDOR across companies) -- groups 1, 2.
- Privilege escalation within a tenant (member acting as admin; mass assignment of `company_id`/`owner_user_id`/`role`) -- groups 3, 8.
- Stale authorization: a deactivated user or demoted admin continuing on an existing session -- groups 5, 6.
- CSRF against cookie-authenticated mutations -- group 8.
- Online password guessing (basic throttling) -- group 8.
- Secrets in logs (redaction) -- `src/lib/redact.ts`, unit-tested directly.
- As of this change: request traceability without leaking anything -- group 10 (an incoming `X-Request-ID` is validated and bounded, never trusted or reflected unsafely; every response, success or error, carries one).

**Explicitly out of scope** (stated, not silently absent):
- XSS hardening beyond React's default escaping and the nonce-based CSP (no Trusted Types, no CSP violation-reporting endpoint).
- Rate limiting beyond login lockout and the admin-mutation throttle; no general DoS protection.
- Infrastructure security: TLS termination, secret management, network policy, DB hardening, backups. The Docker credentials in this repo are throwaway local values, not a statement about how secrets should be managed in a real deployment.
- Account lifecycle: password reset, MFA, email verification, session listing/remote logout UI.
- Audit logging beyond the admin-action log added in this change -- it covers admin user-management mutations specifically, not a general-purpose audit trail for every action in the system.
- Supply-chain security of dependencies.

## Alternatives considered

- **No explicit scope; let the README's feature list imply it.** This is how a lot of demo and portfolio projects are written, and it's exactly what causes reviewers to either overtrust the project (assume MFA/XSS/DoS protections exist because "it's a security project") or dismiss it once they find one gap, without the author ever having claimed to cover it. An explicit out-of-scope list costs a few lines and removes the ambiguity in both directions.
- **Try to cover more ground (add basic MFA, generic rate limiting, secret rotation) to look more "complete."** Rejected on purpose, including for this change: the correlation-id work added here stays inside the stated scope (traceability, input validation, no secret/stack-trace leakage) rather than growing into a logging platform or a new auth factor. Breadth without depth would make every individual guarantee -- including the tenant-isolation one this project is actually built to prove -- harder to verify and easier to overstate.

## Trade-offs

- **Honesty costs completeness.** A reader who wants a production-ready starting point has to go add TLS termination, secret rotation, MFA, and general rate limiting themselves; none of that is pretended to be here.
- **Scope has to be re-checked on every change**, including this one. Before adding the audit log or the correlation-id header, each had to be checked against this list: the audit log is "audit logging," explicitly called out above as limited to admin actions, not a claim of comprehensive audit coverage; the correlation id is deliberately *not* framed as a logging/observability platform, just enough traceability to find a request's log lines, with its own validation so it doesn't become a new injection surface.
- **"All tests pass" means exactly the behaviors listed above are verified** -- the README says this directly -- not that the application is secure in general. That sentence is the real trade-off of having a scope at all: it only protects the project from being misread if someone actually reads it.

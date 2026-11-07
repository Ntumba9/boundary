<!--
Keep this short. A PR that touches the authorization boundary should explain
itself in a few sentences plus real command output, not prose.
-->

## Problem

<!-- What's wrong or missing today, in one or two sentences. Link an issue if there is one. -->

## Changes

<!-- What actually changed, as a short list. Name files/areas, not every line. -->

-

## Trade-offs

<!--
What did you deliberately NOT do, and why? (scope cut, simpler approach taken,
known limitation accepted.) If nothing was traded off, say so -- don't leave
this blank.
-->

## Test evidence

<!--
Paste real command output, not a description of what you expect it to say.
Delete any row you genuinely could not run, and say why in Remaining gaps
below -- do not mark it done.
-->

- [ ] `npm run lint` --
- [ ] `npm run typecheck` --
- [ ] `npm run test:unit` --
- [ ] `npm run test:authz` (safe mode) --
- [ ] `npm run test:authz:unsafe` (if this touches the demo toggle or its target query) --
- [ ] `npm run test:e2e` --
- [ ] `npm run docker:build` / CI `docker-build` job (if this touches the Dockerfile, build config, or anything the image needs at runtime) --
- [ ] CI run: <!-- link to the Actions run for this branch/PR -->

## Self-review checklist

- [ ] Every new or changed query that touches tenant data has `company_id = $tenant` in the same statement.
- [ ] No client input (body, query string, header) is trusted for `company_id`, `owner_user_id`, or `role`.
- [ ] No password, token, cookie, or document body is logged (check anything passed to `log.*`).
- [ ] New endpoints are wrapped in `authed()` (or `publicRoute()` with a stated reason) and covered by at least one runner case proving denial and one proving the allowed path (positive control).
- [ ] README/ADRs updated if this changes behavior described there -- not just code comments.
- [ ] No AI/assistant attribution anywhere in code, comments, commits, or this description.

# Architecture decision records

Short records of the decisions that shape BOUNDARY's authorization model and data layer. Format: **Context**, **Decision**, **Alternatives considered**, **Trade-offs**.

**Note on provenance.** BOUNDARY was built as a single, continuous effort rather than across a team with a running decision log, so these are not a historical record of debate that happened at the time. Each one is written against what the code actually does today, using the rationale already documented inline in the source and in the main [README](../../README.md#architecture) -- not invented after the fact to sound more deliberate than it was. Where a record adds reasoning beyond what was already written down, it says so as current analysis, not a past discussion.

| ADR | Decision |
|-----|----------|
| [0001](0001-raw-sql-over-orm.md) | Raw parameterized SQL instead of an ORM |
| [0002](0002-keyset-pagination.md) | Keyset (seek) pagination instead of `OFFSET` |
| [0003](0003-tenant-boundary-enforcement.md) | Tenant isolation enforced in SQL, not in middleware or at the ORM layer |
| [0004](0004-threat-model-scope.md) | Threat model scope: what this project does and does not try to prove |

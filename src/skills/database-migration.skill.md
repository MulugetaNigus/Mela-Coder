# Skill: Database Migration

## Role Definition
Act as a zero-downtime migration engineer for any schema, model, index, constraint, or persisted data shape change.

Core philosophy: Zero Downtime is Mandatory. Production data changes must be reversible, staged, and compatible during rollout.

## Activation Triggers
- Changes to database schemas, migrations, models, indexes, constraints, relations, seed data, backfills, or ORM entities.
- The task mentions migration, schema, model, table, column, index, constraint, relation, backfill, rollback, or data cleanup.

## Operational Rules
1. Use expand-and-contract migrations for production systems.
2. Make the first migration backward compatible whenever possible.
3. Deploy code that can read/write both old and new schema states during transition.
4. Backfill data in a safe, resumable, observable way.
5. Defer destructive cleanup to a later migration after verification.
6. Include rollback or forward-fix strategy before destructive operations.
7. If migration speed conflicts with data safety, data safety wins.

## Checklist
- Migration is backward compatible or the incompatibility is explicitly justified.
- Application code handles both old and new schema states during rollout.
- Backfill plan is batched or resumable for large data.
- Index creation and constraints are safe for the target database.
- Rollback or forward-fix path is documented.
- Destructive cleanup is separated from the initial deploy.

## Forbidden Actions
- Do not drop columns or tables without a verified rollback plan.
- Do not combine schema expansion, data backfill, and destructive cleanup in one risky step.
- Do not assume an empty production database.
- Do not add blocking migrations for large tables without checking database-specific safe patterns.

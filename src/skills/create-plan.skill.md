# Skill: Create Plan

## When to Use
- Use only when the user explicitly asks for a plan, design, architecture review, risk analysis, or says to think before editing
- Use for plan-only requests about features, refactoring, architectural changes
- **DO NOT use for**: greetings, simple questions, general conversation, quick answers
- **DO NOT use for**: ordinary implementation requests such as "fix", "add", "update", "remove", "change", or "build" unless the user asks for a plan first
- Skip this skill if the task is clearly conversational or requires only brief response

In explicit Plan Mode, **no files are written, no commands are executed.** You think. You design. You document. Normal coding tasks should not enter this skill.
 
---
 
## WHAT PLAN MODE IS
 
Explicit Plan Mode is a pure reasoning and design phase. You behave as a senior staff engineer doing
an architectural review and implementation design before a single line of code is touched.
The output is a structured, unambiguous implementation plan that any competent engineer —
or the agent itself in the next session — can execute exactly as written.
 
You do not hedge. You do not say "it depends." You make decisions, justify them briefly,
and document them precisely. Every section you write must be actionable.
 
---
 
## THINKING PROTOCOL — EXTENDED REASONING
 
Before writing any section of the plan, silently work through the following:
 
```
1. RESTATE the goal in your own words. What is actually being asked?
2. DECOMPOSE into sub-problems. What are the moving parts?
3. IDENTIFY constraints: language, framework, existing patterns, performance, security.
4. EXPLORE alternatives: at least 2 approaches for any non-trivial decision.
5. DECIDE and justify: pick the best approach, state why the others were rejected.
6. SEQUENCE the work: what must happen before what?
7. SURFACE risks: what can go wrong? What are the unknowns?
8. DEFINE done: what does success look like? How will it be verified?
```
 
Do this for every feature, every architectural decision, every data model choice.
Think deep before writing fast.
 
---
 
## PLAN OUTPUT STRUCTURE
 
Every plan must follow this exact structure. Do not skip sections.
 
---
 
### 0 · EXECUTIVE SUMMARY
 
One paragraph. What is being built, why, and what the plan covers.
No bullet points here — write in plain prose as if briefing a tech lead.
 
---
 
### 1 · GOAL & SUCCESS CRITERIA
 
**Goal:**
A single, precise sentence. Not "improve performance" — "reduce p99 API latency from ~800 ms to under 200 ms on the /search endpoint under 1 000 concurrent users."
 
**Success Criteria:**
Concrete, measurable, binary. Each criterion is either met or not.
 
```
- [ ] <measurable criterion 1>
- [ ] <measurable criterion 2>
- [ ] <measurable criterion 3>
```
 
**Out of Scope:**
Explicitly list what this plan does NOT cover. Prevents scope creep.
 
```
- <thing that is explicitly excluded>
```
 
---
 
### 2 · CURRENT STATE ANALYSIS
 
What exists today. Read the relevant files and describe:
 
- **Architecture snapshot:** How is the system currently structured?
- **Entry points:** Where does the relevant code start?
- **Data flow:** How does data move through the system today?
- **Pain points:** What exactly is broken, slow, or missing?
- **Relevant files:** List every file that will be read, modified, or created.
```
READ (no changes):
  src/...
 
MODIFY:
  src/...
 
CREATE:
  src/...
 
DELETE:
  src/...
```
 
---
 
### 3 · DECISION LOG
 
For every significant architectural or implementation decision, document it:
 
```
DECISION: <short title>
  Options considered:
    A) <option> — <trade-off>
    B) <option> — <trade-off>
    C) <option> — <trade-off>
  Chosen: <A / B / C>
  Reason: <one or two sentences — factual, not vague>
  Rejected because: <why A and B lost>
```
 
Repeat for every meaningful choice: data structure, API shape, state management,
error strategy, caching layer, auth approach, test strategy, etc.
 
---
 
### 4 · ARCHITECTURE & DESIGN
 
#### 4.1 · High-Level Architecture
 
Describe the target architecture in prose + ASCII diagram.
 
```
┌─────────────────────────────────┐
│         Client / CLI            │
└────────────┬────────────────────┘
             │ HTTP / IPC
┌────────────▼────────────────────┐
│         API Layer               │
│  routes/ · middleware/ · dto/   │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│         Service Layer           │
│  services/ · domain logic       │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│         Data Layer              │
│  repositories/ · DB / cache     │
└─────────────────────────────────┘
```
 
*(Replace with the actual diagram for the task. Always draw the real one.)*
 
#### 4.2 · Data Models
 
Define every new or modified data structure with types:
 
```typescript
// Example — replace with actual models
interface Task {
  id:        string;          // UUID v4
  title:     string;          // max 255 chars
  status:    TaskStatus;      // see enum below
  createdAt: Date;
  updatedAt: Date;
  metadata:  Record<string, unknown>;
}
 
type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
```
 
Include validation rules, constraints, and invariants that the code must enforce.
 
#### 4.3 · API / Interface Contract
 
If this involves a public interface (REST, CLI flags, exported functions, events):
 
```
Method   : POST
Path     : /api/v1/tasks
Auth     : Bearer token (JWT, RS256)
Body     : { title: string, metadata?: object }
Response : 201 { id, title, status, createdAt }
Errors   :
  400  — validation failure  { error: string, field: string }
  401  — unauthorized
  409  — duplicate title
  500  — internal (never expose details)
```
 
#### 4.4 · State Management
 
How is state held, mutated, and observed? Describe:
- Where state lives (memory, DB, cache, file)
- Who owns it (single writer rule)
- How consumers observe changes (polling, events, reactive)
- Invalidation strategy
#### 4.5 · Error Handling Strategy
 
```
Layer       Error type          Handling
─────────── ─────────────────── ─────────────────────────────
Validation  Bad input           Reject early, return 400 + field
Business    Domain violation    Return typed Result<T, E>
External    Network / DB        Retry with backoff, circuit break
Fatal       Unrecoverable       Log, alert, fail fast — never swallow
```
 
---
 
### 5 · IMPLEMENTATION PLAN
 
Ordered, dependency-aware task list. Each task is atomic — it can be reviewed and
tested independently. Estimated effort is in ideal coding hours, not calendar time.
 
```
Phase 1 — Foundation                                          (~X hrs)
──────────────────────────────────────────────────────────────────────
  [ ] 1.1  <task>
            Files: <list>
            What: <exactly what changes>
            Why first: <dependency reason>
 
  [ ] 1.2  <task>
            Files: <list>
            What: <exactly what changes>
            Depends on: 1.1
 
Phase 2 — Core Feature                                        (~X hrs)
──────────────────────────────────────────────────────────────────────
  [ ] 2.1  <task>
            Files: <list>
            What: <exactly what changes>
            Depends on: 1.x
 
  [ ] 2.2  <task>
            ...
 
Phase 3 — Tests & Verification                                (~X hrs)
──────────────────────────────────────────────────────────────────────
  [ ] 3.1  Unit tests for <module>
            Coverage target: <X>%
            Key cases: <list the non-obvious ones>
 
  [ ] 3.2  Integration test for <flow>
            Setup: <what fixtures / mocks are needed>
            Assertions: <what exactly is verified>
 
Phase 4 — Polish & Hardening                                  (~X hrs)
──────────────────────────────────────────────────────────────────────
  [ ] 4.1  <edge case handling>
  [ ] 4.2  <observability: logs, metrics, traces>
  [ ] 4.3  <documentation update>
```
 
---
 
### 6 · FILE MANIFEST
 
Every file the implementation will touch. No surprises.
 
```
src/
  module/
    index.ts          CREATE   — public entry point, re-exports
    service.ts        CREATE   — core business logic
    service.test.ts   CREATE   — unit tests
    types.ts          CREATE   — shared types for this module
    repository.ts     MODIFY   — add new query method
  shared/
    errors.ts         MODIFY   — add new error class
  routes/
    module.route.ts   CREATE   — HTTP handlers
 
docs/
  MODULE.md           CREATE   — usage documentation
```
 
---
 
### 7 · TEST PLAN
 
#### Unit Tests
| Function / Class         | Input scenario                  | Expected output        |
|--------------------------|---------------------------------|------------------------|
| `createTask()`           | valid payload                   | returns Task with id   |
| `createTask()`           | missing title                   | throws ValidationError |
| `createTask()`           | duplicate title                 | throws ConflictError   |
| `TaskRepository.save()`  | DB timeout                      | throws StorageError    |
 
#### Integration Tests
Describe the full happy path and at least two failure paths with setup, action, and assertion.
 
#### Edge Cases
Explicitly list the edge cases that *must* be covered:
```
- Empty string vs null vs undefined for optional fields
- Concurrent writes to the same resource
- Token expiry mid-request
- Payload at maximum size limit
- Unicode / emoji in string fields
```
 
---
 
### 8 · RISKS & MITIGATIONS
 
```
Risk                          Likelihood   Impact   Mitigation
──────────────────────────────────────────────────────────────────────────
<risk description>            High/Med/Low H/M/L    <concrete mitigation>
<risk description>            High/Med/Low H/M/L    <concrete mitigation>
```
 
**Unknowns** — things that must be investigated before or during implementation:
```
- <unknown 1>: investigate by reading <file or running <command>>
- <unknown 2>: needs clarification from <person or source>
```
 
---
 
### 9 · ROLLOUT & VERIFICATION
 
How will this be deployed and validated in production (or in the local environment)?
 
```
Step 1  Run: <command>              Expected: <output>
Step 2  Run: <command>              Expected: <output>
Step 3  Check: <file or endpoint>   Expected: <state>
Step 4  Smoke test: <scenario>      Expected: <behavior>
Rollback: <exactly how to undo this if it breaks>
```
 
---
 
### 10 · OPEN QUESTIONS
 
Questions that block implementation or require user input before starting:
 
```
Q1: <question>
    → Options: A) ... B) ...
    → Recommendation: <your suggestion>
 
Q2: <question>
    → Needs: decision from user
```
 
If there are no open questions, write: "None — ready to implement."
 
---
 
## PLAN MODE BEHAVIOR RULES
 
### DO
- Read every relevant file before writing the plan (use `read_file`, `glob`, `search_files`)
- Make concrete decisions — no "you could also…" hedging
- Use real file paths, real function names, real type names from the codebase
- Estimate effort honestly; flag when a phase is risky or uncertain
- Surface architectural problems even if the user didn't ask about them
- Write the test plan before the implementation plan (TDD mindset)
- Ask open questions grouped at the end, not scattered through the plan
### DO NOT
- Write any code in plan mode (no code blocks that would be pasted into files)
- Issue any tool calls other than read-only ones (read_file, glob, list_dir, search_files)
- Execute bash commands (no builds, no tests, no git)
- Modify, create, or delete files
- Use filler phrases: "Let's", "Great question", "Certainly", "Of course"
- Leave decisions unmade — if you can't decide, escalate in Open Questions
- Pad the plan with obvious observations or restate the user's request back at them
---
 
## TRANSITIONING OUT OF PLAN MODE
 
When the plan is complete, end with:
 
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLAN COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phases : <N>
Tasks  : <N> items
Est.   : ~<X> hours of implementation
Unknowns: <N open questions / "None">
 
To execute: reply with /execute, "go ahead", or "proceed"
To modify : reply with your changes and I will revise the plan
```
 
Do not begin implementation until the user explicitly approves.
Once approved, switch to normal agent mode and execute the plan task by task until the work is complete, blocked, or verification proves failure.
Do not ask for "proceed" again between phases or after ordinary successful tool calls.
Do not abandon the approved plan and ask "what task should I work on?" while any planned work remains.
 
---
 
## EXAMPLE TRIGGER PHRASES
 
The agent enters Plan Mode when it detects:
 
| Trigger                                              | Action              |
|------------------------------------------------------|---------------------|
| `/plan <task>`                                       | Full plan           |
| `--plan <task>`                                      | Full plan           |
| `plan how to <task>`                                 | Full plan           |
| `design the architecture for <task>`                 | Full plan           |
| `think through <task> before doing anything`         | Full plan           |
| `what's the best way to implement <task>`            | Decision Log + Plan |
| `review my approach to <task>`                       | Analysis + Gaps     |
| `what would break if I <task>`                       | Risk analysis only  |

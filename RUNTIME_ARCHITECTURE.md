# Mela-Coder Professional Runtime Architecture

## Complete Architecture Implementation - Phase 1

This document describes the professional runtime architecture now implemented in Mela-Coder.

---

## 1. COMPLETE ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER / CLI INTERFACE                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SESSION MANAGER                                  │
│  • Session lifecycle management                                              │
│  • User state persistence                                                    │
│  • Conversation history (JSONL)                                              │
│  • Task isolation                                                            │
│  • Checkpointing & recovery                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASK ORCHESTRATOR                                  │
│  • Receives user goals                                                       │
│  • Decomposes tasks into subtasks                                            │
│  • Manages execution loops                                                   │
│  • Coordinates retries                                                       │
│  • Coordinates subagents                                                     │
│  • Tracks progress                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             STATE MACHINE                                    │
│                                                                              │
│  ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌─────────┐            │
│  │   IDLE   │───▶│ PLANNING  │───▶│ INSPECTING │───▶│ EDITING │            │
│  └──────────┘    └───────────┘    └────────────┘    └────┬────┘            │
│       ▲               ▲                                   │                 │
│       │               │                                   ▼                 │
│  ┌────┴────┐     ┌────┴──────┐                      ┌───────────┐          │
│  │ COMPLETED│◀────│ RETRYING  │◀─────────────────────│ VERIFYING │          │
│  └──────────┘     └───────────┘                      └─────┬─────┘          │
│       ▲               ▲                                   │                 │
│       │               │                                   ▼                 │
│  ┌────┴────┐     ┌────┴──────┐                      ┌───────────┐          │
│  │  FAILED │◀────│  BLOCKED  │◀─────────────────────┴───────────┘          │
│  └──────────┘     └───────────┘                                            │
│                                                                              │
│  Transition Logic: Guard conditions, retry counting, error handling         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CONTEXT BUILDER                                   │
│  • System prompt (priority 0)                                                │
│  • Task state (priority 1)                                                   │
│  • Repo summaries (priority 2)                                               │
│  • Active files (priority 2)                                                 │
│  • Recent tool outputs (priority 3)                                          │
│  • Skill overlays (priority 1)                                               │
│  • Architecture memory (priority 2)                                          │
│  • Retrieved semantic context (priority 3)                                   │
│                                                                              │
│  Features: Context compaction, summarization, token budgeting, prioritization│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             LLM REASONER                                     │
│  • Stateless function                                                        │
│  • Next-action predictor only                                                │
│  • No execution control                                                      │
│  • Streaming response support                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TOOL EXECUTOR                                      │
│  • Filesystem tools (read, write, delete)                                    │
│  • Shell execution (with sandboxing)                                         │
│  • Search tools (glob, grep, semantic)                                       │
│  • Git operations                                                            │
│  • Network tools                                                             │
│  • Code analysis (AST parsing)                                               │
│                                                                              │
│  Governance: Permission boundaries, timeouts, structured outputs, retry      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VERIFICATION ENGINE                                  │
│  • Typechecking (tsc, mypy, etc.)                                            │
│  • Linting (eslint, flake8, etc.)                                            │
│  • Testing (npm test, pytest, etc.)                                          │
│  • Runtime validation                                                        │
│  • Regression checks                                                         │
│                                                                              │
│  Features: Failure classification, automated repair loops, targeted checks   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RESULT EVALUATOR                                    │
│  Decisions:                                                                  │
│  • SUCCESS → Complete task                                                   │
│  • RETRY → Attempt fix with context injection                                │
│  • ROLLBACK → Restore previous state                                         │
│  • CONTINUE → Proceed to next action                                         │
│  • CLARIFY → Ask user for clarification                                      │
│  • ESCALATE → Human intervention required                                    │
│                                                                              │
│  Classifications: Syntax, logic, environment, flaky, ambiguity, architecture │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MEMORY SYSTEM                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ SHORT-TERM      │  │ WORKING         │  │ LONG-TERM       │             │
│  │ (RAM)           │  │ (Graph DB)      │  │ (Vector DB)     │             │
│  │ • Current task  │  │ • Architecture  │  │ • Historical    │             │
│  │ • Active files  │  │ • Dependencies  │  │   fixes         │             │
│  │ • Recent actions│  │ • Conventions   │  │ • Patterns      │             │
│  │ • Errors        │  │ • Relationships │  │ • Workflows     │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
│  Operations: Semantic retrieval, summarization, checkpoint restore           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────┐
                    │  RETRY / CONTINUE / FINISH  │
                    └─────────────────────────────┘
```

---

## 2. COMPONENT BREAKDOWN

### 2.1 State Machine (`src/state/machine.ts`)

**Responsibility**: Enforce valid state transitions and track execution state.

**Inputs**: 
- Transition triggers (e.g., 'start_task', 'edit_complete')
- Guard conditions
- Error callbacks

**Outputs**:
- State transition results
- State history
- Retry counts

**Lifecycle**:
1. Initialized with initial state (IDLE)
2. Transitions triggered by orchestrator
3. Maintains history for debugging/recovery
4. Reset on task completion or failure

**Failure Modes**:
- Invalid transition → Returns error result
- Guard failure → Transition blocked
- Handler error → onError callback invoked

**Implementation Strategy**:
- Finite state machine with explicit transitions
- Guard functions for conditional transitions
- Action hooks for side effects
- Serializable state for checkpointing

---

### 2.2 Task Orchestrator (`src/orchestration/taskOrchestrator.ts`)

**Responsibility**: Manage task decomposition, execution, and coordination.

**Inputs**:
- User goals
- Subtask definitions
- Phase completion/failure signals

**Outputs**:
- Task definitions with status
- Execution progress
- Task results

**Lifecycle**:
1. Create task from goal
2. Optionally decompose into subtasks
3. Start execution
4. Track phase transitions
5. Complete or fail task

**Failure Modes**:
- Task not found → Throw error
- Already running → Reject new task
- Max retries exceeded → Fail task

**Implementation Strategy**:
- Map-based task storage
- Parent-child task relationships
- Progress tracking with percentages
- Serialization for recovery

---

### 2.3 Context Builder (`src/context/builder.ts`)

**Responsibility**: Dynamically assemble LLM context within token budget.

**Inputs**:
- Context layers with priorities
- Token budget constraints
- Compression hints

**Outputs**:
- Built context string
- Token usage statistics
- Compression/discard warnings

**Lifecycle**:
1. Add layers with priorities
2. Optionally add summaries for compression
3. Build final context respecting budget
4. Clear after use

**Failure Modes**:
- Budget exceeded → Warnings issued
- Missing layer → Skip silently
- Invalid priority → Insert at end

**Implementation Strategy**:
- Priority-ordered layer insertion
- Token estimation per layer
- Summary-based compression
- Configurable token estimator

---

### 2.4 Result Evaluator (`src/runtime/resultEvaluator.ts`)

**Responsibility**: Classify failures and determine next actions.

**Inputs**:
- Verification results
- Tool outputs
- State history
- Retry counts

**Outputs**:
- Evaluation decisions (SUCCESS, RETRY, etc.)
- Failure categories
- Clarification questions

**Lifecycle**:
1. Receive verification results
2. Categorize failures
3. Apply decision rules
4. Generate report

**Failure Modes**:
- Unknown failure → Default to RETRY
- Ambiguous requirements → CLARIFY
- Architecture conflicts → ESCALATE

**Implementation Strategy**:
- Pattern-matching for error classification
- Priority-ordered category handling
- Confidence scoring
- Report generation

---

### 2.5 Runtime Engine (`src/runtime/engine.ts`)

**Responsibility**: Orchestrate all components into cohesive execution.

**Inputs**:
- User goals
- LLM reasoner implementation
- Tool registry
- Verification chain

**Outputs**:
- Task results
- Event stream
- Checkpoints

**Lifecycle**:
1. Initialize all components
2. Attach dependencies (LLM, tools, verification)
3. Execute task loop
4. Emit events throughout
5. Return final result

**Failure Modes**:
- No LLM attached → Throw error
- Max iterations → Fail task
- Unhandled error → Emit and fail

**Implementation Strategy**:
- Component composition
- Event-driven architecture
- Async iteration for streaming
- Checkpoint creation

---

## 3. EXECUTION FLOW

### 3.1 Task Lifecycle

```
USER GOAL
    │
    ▼
┌─────────────────────┐
│  Create Task        │
│  (orchestrator)     │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Start Task         │
│  → IDLE → PLANNING  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Build Context      │
│  (context builder)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  LLM Reasoning      │
│  (streaming)        │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Parse Response     │
│  (tool calls/text)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Execute Tools      │
│  (with permissions) │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Verify Results     │
│  (typecheck/lint/   │
│   test)             │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Evaluate Outcome   │
│  (success/retry/    │
│   escalate)         │
└─────────────────────┘
    │
    ├─────────────┬──────────────┬─────────────┐
    ▼             ▼              ▼             ▼
┌───────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐
│SUCCESS│   │  RETRY   │   │CLARIFY  │   │ESCALATE │
└───────┘   └──────────┘   └─────────┘   └─────────┘
```

### 3.2 Reasoning Loop

```
┌──────────────────────────────────────────────────────────────┐
│                   REASONING LOOP                              │
│                                                               │
│  1. Observe current state                                     │
│  2. Build context (state + memory + tools)                    │
│  3. Request LLM prediction                                    │
│  4. Parse predicted action                                    │
│  5. Validate action (permissions, safety)                     │
│  6. Execute action                                            │
│  7. Capture result                                            │
│  8. Verify outcome                                            │
│  9. Update memory                                             │
│  10. Decide: continue / retry / finish                        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Verification Loop

```
TOOL EXECUTION COMPLETE
    │
    ▼
┌─────────────────────┐
│  Was edit made?     │──No──▶ Continue execution
└─────────────────────┘
    │ Yes
    ▼
┌─────────────────────┐
│  Run typecheck      │
└─────────────────────┘
    │
    ├────Fail────▶┌─────────────────┐
    │             │  Inject error   │
    │             │  into context   │
    │             └─────────────────┘
    │                      │
    │                      ▼
    │             ┌─────────────────┐
    │             │  LLM auto-fix   │
    │             └─────────────────┘
    │                      │
    │                      └──────┐
    │                             │
    ▼ Pass                        │
┌─────────────────────┐           │
│  Run linter         │           │
└─────────────────────┘           │
    │                             │
    ├────Fail────▶ (same loop)    │
    │                             │
    ▼ Pass                        │
┌─────────────────────┐           │
│  Run tests          │           │
└─────────────────────┘           │
    │                             │
    ├────Fail────▶ (same loop)    │
    │                             │
    ▼ Pass                        │
┌─────────────────────┐           │
│  Verification OK    │◀──────────┘
└─────────────────────┘
```

### 3.4 Retry Loop

```
VERIFICATION FAILED
    │
    ▼
┌─────────────────────┐
│  Classify failure   │
│  (evaluator)        │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Check retry count  │
└─────────────────────┘
    │
    ├─Max reached─▶ ESCALATE
    │
    ▼ Within limit
┌─────────────────────┐
│  Determine strategy │
│  • Syntax → Auto-fix│
│  • Type → Auto-fix  │
│  • Logic → Replan   │
│  • Runtime → Debug  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Inject error info  │
│  into context       │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Request LLM fix    │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Execute fix        │
└─────────────────────┘
    │
    └──────▶ Back to Verification Loop
```

### 3.5 Memory Updates

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY UPDATE FLOW                        │
│                                                              │
│  After each tool execution:                                  │
│  1. Update short-term memory (active files, recent actions)  │
│  2. If pattern detected → Update working memory              │
│  3. If significant event → Log to long-term memory           │
│                                                              │
│  Periodic maintenance:                                       │
│  1. Compact short-term (sliding window)                      │
│  2. Summarize working memory                                 │
│  3. Embed and store long-term memories                       │
│                                                              │
│  On retrieval request:                                       │
│  1. Query short-term (exact match)                           │
│  2. Query working memory (graph traversal)                   │
│  3. Query long-term (semantic similarity)                    │
│  4. Merge and rank results                                   │
│  5. Inject into context                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. STATE MACHINE DESIGN

### 4.1 States

| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| **IDLE** | No active task | Reset retry counter | - |
| **PLANNING** | Creating/refining plan | Clear working memory | Store plan |
| **INSPECTING** | Reading files/understanding | Track inspected files | Update repo summary |
| **EDITING** | Making code changes | Backup modified files | Trigger verification |
| **VERIFYING** | Running quality gates | - | Record results |
| **RETRYING** | Fixing failed operation | Increment retry count | Clear error context |
| **BLOCKED** | Waiting for resolution | Log blocker | Notify user |
| **COMPLETED** | Task finished successfully | Save artifacts | - |
| **FAILED** | Task failed permanently | Log failure reason | - |

### 4.2 Transitions

```
IDLE ─[start_task]→ PLANNING

PLANNING ─[plan_created]→ INSPECTING
PLANNING ─[direct_edit]→ EDITING
PLANNING ─[plan_blocked]→ BLOCKED
PLANNING ─[plan_failed]→ FAILED

INSPECTING ─[inspection_complete]→ EDITING
INSPECTING ─[need_replan]→ PLANNING
INSPECTING ─[inspection_blocked]→ BLOCKED

EDITING ─[edit_complete]→ VERIFYING
EDITING ─[edit_failed]→ RETRYING (if retries < max)
EDITING ─[edit_blocked]→ BLOCKED

VERIFYING ─[verification_passed]→ COMPLETED
VERIFYING ─[verification_failed]→ RETRYING (if retries < max)
VERIFYING ─[verification_fixable]→ EDITING
VERIFYING ─[verification_blocked]→ BLOCKED

RETRYING ─[retry_replan]→ PLANNING
RETRYING ─[retry_edit]→ EDITING
RETRYING ─[retry_exhausted]→ FAILED

BLOCKED ─[block_resolved]→ PLANNING
BLOCKED ─[block_unresolvable]→ FAILED

FAILED ─[reset]→ IDLE
COMPLETED ─[reset]→ IDLE
```

### 4.3 Recovery States

- **RETRYING**: Automatic recovery with incremented retry count
- **BLOCKED**: Requires external resolution (user input or system fix)
- **FAILED**: Terminal state requiring manual reset

### 4.4 Interruption Handling

```
SIGINT/SIGTERM received
    │
    ▼
┌─────────────────────┐
│  Save checkpoint    │
│  • Current state    │
│  • Task progress    │
│  • Context layers   │
│  • Working memory   │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Graceful shutdown  │
│  • Cancel pending   │
│  • Close resources  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Exit cleanly       │
└─────────────────────┘

On restart:
    │
    ▼
┌─────────────────────┐
│  Load checkpoint    │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Resume execution   │
│  or offer rollback  │
└─────────────────────┘
```

---

## 5. MEMORY ARCHITECTURE

### 5.1 Three-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│                     MEMORY HIERARCHY                         │
│                                                              │
│  TIER 1: SHORT-TERM (RAM)                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Current task definition                            │    │
│  │ • Active file paths                                  │    │
│  │ • Recent tool calls (last N)                         │    │
│  │ • Recent errors                                      │    │
│  │ • Working variables                                  │    │
│  │                                                      │    │
│  │ Characteristics:                                     │    │
│  │ - Volatile (lost on restart)                         │    │
│  │ - Fast access (O(1))                                 │    │
│  │ - Limited size (configurable)                        │    │
│  │ - Sliding window eviction                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  TIER 2: WORKING (Graph Database)                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Architecture summaries                             │    │
│  │ • Dependency graphs                                  │    │
│  │ • Module relationships                               │    │
│  │ • Project conventions                                │    │
│  │ • File relationship mappings                         │    │
│  │                                                      │    │
│  │ Characteristics:                                     │    │
│  │ - Persistent (saved to disk)                         │    │
│  │ - Graph queries (traversal)                          │    │
│  │ - Medium latency                                     │    │
│  │ - Updated on structural changes                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  TIER 3: LONG-TERM (Vector Database)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Historical fixes                                   │    │
│  │ • Recurring patterns                                 │    │
│  │ • Learned workflows                                  │    │
│  │ • Project-specific knowledge                         │    │
│  │ • Semantic code snippets                             │    │
│  │                                                      │    │
│  │ Characteristics:                                     │    │
│  │ - Persistent (indexed)                               │    │
│  │ - Semantic search (embeddings)                       │    │
│  │ - Higher latency                                     │    │
│  │ - Grows over time                                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Retrieval Flow

```
RETRIEVAL REQUEST (query, filters)
    │
    ▼
┌─────────────────────┐
│  Query Short-Term   │
│  (exact match)      │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Query Working      │
│  (graph traversal)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Query Long-Term    │
│  (semantic search)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Merge Results      │
│  (deduplicate)      │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Rank by Relevance  │
│  (recency + score)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Inject into Context│
│  (respect budget)   │
└─────────────────────┘
```

### 5.3 Compaction Flow

```
PERIODIC TRIGGER (token threshold / time)
    │
    ▼
┌─────────────────────┐
│  Analyze Usage      │
│  (identify cold     │
│   data)             │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Summarize Old      │
│  Entries            │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Archive to Lower   │
│  Tier               │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Update Indexes     │
└─────────────────────┘
```

### 5.4 Semantic Indexing

- Embeddings generated for code snippets, error messages, and solutions
- Metadata includes: timestamp, task context, success/failure, file paths
- Indexed using cosine similarity for retrieval
- Filtered by project, task type, and recency

### 5.5 Summarization Strategy

- **Short-term**: Sliding window (keep last N items)
- **Working**: Graph condensation (merge similar nodes)
- **Long-term**: Embedding-based clustering (group related memories)

---

## 6. TOOL GOVERNANCE DESIGN

### 6.1 Permission Levels

| Level | Operations | Auto-approve | Requires Confirmation |
|-------|------------|--------------|----------------------|
| **READ** | read_file, list_dir, search_files, glob | Yes | No |
| **WRITE_LOCAL** | write_file, edit_file (tracked files) | Configurable | If outside tracked |
| **WRITE_REMOTE** | write_file (untracked), execute_bash | No | Always |
| **DESTRUCTIVE** | delete_file, rm -rf, dangerous commands | No | Always + explicit flag |

### 6.2 Isolation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    TOOL SANDBOXING                           │
│                                                              │
│  Filesystem Isolation:                                       │
│  • Allowed directories configuration                         │
│  • Symlink resolution                                        │
│  • Path traversal prevention                                 │
│                                                              │
│  Process Isolation:                                          │
│  • Timeout enforcement                                       │
│  • Resource limits (memory, CPU)                             │
│  • Signal handling                                           │
│                                                              │
│  Network Isolation:                                          │
│  • Allowed hosts whitelist                                   │
│  • Port restrictions                                         │
│  • Protocol filtering                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Validation

- Input schema validation (Zod/Pydantic)
- Output structure validation
- Side-effect detection
- Dangerous pattern blocking

### 6.4 Execution Policies

```yaml
policies:
  execute_bash:
    timeout: 60s
    allowed_patterns:
      - "npm .*"
      - "yarn .*"
      - "cargo .*"
      - "go .*"
      - "python .*"
    blocked_patterns:
      - "rm -rf /"
      - "sudo .*"
      - "curl .* | sh"
    
  write_file:
    max_size: 1MB
    allowed_extensions: [".ts", ".js", ".py", ".md", ".json"]
    backup: true
    
  delete_file:
    require_confirmation: true
    keep_backup: true
    backup_ttl: 24h
```

---

## 7. CONTEXT ENGINEERING STRATEGY

### 7.1 What Enters Context

**Always Included (Priority 0)**:
- System prompt (core instructions)
- Current task goal
- Current state indicator

**High Priority (Priority 1)**:
- Active skill overlays
- Recent tool outputs (last 3)
- Current blockers/errors

**Medium Priority (Priority 2)**:
- Inspected files summary
- Edited files list
- Repo architecture summary
- Project conventions

**Low Priority (Priority 3)**:
- Completed tasks summary
- Historical context
- Semantic retrieval results

### 7.2 What Gets Summarized

- Conversation history beyond last 5 turns
- Tool outputs beyond last 3
- File contents beyond first 50 lines
- Multi-file operation summaries

### 7.3 What Gets Discarded

- Successful verification details (keep only failures)
- Intermediate planning iterations
- Redundant information
- Low-relevance retrieved context

### 7.4 Token Budgeting

```
Total Budget: 128K tokens (configurable)

Allocation:
├── System Prompt: 5K (fixed)
├── Task Context: 2K (fixed)
├── State Info: 1K (fixed)
├── Active Files: 20K (compressible)
├── Recent History: 30K (compressible)
├── Memory Retrieval: 40K (compressible)
└── Response Buffer: 30K (reserved)
```

### 7.5 Prioritization Algorithm

```
function prioritize(layers, budget):
    sort layers by priority (ascending)
    result = []
    used = 0
    
    for layer in layers:
        if used + layer.tokens <= budget:
            result.append(layer)
            used += layer.tokens
        else if layer.compressible and layer.summary:
            if used + layer.summary_tokens <= budget:
                result.append(layer.summary)
                used += layer.summary_tokens
            else:
                discard(layer)
        else:
            discard(layer)
    
    return result
```

---

## 8. SKILL INJECTION ARCHITECTURE

### 8.1 Skill Activation

```
TASK RECEIVED
    │
    ▼
┌─────────────────────┐
│  Pattern Match      │
│  (keywords, files,  │
│   stack detection)  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Select Skills      │
│  (rank by relevance)│
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Load Skill Content │
│  (rules, workflows, │
│   heuristics)       │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Inject as Overlay  │
│  (append to context)│
└─────────────────────┘
```

### 8.2 Overlay Injection

Skills inject behavior through:

1. **Rules**: Additional constraints ("Always write tests first")
2. **Workflows**: Step-by-step procedures ("React component creation flow")
3. **Heuristics**: Domain-specific guidance ("Prefer composition over inheritance")
4. **Verification**: Stack-specific checks ("Run ESLint with React plugin")
5. **Tools**: Specialized tool configurations

### 8.3 Conflict Resolution

```
CONFLICT DETECTED (multiple skills define same rule)
    │
    ▼
┌─────────────────────┐
│  Specificity Check  │
│  (more specific     │
│   wins)             │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Recency Check      │
│  (later loaded wins)│
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Explicit Override  │
│  (skill priority)   │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Log Conflict       │
│  (for debugging)    │
└─────────────────────┘
```

### 8.4 Example Skills

```markdown
# React Skill (.skills/react.skill.md)

## Rules
- Always use TypeScript with React
- Prefer functional components with hooks
- Use strict mode in development

## Workflows
### Component Creation
1. Create component file
2. Add PropTypes/TypeScript types
3. Write unit tests
4. Add Storybook story

## Verification
- Run eslint with react plugin
- Run react-testing-library tests
- Check bundle size impact

## Heuristics
- Lift state up when siblings need it
- Memoize expensive computations
- Use error boundaries for isolation
```

---

## 9. FAILURE RECOVERY DESIGN

### 9.1 Retry Strategy

```
FAILURE DETECTED
    │
    ▼
┌─────────────────────┐
│  Classify Failure   │
│  (evaluator)        │
└─────────────────────┘
    │
    ├── SYNTAX_ERROR ──▶ Auto-inject error, request fix
    ├── TYPE_ERROR ────▶ Auto-inject error, request fix
    ├── LOGIC_ERROR ───▶ Replan approach
    ├── RUNTIME_ERROR ─▶ Debug and investigate
    ├── ENV_ERROR ─────▶ Escalate (config issue)
    ├── FLAKY_TEST ────▶ Retry (up to 3x)
    └── OTHER ─────────▶ Generic retry
```

### 9.2 Rollback Mechanism

```
CRITICAL FAILURE
    │
    ▼
┌─────────────────────┐
│  Identify Safe      │
│  Checkpoint         │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Restore Files      │
│  (from backup)      │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Restore Context    │
│  (working memory)   │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Resume from Point  │
│  (or replan)        │
└─────────────────────┘
```

### 9.3 Self-Healing

- **Syntax errors**: Automatic re-parsing and fix suggestion
- **Flaky tests**: Automatic retry with exponential backoff
- **Timeout issues**: Adjust parameters and retry
- **Resource issues**: Clean up and retry

### 9.4 Re-Planning

```
STUCK DETECTED (no progress after N iterations)
    │
    ▼
┌─────────────────────┐
│  Analyze History    │
│  (identify patterns)│
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Generate New Plan  │
│  (alternative path) │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Validate Plan      │
│  (feasibility check)│
└─────────────────────┘
    │
    ├── Valid ──▶ Execute new plan
    └── Invalid ─▶ Escalate to user
```

### 9.5 Escalation

```
ESCALATION TRIGGERED
    │
    ▼
┌─────────────────────┐
│  Generate Report    │
│  • Task goal        │
│  • Attempts made    │
│  • Errors encountered│
│  • Current state    │
│  • Suggested actions│
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Present to User    │
│  (CLI output)       │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Await Decision     │
│  • Continue         │
│  • Modify goal      │
│  • Abort            │
└─────────────────────┘
```

---

## 10. TECHNOLOGY RECOMMENDATIONS

### 10.1 Orchestration Frameworks

**Current**: Custom TypeScript with AsyncIO-style patterns

**Alternatives**:
- **XState**: Formal state machine library
- **Cauldron**: Workflow orchestration
- **Temporal.io**: Durable execution (for distributed scenarios)

### 10.2 Vector Databases

**Recommended**:
- **Chroma**: Lightweight, embeddable
- **Qdrant**: High-performance, Rust-based
- **Pinecone**: Managed service
- **pgvector**: PostgreSQL extension (if already using Postgres)

### 10.3 Indexing Systems

**Recommended**:
- **Tree-sitter**: Fast, incremental AST parsing
- **Sourcegraph LSIF**: Language Server Index Format
- **Custom graph**: Neo4j or in-memory graph (for small projects)

### 10.4 AST Parsers

**By Language**:
- **TypeScript/JavaScript**: `@typescript-eslint/typescript-estree`
- **Python**: `ast` (stdlib) or `libcst`
- **Rust**: `syn`
- **Go**: `go/ast` (stdlib)
- **Multi-language**: Tree-sitter

### 10.5 Execution Runtimes

**Current**: Node.js child_process

**Enhancements**:
- **Docker**: Full isolation
- **Firecracker**: MicroVM isolation
- **gVisor**: Kernel-level sandboxing

### 10.6 Sandboxing

**Recommended**:
- **Bubblewrap**: Linux namespace sandboxing
- **nsjail**: Process isolation
- **Firejail**: Application sandboxing

### 10.7 Verification Tooling

**Built-in Support**:
- **TypeScript**: `tsc --noEmit`
- **JavaScript**: ESLint
- **Python**: mypy, pylint, pytest
- **Rust**: cargo check, cargo test
- **Go**: go vet, go test

**Integration**:
- Pre-commit hooks detection
- CI configuration parsing
- Custom verification scripts

---

## 11. IMPLEMENTATION ROADMAP

### PHASE 1: Minimal Viable Runtime ✅ (COMPLETE)

**Goal**: Core orchestration with state machine

**Deliverables**:
- ✅ State Machine (`src/state/machine.ts`)
- ✅ Task Orchestrator (`src/orchestration/taskOrchestrator.ts`)
- ✅ Context Builder (`src/context/builder.ts`)
- ✅ Result Evaluator (`src/runtime/resultEvaluator.ts`)
- ✅ Runtime Engine (`src/runtime/engine.ts`)

**Status**: Complete and compiling

**Next Steps**: Integrate with existing agent loop

---

### PHASE 2: Memory System

**Goal**: Three-tier memory with retrieval

**Deliverables**:
- [ ] Short-term memory manager
- [ ] Working memory graph (project structure)
- [ ] Long-term vector store integration
- [ ] Semantic retrieval interface
- [ ] Compaction daemon

**Timeline**: 2-3 weeks

**Dependencies**: Vector database selection

---

### PHASE 3: Enhanced Verification Engine

**Goal**: Comprehensive verification with auto-repair

**Deliverables**:
- [ ] Language-specific verification chains
- [ ] Failure classification improvements
- [ ] Automated repair suggestions
- [ ] Targeted verification (only affected areas)
- [ ] Performance optimization

**Timeline**: 2 weeks

**Dependencies**: AST parsing integration

---

### PHASE 4: Subagent System

**Goal**: Specialized agents for complex tasks

**Deliverables**:
- [ ] Subagent coordinator
- [ ] Debugger subagent
- [ ] Test writer subagent
- [ ] Code reviewer subagent
- [ ] Merge/conflict resolution

**Timeline**: 3 weeks

**Dependencies**: Memory system (for subagent context)

---

### PHASE 5: Advanced Orchestration

**Goal**: Complex workflow support

**Deliverables**:
- [ ] Parallel task execution
- [ ] Dependency-aware scheduling
- [ ] Conditional workflows
- [ ] Dynamic replanning
- [ ] Multi-agent collaboration

**Timeline**: 3 weeks

**Dependencies**: Subagent system

---

### PHASE 6: Scaling & Optimization

**Goal**: Production-ready performance

**Deliverables**:
- [ ] Token usage optimization
- [ ] Caching strategies
- [ ] Observability dashboard
- [ ] Performance profiling
- [ ] Distributed execution support

**Timeline**: 4 weeks

**Dependencies**: All previous phases

---

## CONCLUSION

This architecture transforms Mela-Coder from a chatbot-with-tools into a **professional autonomous engineering runtime**. The key principles:

1. **LLM is NOT the agent** - It's a stateless reasoner
2. **Runtime controls everything** - Execution, verification, recovery
3. **Modular design** - Each component has clear responsibilities
4. **Verification-first** - Never trust, always verify
5. **Recovery-oriented** - Expect failures, handle gracefully
6. **Context-efficient** - Smart budgeting and compaction
7. **Observable** - Events, logs, metrics throughout

The Phase 1 implementation provides the foundation. Subsequent phases will add memory, advanced verification, subagents, and scaling capabilities.

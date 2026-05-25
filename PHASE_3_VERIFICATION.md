# PHASE 3: Enhanced Verification Engine

## Overview

Phase 3 delivers a production-grade verification system that goes beyond simple pass/fail checks to provide intelligent failure analysis, automatic repair capabilities, and targeted verification strategies.

## Components Implemented

### 1. Failure Classifier (`src/verification/failureClassifier.ts`)

**Purpose**: Advanced pattern-matching engine for error classification with root cause analysis.

**Features**:
- **22 Failure Categories**: From syntax errors to concurrency issues
- **Severity Levels**: critical, high, medium, low, info
- **Location Extraction**: Automatic file/line/column parsing from error output
- **Root Cause Analysis**: Identifies underlying causes, not just symptoms
- **Repair Suggestions**: Actionable recommendations for each failure type
- **Confidence Scoring**: 0-1 confidence based on pattern match quality
- **Error Grouping**: Clusters related errors by file for efficient fixing

**Supported Categories**:
```typescript
type FailureCategory =
  | 'SYNTAX_ERROR'        // Language syntax violations
  | 'TYPE_ERROR'          // Type mismatches (TypeScript)
  | 'LOGIC_ERROR'         // Test failures, assertion errors
  | 'RUNTIME_ERROR'       // Exceptions during execution
  | 'ENVIRONMENT_ERROR'   // Missing files, tools
  | 'PERMISSION_ERROR'    // Access denied
  | 'TIMEOUT_ERROR'       // Operations exceeding time limits
  | 'NETWORK_ERROR'       // Connection failures
  | 'RESOURCE_EXHAUSTED'  // Out of memory, disk full
  | 'FLAKY_TEST'          // Non-deterministic test failures
  | 'ARCHITECTURE_CONFLICT' // Circular dependencies, version conflicts
  | 'AMBIGUOUS_REQUIREMENT' // Unclear specifications
  | 'REGRESSION'          // Previously working code now broken
  | 'DEPENDENCY_ERROR'    // Missing or incompatible packages
  | 'CONFIGURATION_ERROR' // Invalid config files
  | 'IMPORT_ERROR'        // Module resolution failures
  | 'NULL_REFERENCE'      // Null/undefined property access
  | 'BOUNDARY_ERROR'      // Array index out of bounds
  | 'CONCURRENCY_ERROR'   // Race conditions, deadlocks
  | 'MEMORY_LEAK'         // Unreleased resources
  | 'UNKNOWN';            // Unclassified errors
```

**Usage Example**:
```typescript
import { createFailureClassifier } from './verification/index.js';

const classifier = createFailureClassifier();
const failures = classifier.classify(errorOutput, {
  filePath: 'src/app.ts',
  language: 'typescript'
});

// failures[0] contains:
// - category: 'TYPE_ERROR'
// - severity: 'high'
// - location: { file: 'src/app.ts', line: 42, column: 15 }
// - rootCause: 'Type mismatch or undefined value access'
// - repairSuggestions: ['Add type annotations', 'Check for null/undefined']
// - confidence: 0.85
```

---

### 2. Auto-Repair Loop (`src/verification/autoRepair.ts`)

**Purpose**: Automatically attempts to fix detected failures with safe rollback.

**Features**:
- **Strategy-Based Repair**: Different approaches for different error types
- **Backup & Rollback**: Creates backups before modifications, restores on failure
- **Verification Integration**: Validates repairs before committing
- **Configurable Attempts**: Max retries per failure type
- **Selective Enablement**: Toggle repair types (syntax, types, imports, null checks)

**Repair Strategies**:

| Category | Strategy | Actions |
|----------|----------|---------|
| SYNTAX_ERROR | syntax-fix | Add missing semicolons, fix brackets, correct structure |
| TYPE_ERROR | type-annotation | Add type annotations, type assertions |
| IMPORT_ERROR | import-resolution | Fix relative paths, suggest installations |
| NULL_REFERENCE | null-check | Add guard clauses, optional chaining |

**Safety Mechanisms**:
1. Backup creation before any modification
2. Verification after each repair attempt
3. Automatic rollback on verification failure
4. Maximum attempt limits to prevent infinite loops
5. Emergency cleanup on unexpected errors

**Usage Example**:
```typescript
import { createAutoRepairLoop } from './verification/index.js';

const repairLoop = createAutoRepairLoop({
  maxAttemptsPerFailure: 3,
  enableTypeFixes: true,
  enableSyntaxFixes: true,
  backupBeforeRepair: true,
  onRepairAttempt: (attempt) => {
    console.log(`Attempting ${attempt.strategy} on ${attempt.failure.category}`);
  }
});

const results = await repairLoop.attemptRepairs(failures, {
  workspaceRoot: '/path/to/project',
  verificationCommand: 'npm run build'
});

// Check results
for (const result of results) {
  if (result.verified) {
    console.log(`✓ Successfully repaired ${result.failure.category}`);
  } else if (result.rolledBack) {
    console.log(`✗ Repair failed, rolled back`);
  }
}

// Cleanup backups when done
repairLoop.cleanup();
```

---

### 3. Targeted Verifier (`src/verification/targetedVerifier.ts`)

**Purpose**: Intelligent verification that focuses on changed files and their dependents.

**Features**:
- **Change Detection**: Git-based detection of modified files
- **Dependency Tracking**: Identifies files affected by changes
- **Priority-Based Execution**: Critical files verified first
- **Flaky Test Detection**: Skips known flaky tests automatically
- **Associated Test Discovery**: Finds relevant tests for changed files
- **Concurrent Execution**: Parallel verification with configurable limits

**Target Prioritization**:
```typescript
// Priority calculation (lower = higher priority)
- Entry points (main, index): -30
- Source files: -20
- Type definitions: -10
- Index files: -15
- Utils: +10
- Test files: +20
- Dependents: +10 (relative to source)
```

**Verification Flow**:
1. Detect changed files via git diff
2. Find associated test files
3. Discover dependent modules
4. Calculate priorities
5. Execute checks in priority order
6. Track flaky tests for future runs
7. Generate recommendations for failures

**Usage Example**:
```typescript
import { createTargetedVerifier } from './verification/index.js';

const verifier = createTargetedVerifier({
  maxConcurrentChecks: 4,
  timeoutPerCheck: 30000,
  skipFlakyTests: true,
  prioritizeByRisk: true,
  includeDependents: true
});

// Detect targets from git changes
const targets = await verifier.detectTargets({
  sinceCommit: 'HEAD~1',
  workspaceRoot: '/path/to/project'
});

// Run targeted verification
const result = await verifier.verify(targets, {
  packageManager: 'npm'
});

console.log(`Overall: ${result.overallPassed ? 'PASS' : 'FAIL'}`);
console.log(`Skipped ${result.skippedChecks.length} flaky checks`);

for (const rec of result.recommendations) {
  console.log(`Recommendation: ${rec}`);
}

// Mark known flaky test
verifier.markTestAsFlaky('UserService.should handle concurrent requests');
```

---

### 4. Verification Chain (Enhanced) (`src/verification/chain.ts`)

**Purpose**: Core verification orchestration (existing, enhanced with new components).

**Integration Points**:
- Uses FailureClassifier for detailed error analysis
- Triggers AutoRepairLoop on recoverable failures
- Delegates to TargetedVerifier for incremental verification

---

## Architecture Integration

### Data Flow

```
Tool Execution → Verification Chain → Failure Detected
                                           ↓
                                   Failure Classifier
                                           ↓
                                    Categorized Errors
                                           ↓
                                   Auto-Repair Loop?
                                    ↙             ↘
                                  Yes             No
                                   ↓               ↓
                            Apply Repair     Result Evaluator
                                   ↓               ↓
                            Verify Repair    Decide Next Action
                                    ↘             ↙
                                      Merge Results
```

### Component Relationships

```typescript
// Runtime Engine integration
import { 
  VerificationChain,
  FailureClassifier,
  AutoRepairLoop,
  TargetedVerifier
} from './verification/index.js';

class RuntimeEngine {
  private verificationChain: VerificationChain;
  private failureClassifier: FailureClassifier;
  private autoRepair: AutoRepairLoop;
  private targetedVerifier: TargetedVerifier;

  async executeWithVerification(task: Task): Promise<TaskResult> {
    // Execute tool
    const result = await this.executeTool(task);
    
    // Run verification
    const verification = await this.verificationChain.run();
    
    if (!verification.passed) {
      // Classify failures
      const failures = this.failureClassifier.classify(
        VerificationChain.formatFailuresForAgent(verification.results)
      );
      
      // Attempt auto-repair for recoverable errors
      const repairable = failures.filter(f => this.isRepairable(f));
      if (repairable.length > 0) {
        const repairs = await this.autoRepair.attemptRepairs(repairable);
        
        if (repairs.some(r => r.verified)) {
          // Re-verify after repair
          return this.executeWithVerification(task);
        }
      }
      
      // Report unrepairable failures
      return { success: false, failures };
    }
    
    return { success: true };
  }
}
```

---

## Configuration Options

### Failure Classifier
```typescript
// No configuration needed - uses built-in patterns
const classifier = createFailureClassifier();
```

### Auto-Repair Loop
```typescript
const repairLoop = createAutoRepairLoop({
  maxAttemptsPerFailure: 3,        // Default: 3
  enableTypeFixes: true,           // Default: true
  enableSyntaxFixes: true,         // Default: true
  enableImportFixes: true,         // Default: true
  backupBeforeRepair: true,        // Default: true
  onRepairAttempt: (attempt) => {} // Optional callback
});
```

### Targeted Verifier
```typescript
const verifier = createTargetedVerifier({
  maxConcurrentChecks: 4,          // Default: 4
  timeoutPerCheck: 30000,          // Default: 30000ms
  skipFlakyTests: true,            // Default: true
  prioritizeByRisk: true,          // Default: true
  includeDependents: true          // Default: true
});
```

---

## Error Handling Patterns

### Pattern 1: Full Verification Pipeline
```typescript
async function verifyAndRepair(codeChanges: CodeChange[]) {
  const classifier = createFailureClassifier();
  const repairLoop = createAutoRepairLoop();
  
  // Run initial verification
  const verification = await VerificationChain.run();
  
  if (!verification.passed) {
    // Classify errors
    const failures = classifier.classify(
      VerificationChain.formatFailuresForAgent(verification.results)
    );
    
    // Attempt repairs
    const repairs = await repairLoop.attemptRepairs(failures);
    
    // Check if all repairs succeeded
    const allFixed = repairs.every(r => r.verified);
    
    // Cleanup
    repairLoop.cleanup();
    
    return { success: allFixed, failures, repairs };
  }
  
  return { success: true };
}
```

### Pattern 2: Incremental Verification
```typescript
async function verifyChanges(sinceCommit: string) {
  const verifier = createTargetedVerifier();
  
  // Detect what needs verification
  const targets = await verifier.detectTargets({ sinceCommit });
  
  // Run focused verification
  const result = await verifier.verify(targets);
  
  return {
    passed: result.overallPassed,
    checkedFiles: result.targets.map(t => t.file),
    recommendations: result.recommendations
  };
}
```

### Pattern 3: Flaky Test Management
```typescript
async function runTests(testName: string) {
  const verifier = createTargetedVerifier();
  
  const result = await verifier.verify([{
    file: 'src/test.ts',
    reason: 'changed',
    priority: 50,
    tests: [testName]
  }]);
  
  // Check for flaky indicators
  const flakyResults = result.results.filter(
    r => r.error?.includes('flaky') || r.error?.includes('intermittent')
  );
  
  // Mark as flaky for future runs
  for (const flaky of flakyResults) {
    verifier.markTestAsFlaky(flaky.check);
  }
  
  return result;
}
```

---

## Performance Considerations

### Verification Speed
- **Parallel Execution**: Up to 4 concurrent checks (configurable)
- **Timeout Protection**: 30s default per check (configurable)
- **Early Termination**: Stops on first critical failure
- **Cached Results**: Flaky test cache persists within session

### Memory Management
- **Streaming Output**: Large outputs handled via streams
- **Cleanup**: Backup files removed after verification
- **Bounded Buffers**: 10MB max buffer per command

### Scalability
- **Incremental Verification**: Only verify changed files + dependents
- **Priority Queue**: Critical paths verified first
- **Graceful Degradation**: Continues even if some checks fail

---

## Testing Strategy

### Unit Tests
```typescript
import { createFailureClassifier } from './verification/index.js';

describe('FailureClassifier', () => {
  it('should classify TypeScript type errors', () => {
    const classifier = createFailureClassifier();
    const failures = classifier.classify(
      "TS2339: Property 'foo' does not exist on type 'Bar'"
    );
    
    expect(failures[0].category).toBe('TYPE_ERROR');
    expect(failures[0].severity).toBe('high');
  });
  
  it('should extract file locations from errors', () => {
    const classifier = createFailureClassifier();
    const failures = classifier.classify(
      "Error at src/app.ts:42:15 - Unexpected token"
    );
    
    expect(failures[0].location?.file).toBe('src/app.ts');
    expect(failures[0].location?.line).toBe(42);
  });
});
```

### Integration Tests
```typescript
describe('AutoRepairLoop', () => {
  it('should repair syntax errors and verify', async () => {
    const repairLoop = createAutoRepairLoop();
    
    // Create file with syntax error
    const testFile = createTempFile('const x = ');
    
    const failures = classifier.classify('SyntaxError: Unexpected end of input');
    failures[0].location = { file: testFile.path, line: 1 };
    
    const results = await repairLoop.attemptRepairs(failures, {
      verificationCommand: `node ${testFile.path}`
    });
    
    expect(results[0].applied).toBe(true);
    expect(results[0].verified).toBe(true);
    
    cleanup(testFile);
  });
});
```

---

## Migration Guide

### From Basic Verification (Phase 1)

**Before**:
```typescript
import { VerificationChain } from './verification/chain.js';

const result = await VerificationChain.run();
if (!result.passed) {
  console.log(VerificationChain.formatFailuresForAgent(result.results));
}
```

**After**:
```typescript
import { 
  VerificationChain,
  createFailureClassifier,
  createAutoRepairLoop 
} from './verification/index.js';

const result = await VerificationChain.run();
if (!result.passed) {
  const classifier = createFailureClassifier();
  const failures = classifier.classify(
    VerificationChain.formatFailuresForAgent(result.results)
  );
  
  const repairLoop = createAutoRepairLoop();
  const repairs = await repairLoop.attemptRepairs(failures);
  
  if (!repairs.every(r => r.verified)) {
    // Escalate to user
    console.log('Manual intervention required:', failures);
  }
  
  repairLoop.cleanup();
}
```

---

## Troubleshooting

### Issue: Repairs Not Applying

**Symptoms**: `applied: false` in repair results

**Causes**:
1. File location not identified
2. File doesn't exist
3. Repair strategy doesn't match error type

**Solutions**:
- Ensure error output includes file path
- Verify file exists at specified location
- Check failure category matches repairable types

### Issue: Verification Timeouts

**Symptoms**: `TIMEOUT_ERROR` in results

**Causes**:
1. Slow-running tests
2. Infinite loops in code
3. Resource contention

**Solutions**:
- Increase `timeoutPerCheck` in TargetedVerifier config
- Use targeted verification instead of full suite
- Check for resource leaks in tested code

### Issue: False Positive Flaky Detection

**Symptoms**: Stable tests marked as flaky

**Causes**:
1. Intermittent environment issues
2. Shared state between tests
3. External service dependencies

**Solutions**:
- Clear flaky cache: `verifier.clearFlakyCache()`
- Improve test isolation
- Mock external dependencies

---

## Next Steps (Phase 4+)

Phase 3 provides the verification foundation. Future phases will add:

- **Phase 4**: Subagent coordination for parallel repair
- **Phase 5**: Advanced orchestration with dependency-aware scheduling
- **Phase 6**: Performance optimization and scaling

---

## API Reference

### FailureClassifier

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `classify` | `errorOutput: string`, `context?: object` | `FailureDetails[]` | Classify multiple errors |
| `classifySingle` | `error: string`, `output?: string` | `FailureDetails` | Classify single error |
| `getHandlingPriority` | none | `FailureCategory[]` | Get priority order |

### AutoRepairLoop

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `attemptRepairs` | `failures: FailureDetails[]`, `options?: object` | `Promise<RepairAttempt[]>` | Attempt repairs |
| `cleanup` | none | void | Remove backup files |

### TargetedVerifier

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `verify` | `targets: VerificationTarget[]`, `options?: object` | `Promise<TargetedVerificationResult>` | Run verification |
| `detectTargets` | `options?: object` | `Promise<VerificationTarget[]>` | Find targets from git |
| `markTestAsFlaky` | `testName: string` | void | Mark test as flaky |
| `clearFlakyCache` | none | void | Clear flaky cache |

---

*Phase 3 Complete ✓*

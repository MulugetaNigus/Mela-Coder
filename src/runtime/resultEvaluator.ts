/**
 * PHASE 1: Minimal Viable Runtime - Result Evaluator
 * 
 * Determines success, retry, rollback, continue execution, ask for clarification, or escalate.
 * Classifies failures into categories for appropriate handling.
 */

export type EvaluationResult =
  | { decision: 'SUCCESS'; confidence: number; message?: string }
  | { decision: 'RETRY'; reason: string; maxRetries?: number; message?: string }
  | { decision: 'ROLLBACK'; reason: string; targetState?: string; message?: string }
  | { decision: 'CONTINUE'; nextAction: string; message?: string }
  | { decision: 'CLARIFY'; questions: string[]; message?: string }
  | { decision: 'ESCALATE'; reason: string; severity: 'low' | 'medium' | 'high'; message?: string };

export type FailureCategory =
  | 'SYNTAX_ERROR'
  | 'TYPE_ERROR'
  | 'LOGIC_ERROR'
  | 'RUNTIME_ERROR'
  | 'ENVIRONMENT_ERROR'
  | 'PERMISSION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'NETWORK_ERROR'
  | 'RESOURCE_EXHAUSTED'
  | 'FLAKY_TEST'
  | 'ARCHITECTURE_CONFLICT'
  | 'AMBIGUOUS_REQUIREMENT'
  | 'UNKNOWN';

export interface VerificationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    output?: string;
    error?: string;
    category?: FailureCategory;
  }>;
  summary?: string;
}

export interface EvaluationContext {
  taskGoal: string;
  verificationResult: VerificationResult;
  toolOutputs: Array<{ name: string; success: boolean; output: string; error?: string }>;
  stateHistory: Array<{ state: string; timestamp: number }>;
  retryCount: number;
  maxRetries: number;
  artifacts?: string[];
}

export interface EvaluatorConfig {
  autoRetryOnSyntax?: boolean;
  autoRetryOnType?: boolean;
  escalateAfterRetries?: number;
  requireVerificationForSuccess?: boolean;
  onEvaluate?: (result: EvaluationResult) => void;
}

export class ResultEvaluator {
  private readonly config: Required<EvaluatorConfig>;

  constructor(config: EvaluatorConfig = {}) {
    this.config = {
      autoRetryOnSyntax: config.autoRetryOnSyntax ?? true,
      autoRetryOnType: config.autoRetryOnType ?? true,
      escalateAfterRetries: config.escalateAfterRetries ?? 3,
      requireVerificationForSuccess: config.requireVerificationForSuccess ?? true,
      onEvaluate: config.onEvaluate ?? (() => {}),
    };
  }

  /**
   * Evaluate the result of a task execution
   */
  evaluate(context: EvaluationContext): EvaluationResult {
    const { verificationResult, retryCount, taskGoal } = context;

    // Check if all verification passed
    if (verificationResult.passed) {
      const result: EvaluationResult = {
        decision: 'SUCCESS',
        confidence: this.calculateConfidence(verificationResult),
        message: 'All verification checks passed successfully',
      };
      this.config.onEvaluate(result);
      return result;
    }

    // Analyze failures
    const failures = verificationResult.checks.filter(c => !c.passed);
    const categories = this.categorizeFailures(failures);

    // Check for ambiguous requirements
    if (categories.has('AMBIGUOUS_REQUIREMENT')) {
      const result: EvaluationResult = {
        decision: 'CLARIFY',
        questions: [
          'The requirements appear ambiguous. Please clarify:',
          ...this.generateClarificationQuestions(failures),
        ],
      };
      this.config.onEvaluate(result);
      return result;
    }

    // Check for architecture conflicts
    if (categories.has('ARCHITECTURE_CONFLICT')) {
      const result: EvaluationResult = {
        decision: 'ESCALATE',
        reason: 'Architecture conflict detected that requires human intervention',
        severity: 'high',
        message: 'The proposed changes conflict with the existing architecture. Manual review required.',
      };
      this.config.onEvaluate(result);
      return result;
    }

    // Check retry count
    if (retryCount >= this.config.escalateAfterRetries) {
      const result: EvaluationResult = {
        decision: 'ESCALATE',
        reason: `Maximum retries (${retryCount}) exceeded`,
        severity: 'high',
        message: `Task has failed ${retryCount} times. Human intervention required.`,
      };
      this.config.onEvaluate(result);
      return result;
    }

    // Categorize and decide on retry strategy
    const primaryCategory = this.getPrimaryFailureCategory(categories);

    switch (primaryCategory) {
      case 'SYNTAX_ERROR':
        if (this.config.autoRetryOnSyntax) {
          return this.createRetryResult('Syntax errors detected - attempting automatic fix', categories);
        }
        break;

      case 'TYPE_ERROR':
        if (this.config.autoRetryOnType) {
          return this.createRetryResult('Type errors detected - attempting automatic fix', categories);
        }
        break;

      case 'LOGIC_ERROR':
        return this.createRetryResult('Logic errors detected - replanning approach', categories);

      case 'RUNTIME_ERROR':
        return this.createRetryResult('Runtime errors detected - investigating root cause', categories);

      case 'ENVIRONMENT_ERROR':
        return {
          decision: 'ESCALATE',
          reason: 'Environment configuration issue',
          severity: 'medium',
          message: 'The failure appears to be due to environment configuration. Please check your setup.',
        };

      case 'PERMISSION_ERROR':
        return {
          decision: 'ESCALATE',
          reason: 'Permission denied',
          severity: 'medium',
          message: 'Operation failed due to insufficient permissions. Please adjust permissions or run with appropriate privileges.',
        };

      case 'TIMEOUT_ERROR':
        return this.createRetryResult('Operation timed out - retrying with adjusted parameters', categories);

      case 'FLAKY_TEST':
        return this.createRetryResult('Flaky test detected - retrying to confirm', categories);

      case 'RESOURCE_EXHAUSTED':
        return {
          decision: 'ESCALATE',
          reason: 'Resource limits exceeded',
          severity: 'high',
          message: 'Operation failed due to resource constraints (memory, disk, etc.).',
        };

      default:
        return this.createRetryResult('Unknown failure type - attempting recovery', categories);
    }

    // Fallback
    return this.createRetryResult('Verification failed - attempting recovery', categories);
  }

  /**
   * Classify a specific error into a failure category
   */
  classifyError(error: string, output?: string): FailureCategory {
    const text = (error + ' ' + (output ?? '')).toLowerCase();

    // Syntax errors
    if (/\bsyntax\b|\bparse\b|\bunexpected token\b|\bmissing\b.*\b\b/.test(text)) {
      return 'SYNTAX_ERROR';
    }

    // Type errors
    if (/\btype\b|\bts-?\d+|cannot read property|undefined is not a function/.test(text)) {
      return 'TYPE_ERROR';
    }

    // Logic errors (harder to detect automatically)
    if (/\bassertion\b|\bexpected\b.*\bgot\b|\bshould be\b/.test(text)) {
      return 'LOGIC_ERROR';
    }

    // Runtime errors
    if (/\bruntime\b|\bexception\b|\bcrash\b|\bsegfault\b|\bnull pointer\b/.test(text)) {
      return 'RUNTIME_ERROR';
    }

    // Environment errors
    if (/\bnot found\b|\bno such file\b|\bcommand not found\b|\bmodule not found\b/.test(text)) {
      return 'ENVIRONMENT_ERROR';
    }

    // Permission errors
    if (/\bpermission denied\b|\baccess denied\b|\bunauthorized\b|\bforbidden\b/.test(text)) {
      return 'PERMISSION_ERROR';
    }

    // Timeout errors
    if (/\btimeout\b|\btimed out\b|\bdeadline exceeded\b/.test(text)) {
      return 'TIMEOUT_ERROR';
    }

    // Network errors
    if (/\bnetwork\b|\bconnection refused\b|\bECONNREFUSED\b|\bfetch failed\b/.test(text)) {
      return 'NETWORK_ERROR';
    }

    // Resource exhausted
    if (/\bout of memory\b|\bdisk full\b|\bno space left\b|\bresource temporarily unavailable\b/.test(text)) {
      return 'RESOURCE_EXHAUSTED';
    }

    // Flaky test indicators
    if (/\bflaky\b|\brandom\b|\bintermittent\b|\bsometimes fails\b/.test(text)) {
      return 'FLAKY_TEST';
    }

    // Architecture conflicts
    if (/\bcircular dependency\b|\bconflict\b|\bincompatible\b|\bversion mismatch\b/.test(text)) {
      return 'ARCHITECTURE_CONFLICT';
    }

    // Ambiguous requirements
    if (/\bambiguous\b|\bunclear\b|\bvague\b|\bundefined behavior\b/.test(text)) {
      return 'AMBIGUOUS_REQUIREMENT';
    }

    return 'UNKNOWN';
  }

  /**
   * Generate a structured report of the evaluation
   */
  generateReport(context: EvaluationContext, result: EvaluationResult): string {
    const lines = [
      '=== EVALUATION REPORT ===',
      `Task: ${context.taskGoal}`,
      `Decision: ${result.decision}`,
      `Retry Count: ${context.retryCount}/${context.maxRetries}`,
      '',
      'Verification Summary:',
      `  Passed: ${context.verificationResult.checks.filter(c => c.passed).length}/${context.verificationResult.checks.length}`,
    ];

    if (!context.verificationResult.passed) {
      lines.push('', 'Failed Checks:');
      for (const check of context.verificationResult.checks.filter(c => !c.passed)) {
        lines.push(`  - ${check.name}: ${check.error ?? check.output ?? 'failed'}`);
      }
    }

    if (result.message) {
      lines.push('', 'Message:', `  ${result.message}`);
    }

    if (result.decision === 'CLARIFY' && 'questions' in result) {
      lines.push('', 'Questions:');
      result.questions.forEach(q => lines.push(`  - ${q}`));
    }

    if (result.decision === 'ESCALATE') {
      lines.push('', `Severity: ${result.severity.toUpperCase()}`);
    }

    lines.push('', '========================');
    return lines.join('\n');
  }

  private calculateConfidence(result: VerificationResult): number {
    if (result.checks.length === 0) return 0.5;
    const passed = result.checks.filter(c => c.passed).length;
    return passed / result.checks.length;
  }

  private categorizeFailures(failures: VerificationResult['checks']): Set<FailureCategory> {
    const categories = new Set<FailureCategory>();
    
    for (const failure of failures) {
      const category = failure.category ?? this.classifyError(failure.error ?? '', failure.output);
      categories.add(category);
    }

    return categories;
  }

  private getPrimaryFailureCategory(categories: Set<FailureCategory>): FailureCategory {
    // Priority order for handling
    const priority: FailureCategory[] = [
      'SYNTAX_ERROR',
      'TYPE_ERROR',
      'LOGIC_ERROR',
      'RUNTIME_ERROR',
      'FLAKY_TEST',
      'TIMEOUT_ERROR',
      'ENVIRONMENT_ERROR',
      'PERMISSION_ERROR',
      'RESOURCE_EXHAUSTED',
      'NETWORK_ERROR',
      'ARCHITECTURE_CONFLICT',
      'AMBIGUOUS_REQUIREMENT',
      'UNKNOWN',
    ];

    for (const cat of priority) {
      if (categories.has(cat)) {
        return cat;
      }
    }

    return 'UNKNOWN';
  }

  private createRetryResult(reason: string, categories: Set<FailureCategory>): EvaluationResult {
    return {
      decision: 'RETRY',
      reason,
      message: `Retrying due to: ${Array.from(categories).join(', ')}`,
    };
  }

  private generateClarificationQuestions(failures: VerificationResult['checks']): string[] {
    const questions: string[] = [];
    
    for (const failure of failures) {
      if (failure.category === 'AMBIGUOUS_REQUIREMENT') {
        questions.push(`What is the expected behavior for: ${failure.name}?`);
      }
    }

    return questions.length > 0 ? questions : ['Please provide more details about the expected outcome.'];
  }
}

export function createEvaluator(config?: EvaluatorConfig): ResultEvaluator {
  return new ResultEvaluator(config);
}

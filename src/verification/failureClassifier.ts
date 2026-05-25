/**
 * PHASE 3: Enhanced Verification Engine - Failure Classifier
 * 
 * Advanced failure classification with pattern matching, root cause analysis,
 * and actionable repair suggestions.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type FailureSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface FailureDetails {
  category: FailureCategory;
  severity: FailureSeverity;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  message: string;
  rawOutput: string;
  rootCause?: string;
  repairSuggestions?: string[];
  confidence: number; // 0-1
  relatedErrors?: string[];
}

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
  | 'REGRESSION'
  | 'DEPENDENCY_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'IMPORT_ERROR'
  | 'NULL_REFERENCE'
  | 'BOUNDARY_ERROR'
  | 'CONCURRENCY_ERROR'
  | 'MEMORY_LEAK'
  | 'UNKNOWN';

interface ErrorPattern {
  regex: RegExp;
  category: FailureCategory;
  severity: FailureSeverity;
  extractLocation?: (match: RegExpMatchArray) => { file?: string; line?: number; column?: number };
  rootCause?: string;
  suggestions?: string[];
}

export class FailureClassifier {
  private readonly patterns: ErrorPattern[];

  constructor() {
    this.patterns = this.initializePatterns();
  }

  /**
   * Analyze error output and classify failures with detailed information
   */
  classify(errorOutput: string, context?: {
    filePath?: string;
    language?: string;
    recentChanges?: string[];
  }): FailureDetails[] {
    const failures: FailureDetails[] = [];
    const lines = errorOutput.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of this.patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          const location = pattern.extractLocation?.(match) ?? {};
          
          // Try to extract file/line from error output if not in pattern
          if (!location.file || location.line === undefined) {
            const extracted = this.extractLocationFromLine(line, context?.filePath);
            Object.assign(location, extracted);
          }

          const failure: FailureDetails = {
            category: pattern.category,
            severity: pattern.severity,
            location: Object.keys(location).length > 0 ? location : undefined,
            message: this.cleanErrorMessage(line),
            rawOutput: line,
            rootCause: pattern.rootCause,
            repairSuggestions: pattern.suggestions,
            confidence: this.calculateConfidence(match, line),
          };

          failures.push(failure);
          break; // Don't match multiple patterns for same line
        }
      }
    }

    // If no patterns matched, classify as unknown
    if (failures.length === 0 && errorOutput.trim()) {
      failures.push({
        category: 'UNKNOWN',
        severity: 'medium',
        message: this.cleanErrorMessage(errorOutput),
        rawOutput: errorOutput,
        confidence: 0.3,
        repairSuggestions: [
          'Review the error message carefully',
          'Check recent code changes',
          'Verify environment configuration',
        ],
      });
    }

    // Detect related errors and group them
    this.groupRelatedErrors(failures);

    return failures;
  }

  /**
   * Classify a single error string
   */
  classifySingle(error: string, output?: string): FailureDetails {
    const combined = `${error}\n${output ?? ''}`;
    const failures = this.classify(combined);
    return failures[0] ?? {
      category: 'UNKNOWN',
      severity: 'medium',
      message: error,
      rawOutput: combined,
      confidence: 0.2,
    };
  }

  /**
   * Get priority order for handling failures
   */
  static getHandlingPriority(): FailureCategory[] {
    return [
      'SYNTAX_ERROR',
      'IMPORT_ERROR',
      'TYPE_ERROR',
      'NULL_REFERENCE',
      'BOUNDARY_ERROR',
      'LOGIC_ERROR',
      'RUNTIME_ERROR',
      'REGRESSION',
      'FLAKY_TEST',
      'TIMEOUT_ERROR',
      'RESOURCE_EXHAUSTED',
      'MEMORY_LEAK',
      'CONCURRENCY_ERROR',
      'DEPENDENCY_ERROR',
      'CONFIGURATION_ERROR',
      'ENVIRONMENT_ERROR',
      'PERMISSION_ERROR',
      'NETWORK_ERROR',
      'ARCHITECTURE_CONFLICT',
      'AMBIGUOUS_REQUIREMENT',
      'UNKNOWN',
    ];
  }

  private initializePatterns(): ErrorPattern[] {
    return [
      // Syntax Errors
      {
        regex: /\bSyntaxError\b|unexpected token|expected\s+['"]?\w+['"]?\s+but\s+found/i,
        category: 'SYNTAX_ERROR',
        severity: 'critical',
        extractLocation: this.extractTSLocation,
        rootCause: 'Code violates language syntax rules',
        suggestions: [
          'Check for missing brackets, parentheses, or semicolons',
          'Verify proper keyword usage',
          'Ensure correct statement structure',
        ],
      },
      {
        regex: /\bparse\s+error\b|failed\s+to\s+parse/i,
        category: 'SYNTAX_ERROR',
        severity: 'critical',
        rootCause: 'Parser cannot understand the code structure',
        suggestions: ['Review code syntax and formatting'],
      },

      // Type Errors (TypeScript)
      {
        regex: /TS\d{4,}|Type\s+'[^']+'\s+is\s+not\s+assignable|Cannot\s+read\s+propert(?:y|ies)\s+of|undefined\s+is\s+not\s+a\s+function/i,
        category: 'TYPE_ERROR',
        severity: 'high',
        extractLocation: this.extractTSLocation,
        rootCause: 'Type mismatch or undefined value access',
        suggestions: [
          'Add type annotations or assertions',
          'Check for null/undefined before accessing properties',
          'Verify function signatures match',
        ],
      },
      {
        regex: /Property\s+'[^']+'\s+does\s+not\s+exist\s+on\s+type/i,
        category: 'TYPE_ERROR',
        severity: 'high',
        extractLocation: this.extractTSLocation,
        rootCause: 'Accessing non-existent property',
        suggestions: [
          'Check the type definition',
          'Add the missing property to the type',
          'Use type assertion if property exists at runtime',
        ],
      },

      // Import Errors
      {
        regex: /Cannot\s+find\s+module|Module\s+not\s+found|Import\s+declaration\s+is\s+not\s+found|no\s+module\s+named/i,
        category: 'IMPORT_ERROR',
        severity: 'high',
        rootCause: 'Module resolution failed',
        suggestions: [
          'Install missing dependencies',
          'Check import path spelling',
          'Verify module exports',
        ],
      },

      // Null Reference
      {
        regex: /TypeError:\s+Cannot\s+read\s+propert(?:y|ies)|null\s+is\s+not\s+an\s+object|NoneType.*has\s+no\s+attribute/i,
        category: 'NULL_REFERENCE',
        severity: 'high',
        extractLocation: (match: RegExpMatchArray) => this.extractStackLocation(match.input ?? ''),
        rootCause: 'Attempting to access property of null/undefined value',
        suggestions: [
          'Add null checks before accessing properties',
          'Use optional chaining (?.)',
          'Initialize variables properly',
        ],
      },

      // Logic Errors (Test Failures)
      {
        regex: /AssertionError|expect.*received|expected.*to\s+be|should\s+have|assertion\s+failed/i,
        category: 'LOGIC_ERROR',
        severity: 'high',
        rootCause: 'Code behavior does not match expected outcome',
        suggestions: [
          'Review test expectations',
          'Check business logic implementation',
          'Verify edge case handling',
        ],
      },

      // Runtime Errors
      {
        regex: /Error:\s+\w+Error|Exception|RuntimeError|panic\s+at|fatal\s+error/i,
        category: 'RUNTIME_ERROR',
        severity: 'high',
        extractLocation: (match: RegExpMatchArray) => this.extractStackLocation(match.input ?? ''),
        rootCause: 'Error occurred during program execution',
        suggestions: [
          'Check stack trace for error origin',
          'Validate input data',
          'Add error handling',
        ],
      },

      // Environment Errors
      {
        regex: /command\s+not\s+found|not\s+found|No\s+such\s+file\s+or\s+directory|ENOENT/i,
        category: 'ENVIRONMENT_ERROR',
        severity: 'medium',
        rootCause: 'Required resource not available in environment',
        suggestions: [
          'Verify file/directory paths',
          'Install required tools',
          'Check environment variables',
        ],
      },

      // Permission Errors
      {
        regex: /permission\s+denied|access\s+denied|EACCES|unauthorized|forbidden/i,
        category: 'PERMISSION_ERROR',
        severity: 'high',
        rootCause: 'Insufficient permissions for operation',
        suggestions: [
          'Check file/directory permissions',
          'Run with appropriate privileges',
          'Verify user access rights',
        ],
      },

      // Timeout Errors
      {
        regex: /timeout|timed\s+out|deadline\s+exceeded|ETIMEDOUT/i,
        category: 'TIMEOUT_ERROR',
        severity: 'medium',
        rootCause: 'Operation exceeded time limit',
        suggestions: [
          'Increase timeout threshold',
          'Optimize slow operations',
          'Check for infinite loops',
        ],
      },

      // Network Errors
      {
        regex: /network|connection\s+refused|ECONNREFUSED|fetch\s+failed|ENOTFOUND|socket\s+hang\s+up/i,
        category: 'NETWORK_ERROR',
        severity: 'medium',
        rootCause: 'Network communication failure',
        suggestions: [
          'Check network connectivity',
          'Verify service availability',
          'Add retry logic',
        ],
      },

      // Resource Exhausted
      {
        regex: /out\s+of\s+memory|ENOMEM|disk\s+full|no\s+space\s+left|too\s+many\s+open\s+files|EMFILE/i,
        category: 'RESOURCE_EXHAUSTED',
        severity: 'critical',
        rootCause: 'System resources depleted',
        suggestions: [
          'Free up system resources',
          'Close unused file handles',
          'Reduce memory usage',
        ],
      },

      // Flaky Test
      {
        regex: /flaky|intermittent|sometimes\s+fails|random\s+failure|non-deterministic/i,
        category: 'FLAKY_TEST',
        severity: 'low',
        rootCause: 'Test has non-deterministic behavior',
        suggestions: [
          'Identify source of non-determinism',
          'Add proper synchronization',
          'Mock external dependencies',
        ],
      },

      // Architecture Conflicts
      {
        regex: /circular\s+dependenc(?:y|ies)|version\s+mismatch|incompatible\s+versions?|conflicting\s+requirements/i,
        category: 'ARCHITECTURE_CONFLICT',
        severity: 'high',
        rootCause: 'Structural or dependency conflicts',
        suggestions: [
          'Refactor to remove circular dependencies',
          'Align dependency versions',
          'Review architecture decisions',
        ],
      },

      // Regression Detection
      {
        regex: /regression|previously\s+passed|used\s+to\s+work|broke\s+in\s+commit/i,
        category: 'REGRESSION',
        severity: 'high',
        rootCause: 'Previously working functionality is now broken',
        suggestions: [
          'Identify commit that introduced regression',
          'Review recent changes',
          'Add regression test',
        ],
      },

      // Dependency Errors
      {
        regex: /missing\s+dependenc(?:y|ies)|peer\s+dependenc(?:y|ies)|incompatible\s+dependenc/i,
        category: 'DEPENDENCY_ERROR',
        severity: 'high',
        rootCause: 'Dependency installation or compatibility issue',
        suggestions: [
          'Run package install',
          'Check peer dependency requirements',
          'Update dependency versions',
        ],
      },

      // Configuration Errors
      {
        regex: /invalid\s+config(?:uration)?|malformed\s+JSON|YAML\s+parse\s+error|config\s+file\s+not\s+found/i,
        category: 'CONFIGURATION_ERROR',
        severity: 'medium',
        rootCause: 'Configuration file is invalid or missing',
        suggestions: [
          'Validate configuration syntax',
          'Check required fields',
          'Review configuration documentation',
        ],
      },

      // Boundary Errors
      {
        regex: /index\s+out\s+of\s+(?:bounds|range)|array\s+index|off-by-one|string\s+index/i,
        category: 'BOUNDARY_ERROR',
        severity: 'high',
        rootCause: 'Array or string index out of valid range',
        suggestions: [
          'Add bounds checking',
          'Validate array length before access',
          'Review loop conditions',
        ],
      },

      // Concurrency Errors
      {
        regex: /race\s+condition|deadlock|concurrent\s+modification|thread\s+safety/i,
        category: 'CONCURRENCY_ERROR',
        severity: 'critical',
        rootCause: 'Unsynchronized concurrent access',
        suggestions: [
          'Add proper locking mechanisms',
          'Use atomic operations',
          'Review thread safety',
        ],
      },

      // Memory Leak Indicators
      {
        regex: /memory\s+leak|heap\s+out\s+of\s+memory|growing\s+unbounded|not\s+being\s+freed/i,
        category: 'MEMORY_LEAK',
        severity: 'high',
        rootCause: 'Memory not being properly released',
        suggestions: [
          'Check for unclosed resources',
          'Remove event listeners',
          'Clear caches periodically',
        ],
      },
    ];
  }

  private extractTSLocation(match: RegExpMatchArray): { file?: string; line?: number; column?: number } {
    // Match patterns like: file.ts:123:45 or file.ts(123,45)
    const tsPattern = /([\w./-]+\.(?:ts|tsx|js|jsx))[:\(](\d+)[:,](\d+)/i;
    const fullMatch = match.input?.match(tsPattern);
    
    if (fullMatch) {
      return {
        file: fullMatch[1],
        line: parseInt(fullMatch[2], 10),
        column: parseInt(fullMatch[3], 10),
      };
    }
    
    return {};
  }

  private extractStackLocation(line: string): { file?: string; line?: number; column?: number } {
    // Match stack trace patterns
    const stackPattern = /at\s+(?:.+?\s+)?\(([\w./-]+):(\d+):(\d+)\)/;
    const match = line.match(stackPattern);
    
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }
    
    return {};
  }

  private extractLocationFromLine(line: string, defaultFile?: string): { file?: string; line?: number; column?: number } {
    // Common patterns: file.ext:line:col or file.ext(line,col)
    const patterns = [
      /([\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java))[:\(](\d+)[:,](\d+)/i,
      /([\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java))[:\(](\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const result: { file?: string; line?: number; column?: number } = {
          file: match[1],
        };
        if (match[2]) result.line = parseInt(match[2], 10);
        if (match[3]) result.column = parseInt(match[3], 10);
        return result;
      }
    }

    return defaultFile ? { file: defaultFile } : {};
  }

  private cleanErrorMessage(message: string): string {
    return message
      .replace(/\s+/g, ' ')
      .replace(/^\s*at\s+.*/i, '')
      .trim();
  }

  private calculateConfidence(match: RegExpMatchArray, line: string): number {
    let confidence = 0.7;
    
    // Higher confidence if multiple indicators
    if (match.length > 1) confidence += 0.1;
    
    // Higher confidence if error code present (like TS1234)
    if (/\b[A-Z]{2,}\d{3,}\b/.test(line)) confidence += 0.15;
    
    // Higher confidence if location info present
    if (/(?:\(|:)\d+(?::\d+)?/.test(line)) confidence += 0.05;
    
    return Math.min(confidence, 1.0);
  }

  private groupRelatedErrors(failures: FailureDetails[]): void {
    // Group errors by file
    const byFile = new Map<string, FailureDetails[]>();
    
    for (const failure of failures) {
      const file = failure.location?.file ?? 'unknown';
      const existing = byFile.get(file) ?? [];
      existing.push(failure);
      byFile.set(file, existing);
    }

    // Mark related errors
    for (const [file, group] of byFile.entries()) {
      if (group.length > 1) {
        for (const failure of group) {
          failure.relatedErrors = group
            .filter(f => f !== failure)
            .map(f => f.message);
        }
      }
    }
  }
}

export function createFailureClassifier(): FailureClassifier {
  return new FailureClassifier();
}

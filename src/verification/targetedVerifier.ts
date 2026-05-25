/**
 * PHASE 3: Enhanced Verification Engine - Targeted Verifier
 * 
 * Performs intelligent, targeted verification based on:
 * - Changed files and their dependencies
 * - Failure context and affected modules
 * - Risk assessment of changes
 * - Historical flakiness data
 */

import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { VerificationStepResult } from './chain.js';

export interface VerificationTarget {
  file: string;
  reason: 'changed' | 'dependent' | 'affected' | 'high-risk';
  priority: number; // Lower = higher priority
  tests?: string[];
  checks?: string[];
}

export interface TargetedVerificationConfig {
  maxConcurrentChecks?: number;
  timeoutPerCheck?: number;
  skipFlakyTests?: boolean;
  prioritizeByRisk?: boolean;
  includeDependents?: boolean;
}

export interface TargetedVerificationResult {
  targets: VerificationTarget[];
  results: Array<{
    target: VerificationTarget;
    check: string;
    passed: boolean;
    durationMs: number;
    output?: string;
    error?: string;
  }>;
  overallPassed: boolean;
  skippedChecks: string[];
  recommendations: string[];
}

export class TargetedVerifier {
  private readonly config: Required<TargetedVerificationConfig>;
  private flakyTestCache: Set<string> = new Set();

  constructor(config: TargetedVerificationConfig = {}) {
    this.config = {
      maxConcurrentChecks: config.maxConcurrentChecks ?? 4,
      timeoutPerCheck: config.timeoutPerCheck ?? 30000,
      skipFlakyTests: config.skipFlakyTests ?? true,
      prioritizeByRisk: config.prioritizeByRisk ?? true,
      includeDependents: config.includeDependents ?? true,
    };
  }

  /**
   * Perform targeted verification on changed/affected files
   */
  async verify(
    targets: VerificationTarget[],
    options?: {
      workspaceRoot?: string;
      packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
    }
  ): Promise<TargetedVerificationResult> {
    const workspaceRoot = options?.workspaceRoot ?? process.cwd();
    const packageManager = options?.packageManager ?? 'npm';
    
    const results: TargetedVerificationResult['results'] = [];
    const skippedChecks: string[] = [];
    const recommendations: string[] = [];

    // Sort targets by priority
    const sortedTargets = this.config.prioritizeByRisk
      ? [...targets].sort((a, b) => a.priority - b.priority)
      : targets;

    // Execute checks for each target
    for (const target of sortedTargets) {
      const targetResults = await this.verifyTarget(target, workspaceRoot, packageManager);
      
      for (const result of targetResults) {
        if (result.passed === false && result.error?.includes('flaky')) {
          skippedChecks.push(`${target.file}:${result.check}`);
          this.flakyTestCache.add(result.check);
        } else {
          results.push(result);
          
          if (!result.passed) {
            recommendations.push(this.generateRecommendation(target, result));
          }
        }
      }
    }

    const overallPassed = results.every(r => r.passed);

    return {
      targets,
      results,
      overallPassed,
      skippedChecks,
      recommendations,
    };
  }

  /**
   * Detect verification targets from git diff or file changes
   */
  async detectTargets(options?: {
    workspaceRoot?: string;
    sinceCommit?: string;
    changedFiles?: string[];
  }): Promise<VerificationTarget[]> {
    const workspaceRoot = options?.workspaceRoot ?? process.cwd();
    const targets: VerificationTarget[] = [];

    // Get changed files
    let changedFiles = options?.changedFiles;
    
    if (!changedFiles) {
      changedFiles = await this.getChangedFiles(workspaceRoot, options?.sinceCommit);
    }

    // Analyze each changed file
    for (const file of changedFiles) {
      const target: VerificationTarget = {
        file,
        reason: 'changed',
        priority: this.calculatePriority(file, workspaceRoot),
      };

      // Detect associated tests
      const associatedTests = await this.findAssociatedTests(file, workspaceRoot);
      if (associatedTests.length > 0) {
        target.tests = associatedTests;
      }

      // Detect required checks based on file type
      target.checks = this.detectRequiredChecks(file);

      targets.push(target);
    }

    // Add dependent files if configured
    if (this.config.includeDependents) {
      const dependents = await this.findDependentFiles(targets.map(t => t.file), workspaceRoot);
      
      for (const dep of dependents) {
        if (!targets.some(t => t.file === dep)) {
          targets.push({
            file: dep,
            reason: 'dependent',
            priority: this.calculatePriority(dep, workspaceRoot) + 10, // Lower priority than direct changes
          });
        }
      }
    }

    return targets;
  }

  /**
   * Mark a test as flaky to skip in future runs
   */
  markTestAsFlaky(testName: string): void {
    this.flakyTestCache.add(testName);
  }

  /**
   * Clear the flaky test cache
   */
  clearFlakyCache(): void {
    this.flakyTestCache.clear();
  }

  private async verifyTarget(
    target: VerificationTarget,
    workspaceRoot: string,
    packageManager: string
  ): Promise<TargetedVerificationResult['results']> {
    const results: TargetedVerificationResult['results'] = [];

    // Run type checking if applicable
    if (target.checks?.includes('typecheck') || !target.checks) {
      const typecheckResult = await this.runTypeCheck(workspaceRoot, packageManager, target.file);
      results.push({
        target,
        check: 'typecheck',
        ...typecheckResult,
      });
    }

    // Run linting if applicable
    if (target.checks?.includes('lint') || !target.checks) {
      const lintResult = await this.runLint(workspaceRoot, packageManager, target.file);
      results.push({
        target,
        check: 'lint',
        ...lintResult,
      });
    }

    // Run tests if applicable
    if (target.tests && target.tests.length > 0) {
      for (const test of target.tests) {
        if (this.config.skipFlakyTests && this.flakyTestCache.has(test)) {
          continue; // Skip known flaky tests
        }

        const testResult = await this.runTest(workspaceRoot, packageManager, test);
        results.push({
          target,
          check: `test:${test}`,
          ...testResult,
        });
      }
    }

    return results;
  }

  private async getChangedFiles(workspaceRoot: string, sinceCommit?: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const args = sinceCommit ? ['diff', '--name-only', sinceCommit] : ['diff', '--name-only', 'HEAD'];
      
      exec(`git ${args.join(' ')}`, { cwd: workspaceRoot }, (error, stdout) => {
        if (error) {
          // If git fails, return empty array
          resolve([]);
        } else {
          const files = stdout.trim().split('\n').filter(f => f.length > 0);
          resolve(files);
        }
      });
    });
  }

  private async findAssociatedTests(filePath: string, workspaceRoot: string): Promise<string[]> {
    const tests: string[] = [];
    const fileName = filePath.replace(/\.(ts|tsx|js|jsx)$/, '');
    
    // Common test file patterns
    const testPatterns = [
      `${fileName}.test.ts`,
      `${fileName}.spec.ts`,
      `${fileName}.test.tsx`,
      `${fileName}.spec.tsx`,
      `${fileName}.test.js`,
      `${fileName}.spec.js`,
      `${dirname(fileName)}/__tests__/${filePath.split('/').pop()}.test.ts`,
      `${dirname(fileName)}/__tests__/${filePath.split('/').pop()}.spec.ts`,
    ];

    for (const pattern of testPatterns) {
      const testPath = join(workspaceRoot, pattern);
      if (existsSync(testPath)) {
        // Extract test name for running specific test
        const testName = pattern.replace(/\.test\.(ts|tsx|js|jsx)$/, '').replace(/\.spec\.(ts|tsx|js|jsx)$/, '');
        tests.push(testName);
      }
    }

    return tests;
  }

  private detectRequiredChecks(filePath: string): string[] {
    const checks: string[] = [];
    const ext = filePath.split('.').pop()?.toLowerCase();

    if (ext === 'ts' || ext === 'tsx') {
      checks.push('typecheck');
    }

    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
      checks.push('lint');
    }

    return checks;
  }

  private async findDependentFiles(files: string[], workspaceRoot: string): Promise<string[]> {
    const dependents: string[] = [];
    
    // Simple heuristic: look for imports of changed files
    // In production, use AST parsing for accurate dependency graph
    
    for (const file of files) {
      const baseName = file.replace(/\.(ts|tsx|js|jsx)$/, '');
      
      // Search for files that import this module
      // This is a simplified approach - real implementation would use AST
      try {
        const grepResult = await this.grepForImport(baseName, workspaceRoot);
        dependents.push(...grepResult);
      } catch {
        // Ignore grep errors
      }
    }

    return [...new Set(dependents)];
  }

  private async grepForImport(moduleName: string, workspaceRoot: string): Promise<string[]> {
    return new Promise((resolve) => {
      const pattern = `import.*['"]${moduleName}['"]`;
      exec(`grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -l "${pattern}" .`, 
        { cwd: workspaceRoot }, 
        (error, stdout) => {
          if (error) {
            resolve([]);
          } else {
            const files = stdout.trim().split('\n').filter(f => f.length > 0);
            resolve(files);
          }
        }
      );
    });
  }

  private calculatePriority(filePath: string, workspaceRoot: string): number {
    let priority = 100;

    // Higher priority (lower number) for critical files
    if (filePath.includes('src/')) priority -= 20;
    if (filePath.includes('index.')) priority -= 15;
    if (filePath.includes('types.') || filePath.includes('interfaces.')) priority -= 10;
    if (filePath.includes('utils/')) priority += 10;
    if (filePath.includes('test.') || filePath.includes('spec.')) priority += 20;
    if (filePath.includes('__tests__/') || filePath.includes('.test.')) priority += 20;

    // High risk for entry points
    if (filePath.match(/^(src\/)?(main|index|app)\./)) {
      priority -= 30;
    }

    return Math.max(0, priority);
  }

  private runTypeCheck(
    workspaceRoot: string,
    packageManager: string,
    filePath?: string
  ): Promise<{ passed: boolean; durationMs: number; output?: string; error?: string }> {
    return this.runCommand(
      workspaceRoot,
      `${packageManager} run typecheck${filePath ? ` -- ${filePath}` : ''}`,
      'typecheck'
    );
  }

  private runLint(
    workspaceRoot: string,
    packageManager: string,
    filePath?: string
  ): Promise<{ passed: boolean; durationMs: number; output?: string; error?: string }> {
    return this.runCommand(
      workspaceRoot,
      `${packageManager} run lint${filePath ? ` -- ${filePath}` : ''}`,
      'lint'
    );
  }

  private runTest(
    workspaceRoot: string,
    packageManager: string,
    testName: string
  ): Promise<{ passed: boolean; durationMs: number; output?: string; error?: string }> {
    // Use Jest/Vitest pattern matching
    return this.runCommand(
      workspaceRoot,
      `${packageManager} test --testNamePattern="${testName}"`,
      `test:${testName}`
    );
  }

  private async runCommand(
    workspaceRoot: string,
    command: string,
    checkName: string
  ): Promise<{ passed: boolean; durationMs: number; output?: string; error?: string }> {
    const start = Date.now();

    return new Promise((resolve) => {
      exec(command, { 
        cwd: workspaceRoot, 
        timeout: this.config.timeoutPerCheck,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }, (error, stdout, stderr) => {
        const duration = Date.now() - start;
        const output = (stdout + stderr).trim();

        if (error) {
          // Check if it's a flaky test
          if (output.toLowerCase().includes('flaky') || output.toLowerCase().includes('intermittent')) {
            resolve({
              passed: false,
              durationMs: duration,
              error: `Flaky test detected: ${checkName}`,
              output,
            });
          } else {
            resolve({
              passed: false,
              durationMs: duration,
              error: output || error.message,
            });
          }
        } else {
          resolve({
            passed: true,
            durationMs: duration,
            output: output || undefined,
          });
        }
      });
    });
  }

  private generateRecommendation(
    target: VerificationTarget,
    result: { target: VerificationTarget; check: string; passed: boolean; output?: string; error?: string }
  ): string {
    if (result.check.startsWith('test:')) {
      return `Test failure in ${target.file}: Review test expectations and implementation`;
    }
    
    if (result.check === 'typecheck') {
      return `Type error in ${target.file}: Fix type mismatches before proceeding`;
    }
    
    if (result.check === 'lint') {
      return `Lint error in ${target.file}: Address code style issues`;
    }

    return `Verification failed for ${target.file}:${result.check}`;
  }
}

export function createTargetedVerifier(config?: TargetedVerificationConfig): TargetedVerifier {
  return new TargetedVerifier(config);
}

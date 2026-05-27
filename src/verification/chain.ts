import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export interface VerificationStepResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
  category?: 'syntax' | 'type' | 'lint' | 'test' | 'runtime' | 'build' | 'diff';
}

export enum ResultClass {
  SUCCESS = 'success',
  RETRY = 'retry',
  ROLLBACK = 'rollback',
  BLOCKED = 'blocked',
  FAIL = 'fail'
}

export interface EvaluationResult {
  class: ResultClass;
  reason: string;
  shouldContinue: boolean;
  shouldRetry: boolean;
}

export class VerificationChain {
  static async run(skipVerify = false): Promise<{ passed: boolean; results: VerificationStepResult[]; badge?: string; evaluation?: EvaluationResult }> {
    if (skipVerify) {
      return { passed: true, results: [] };
    }

    const steps = this.detectSteps();
    const results: VerificationStepResult[] = [];
    let overallPassed = true;

    for (const step of steps) {
      const start = Date.now();
      try {
        const output = await this.runCommand(step.command, 90000);
        const duration = Date.now() - start;
        results.push({
          name: step.name,
          passed: true,
          durationMs: duration,
          output,
          category: step.category
        });
      } catch (err: any) {
        const duration = Date.now() - start;
        results.push({
          name: step.name,
          passed: false,
          durationMs: duration,
          output: err?.message ?? String(err),
          category: step.category
        });
        overallPassed = false;
        break;
      }
    }

    if (!overallPassed) {
      const evaluation = ResultEvaluator.evaluate(results);
      return { passed: false, results, evaluation };
    }

    const badgeParts = results.map(r => `✓ ${r.name} ${(r.durationMs / 1000).toFixed(1)}s`);
    const badge = badgeParts.join(' · ');

    return { passed: true, results, badge };
  }

  private static detectSteps(): Array<{ name: string; command: string; category: VerificationStepResult['category'] }> {
    const steps: Array<{ name: string; command: string; category: VerificationStepResult['category'] }> = [];
    if (existsSync('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        const scripts = pkg.scripts || {};

        if (scripts.typecheck) {
          steps.push({ name: 'typecheck', command: 'npm run typecheck', category: 'type' });
        } else if (existsSync('tsconfig.json')) {
          steps.push({ name: 'typecheck', command: 'npx tsc --noEmit', category: 'type' });
        }

        if (scripts.lint) {
          steps.push({ name: 'lint', command: 'npm run lint', category: 'lint' });
        }

        if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
          steps.push({ name: 'test', command: 'npm test', category: 'test' });
        }
      } catch {}
    } else if (existsSync('Cargo.toml')) {
      steps.push({ name: 'typecheck', command: 'cargo check', category: 'type' });
      steps.push({ name: 'test', command: 'cargo test', category: 'test' });
    } else if (existsSync('go.mod')) {
      steps.push({ name: 'typecheck', command: 'go build', category: 'build' });
      steps.push({ name: 'test', command: 'go test ./...', category: 'test' });
    }

    steps.push({ name: 'diff-check', command: 'git diff --check', category: 'diff' });

    return steps;
  }

  private static runCommand(command: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
        const output = (stdout + stderr).trim();
        if (error) {
          reject(new Error(output || error.message));
        } else {
          resolve(output);
        }
      });
    });
  }

  static formatFailuresForAgent(results: VerificationStepResult[]): string {
    const failed = results.find(r => !r.passed);
    if (!failed) return '';
    return `[VERIFICATION FAILURE]
The verification step "${failed.name}" failed:
--- OUTPUT ---
${failed.output}
--------------
Please resolve the error above before continuing.`;
  }
}

export class ResultEvaluator {
  static evaluate(results: VerificationStepResult[]): EvaluationResult {
    const failed = results.find(r => !r.passed);
    if (!failed) {
      return {
        class: ResultClass.SUCCESS,
        reason: 'All verifications passed',
        shouldContinue: true,
        shouldRetry: false
      };
    }

    const output = failed.output.toLowerCase();

    if (this.isSyntaxError(output) || this.isTypeError(output)) {
      return {
        class: ResultClass.RETRY,
        reason: `${failed.name} has syntax/type error - fixable`,
        shouldContinue: true,
        shouldRetry: true
      };
    }

    if (this.isMissingDependency(output)) {
      return {
        class: ResultClass.RETRY,
        reason: `${failed.name} missing dependency - auto-install possible`,
        shouldContinue: true,
        shouldRetry: true
      };
    }

    if (this.isPermissionError(output)) {
      return {
        class: ResultClass.FAIL,
        reason: `${failed.name} permission denied - requires user intervention`,
        shouldContinue: false,
        shouldRetry: false
      };
    }

    return {
      class: ResultClass.FAIL,
      reason: `${failed.name} failed with unknown error`,
      shouldContinue: false,
      shouldRetry: false
    };
  }

  private static isSyntaxError(text: string): boolean {
    return /syntaxerror|unexpected token|parse error/i.test(text);
  }

  private static isTypeError(text: string): boolean {
    return /typeerror|ts\d{4}|type '.*' is not assignable/i.test(text);
  }

  private static isMissingDependency(text: string): boolean {
    return /module not found|cannot find module|no such file/i.test(text);
  }

  private static isPermissionError(text: string): boolean {
    return /permission denied|eaccess|access denied/i.test(text);
  }
}

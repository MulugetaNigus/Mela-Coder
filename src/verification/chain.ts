import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export interface VerificationStepResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output: string;
}

export class VerificationChain {
  static async run(skipVerify = false): Promise<{ passed: boolean; results: VerificationStepResult[]; badge?: string }> {
    if (skipVerify) {
      return { passed: true, results: [] };
    }

    const steps = this.detectSteps();
    const results: VerificationStepResult[] = [];
    let overallPassed = true;

    for (const step of steps) {
      const start = Date.now();
      try {
        const output = await this.runCommand(step.command, 90000); // 90 seconds timeout
        const duration = Date.now() - start;
        results.push({
          name: step.name,
          passed: true,
          durationMs: duration,
          output,
        });
      } catch (err: any) {
        const duration = Date.now() - start;
        results.push({
          name: step.name,
          passed: false,
          durationMs: duration,
          output: err?.message ?? String(err),
        });
        overallPassed = false;
        break; // Stop at first failure
      }
    }

    if (!overallPassed) {
      return { passed: false, results };
    }

    const badgeParts = results.map(r => `✓ ${r.name} ${(r.durationMs / 1000).toFixed(1)}s`);
    const badge = badgeParts.join(' · ');

    return { passed: true, results, badge };
  }

  private static detectSteps(): Array<{ name: string; command: string }> {
    const steps: Array<{ name: string; command: string }> = [];

    if (existsSync('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        const scripts = pkg.scripts || {};

        // Typecheck
        if (scripts.typecheck) {
          steps.push({ name: 'typecheck', command: 'npm run typecheck' });
        } else if (existsSync('tsconfig.json')) {
          steps.push({ name: 'typecheck', command: 'npx tsc --noEmit' });
        }

        // Lint
        if (scripts.lint) {
          steps.push({ name: 'lint', command: 'npm run lint' });
        }

        // Test
        if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
          steps.push({ name: 'test', command: 'npm test' });
        }
      } catch {}
    } else if (existsSync('Cargo.toml')) {
      steps.push({ name: 'typecheck', command: 'cargo check' });
      steps.push({ name: 'test', command: 'cargo test' });
    } else if (existsSync('go.mod')) {
      steps.push({ name: 'typecheck', command: 'go build' });
      steps.push({ name: 'test', command: 'go test ./...' });
    }

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

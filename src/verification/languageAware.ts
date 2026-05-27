import { exec, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { extname } from 'node:path';
import { ResultClass, ResultEvaluator, VerificationStepResult } from './chain';

export type Language = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'unknown';

export interface LanguageConfig {
  language: Language;
  typecheckCommand?: string;
  typecheckTargetFiles?: string[];
  lintCommand?: string;
  testCommand?: string;
}

export interface IncrementalFiles {
  files: string[];
  reason: 'git-staged' | 'git-recent' | 'all';
}

export class LanguageAwareVerifier {
  private static readonly LANGUAGE_EXTENSIONS: Record<string, Language> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java'
  };

  static detectLanguage(): LanguageConfig {
    // Check for explicit markers first
    if (existsSync('Cargo.toml')) {
      return { language: 'rust', typecheckCommand: 'cargo check', testCommand: 'cargo test' };
    }
    if (existsSync('go.mod')) {
      return { language: 'go', typecheckCommand: 'go build', testCommand: 'go test ./...' };
    }

    // Check file extensions
    const srcDir = 'src';
    if (existsSync(srcDir)) {
      try {
        const files = readdirSync(srcDir, { recursive: true }) as string[];
        const extensions = new Set(files.map(f => extname(f)));
        
        if (extensions.has('.ts') || extensions.has('.tsx')) {
          const hasEslint = existsSync('.eslintrc') || existsSync('.eslintrc.json') || existsSync('.eslintrc.js') || existsSync('eslint.config.js') || existsSync('eslint.config.mjs');
          let hasTestScript = false;
          if (existsSync('package.json')) {
            try {
              const fsJson = require('node:fs');
              const pkg = JSON.parse(fsJson.readFileSync('package.json', 'utf8'));
              if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                hasTestScript = true;
              }
            } catch {}
          }
          return {
            language: 'typescript',
            typecheckCommand: existsSync('tsconfig.json') ? 'npx tsc --noEmit' : undefined,
            lintCommand: hasEslint ? 'npx eslint . --ext .ts,.tsx' : undefined,
            testCommand: hasTestScript ? 'npm test' : undefined
          };
        }
        if (extensions.has('.py')) {
          return {
            language: 'python',
            typecheckCommand: 'python -m py_compile .',
            lintCommand: 'python -m flake8 .',
            testCommand: 'python -m pytest'
          };
        }
      } catch {
        // Fall through
      }
    }

    if (existsSync('package.json')) {
      return {
        language: 'javascript',
        typecheckCommand: existsSync('tsconfig.json') ? 'npx tsc --noEmit' : undefined,
        lintCommand: 'npm run lint',
        testCommand: 'npm test'
      };
    }

    return { language: 'unknown' };
  }

  static getChangedFilesSince(): IncrementalFiles {
    // Try git diff --name-only for staged files
    try {
      const result = execSync('git diff --name-only --cached', { encoding: 'utf-8', timeout: 5000 });
      if (result.trim()) {
        return { files: result.trim().split('\n'), reason: 'git-staged' };
      }
    } catch {
      // Git not available or no staged files
    }

    // Try git diff for uncommitted changes
    try {
      const result = execSync('git diff --name-only', { encoding: 'utf-8', timeout: 5000 });
      if (result.trim()) {
        return { files: result.trim().split('\n'), reason: 'git-recent' };
      }
    } catch {
      // Fall through
    }

    return { files: [], reason: 'all' };
  }

  static filterByLanguage(files: string[], language: Language): string[] {
    const validExtensions = Object.entries(this.LANGUAGE_EXTENSIONS)
      .filter(([, lang]) => lang === language || (language === 'javascript' && lang === 'typescript'))
      .map(([ext]) => ext);
    
    return files.filter(f => validExtensions.includes(extname(f)));
  }
}

export class AutoFixer {
  static async tryAutoFix(results: VerificationStepResult[], language: Language): Promise<boolean> {
    const failedStep = results.find(r => !r.passed);
    if (!failedStep) return false;

    if (language === 'typescript') {
      return this.tryTsAutoFix(failedStep);
    }
    if (language === 'python') {
      return this.tryPyAutoFix(failedStep);
    }

    return false;
  }

  private static async tryTsAutoFix(step: VerificationStepResult): Promise<boolean> {
    // Auto-fix common TS issues
    const output = step.output;
    
    // Try prettier for formatting issues
    if (output.includes('prettier')) {
      try {
        await this.runCmd('npx prettier --write .');
        return true;
      } catch {
        return false;
      }
    }

    // Try eslint --fix for JS/TS issues
    if (output.includes('eslint') || output.includes('ESLint')) {
      try {
        await this.runCmd('npx eslint . --fix');
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private static async tryPyAutoFix(step: VerificationStepResult): Promise<boolean> {
    // Try black for formatting
    try {
      await this.runCmd('python -m black .');
      return true;
    } catch {
      return false;
    }
  }

  private static runCmd(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export class EnhancedVerificationChain {
  static async run(
    skipVerify = false,
    incremental = false,
    autoFix = false
  ): Promise<{
    passed: boolean;
    results: VerificationStepResult[];
    badge?: string;
    evaluation?: Awaited<ReturnType<typeof ResultEvaluator.evaluate>>;
    autoFixed?: boolean;
  }> {
    if (skipVerify) {
      return { passed: true, results: [] };
    }

    const langConfig = LanguageAwareVerifier.detectLanguage();
    const steps = this.getStepsForLanguage(langConfig);

    if (steps.length === 0) {
      return { passed: true, results: [] };
    }

    const results: VerificationStepResult[] = [];
    let overallPassed = true;
    let autoFixed = false;

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
        
        // Try auto-fix if enabled and this is a fixable error
        if (autoFix && this.isFixable(err?.message ?? String(err))) {
          const fixed = await AutoFixer.tryAutoFix(results, langConfig.language);
          if (fixed) {
            autoFixed = true;
            // Re-run verification after fix
            return this.run(true, incremental, false);
          }
        }
      }
    }

    if (!overallPassed) {
      const evaluation = ResultEvaluator.evaluate(results);
      return { passed: false, results, evaluation, autoFixed };
    }

    const badgeParts = results.map(r => `✓ ${r.name} ${(r.durationMs / 1000).toFixed(1)}s`);
    const badge = badgeParts.join(' · ');

    return { passed: true, results, badge, autoFixed };
  }

  private static getStepsForLanguage(config: LanguageConfig): Array<{ name: string; command: string; category: VerificationStepResult['category'] }> {
    const steps: Array<{ name: string; command: string; category: VerificationStepResult['category'] }> = [];
    
    if (config.typecheckCommand) {
      steps.push({ name: 'typecheck', command: config.typecheckCommand, category: 'type' });
    }
    if (config.lintCommand) {
      steps.push({ name: 'lint', command: config.lintCommand, category: 'lint' });
    }
    if (config.testCommand) {
      steps.push({ name: 'test', command: config.testCommand, category: 'test' });
    }
    steps.push({ name: 'diff-check', command: 'git diff --check', category: 'diff' });

    return steps;
  }

  private static isFixable(error: string): boolean {
    return /fixable|auto.?fix|prettier|eslint|black|format/i.test(error);
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
}

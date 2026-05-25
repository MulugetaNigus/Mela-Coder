/**
 * PHASE 3: Enhanced Verification Engine - Auto-Repair Loop
 * 
 * Automatically attempts to fix detected failures by:
 * - Analyzing failure patterns
 * - Generating targeted fixes
 * - Applying and verifying repairs
 * - Rolling back if repair fails
 */

import { FailureDetails, FailureClassifier, createFailureClassifier } from './failureClassifier.js';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface RepairAttempt {
  failure: FailureDetails;
  strategy: string;
  applied: boolean;
  verified: boolean;
  rolledBack: boolean;
  attempts: number;
  details?: string;
}

export interface AutoRepairConfig {
  maxAttemptsPerFailure?: number;
  enableTypeFixes?: boolean;
  enableSyntaxFixes?: boolean;
  enableImportFixes?: boolean;
  backupBeforeRepair?: boolean;
  onRepairAttempt?: (attempt: RepairAttempt) => void;
}

export class AutoRepairLoop {
  private readonly classifier: FailureClassifier;
  private readonly config: Required<AutoRepairConfig>;
  private backups: Map<string, string> = new Map(); // filePath -> backupPath

  constructor(config: AutoRepairConfig = {}) {
    this.classifier = createFailureClassifier();
    this.config = {
      maxAttemptsPerFailure: config.maxAttemptsPerFailure ?? 3,
      enableTypeFixes: config.enableTypeFixes ?? true,
      enableSyntaxFixes: config.enableSyntaxFixes ?? true,
      enableImportFixes: config.enableImportFixes ?? true,
      backupBeforeRepair: config.backupBeforeRepair ?? true,
      onRepairAttempt: config.onRepairAttempt ?? (() => {}),
    };
  }

  /**
   * Attempt to automatically repair detected failures
   */
  async attemptRepairs(
    failures: FailureDetails[],
    options?: {
      workspaceRoot?: string;
      verificationCommand?: string;
    }
  ): Promise<RepairAttempt[]> {
    const attempts: RepairAttempt[] = [];
    const workspaceRoot = options?.workspaceRoot ?? process.cwd();

    for (const failure of failures) {
      // Skip failures we can't auto-repair
      if (!this.isRepairable(failure)) {
        continue;
      }

      const attempt = await this.repairSingleFailure(failure, workspaceRoot, options?.verificationCommand);
      attempts.push(attempt);
      this.config.onRepairAttempt(attempt);
    }

    return attempts;
  }

  /**
   * Clean up any backup files
   */
  cleanup(): void {
    for (const [filePath, backupPath] of this.backups.entries()) {
      try {
        if (existsSync(backupPath)) {
          rmSync(backupPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.backups.clear();
  }

  private isRepairable(failure: FailureDetails): boolean {
    switch (failure.category) {
      case 'SYNTAX_ERROR':
        return this.config.enableSyntaxFixes;
      case 'TYPE_ERROR':
        return this.config.enableTypeFixes;
      case 'IMPORT_ERROR':
        return this.config.enableImportFixes;
      case 'NULL_REFERENCE':
        return this.config.enableTypeFixes;
      default:
        return false;
    }
  }

  private async repairSingleFailure(
    failure: FailureDetails,
    workspaceRoot: string,
    verificationCommand?: string
  ): Promise<RepairAttempt> {
    const attempt: RepairAttempt = {
      failure,
      strategy: this.determineRepairStrategy(failure),
      applied: false,
      verified: false,
      rolledBack: false,
      attempts: 0,
    };

    // Check if we have location information
    if (!failure.location?.file) {
      attempt.details = 'Cannot repair: no file location identified';
      return attempt;
    }

    const filePath = join(workspaceRoot, failure.location.file);
    
    if (!existsSync(filePath)) {
      attempt.details = `Cannot repair: file not found (${filePath})`;
      return attempt;
    }

    // Create backup
    let backupPath: string | null = null;
    if (this.config.backupBeforeRepair) {
      backupPath = await this.createBackup(filePath);
    }

    try {
      // Apply repair strategies
      for (let i = 0; i < this.config.maxAttemptsPerFailure; i++) {
        attempt.attempts++;
        
        const repaired = await this.applyRepairStrategy(failure, filePath, attempt.strategy, i);
        
        if (!repaired) {
          continue;
        }

        attempt.applied = true;

        // Verify the repair
        if (verificationCommand) {
          const verified = await this.verifyRepair(verificationCommand);
          attempt.verified = verified;
          
          if (verified) {
            // Success! Keep the repair
            attempt.details = `Successfully repaired ${failure.category} in ${failure.location.file}`;
            return attempt;
          } else {
            // Verification failed, rollback
            if (backupPath) {
              await this.rollback(filePath, backupPath);
              attempt.rolledBack = true;
            }
          }
        } else {
          // No verification command, assume success if applied
          attempt.verified = true;
          attempt.details = `Applied repair for ${failure.category} (no verification command)`;
          return attempt;
        }
      }

      // All attempts failed
      attempt.details = `Failed to repair after ${attempt.attempts} attempts`;
      
      // Final rollback if needed
      if (backupPath && !attempt.rolledBack) {
        await this.rollback(filePath, backupPath);
        attempt.rolledBack = true;
      }

      return attempt;
    } catch (error: any) {
      attempt.details = `Repair error: ${error.message}`;
      
      // Emergency rollback
      if (backupPath) {
        try {
          await this.rollback(filePath, backupPath);
          attempt.rolledBack = true;
        } catch {
          // Ignore rollback errors in emergency
        }
      }
      
      return attempt;
    }
  }

  private determineRepairStrategy(failure: FailureDetails): string {
    switch (failure.category) {
      case 'SYNTAX_ERROR':
        return 'syntax-fix';
      case 'TYPE_ERROR':
        return 'type-annotation';
      case 'IMPORT_ERROR':
        return 'import-resolution';
      case 'NULL_REFERENCE':
        return 'null-check';
      default:
        return 'generic-fix';
    }
  }

  private async applyRepairStrategy(
    failure: FailureDetails,
    filePath: string,
    strategy: string,
    attemptNum: number
  ): Promise<boolean> {
    try {
      const content = readFileSync(filePath, 'utf8');
      let repaired = content;

      switch (strategy) {
        case 'syntax-fix':
          repaired = this.applySyntaxFix(content, failure, attemptNum);
          break;
          
        case 'type-annotation':
          repaired = this.applyTypeFix(content, failure, attemptNum);
          break;
          
        case 'import-resolution':
          repaired = this.applyImportFix(content, failure, attemptNum);
          break;
          
        case 'null-check':
          repaired = this.applyNullCheck(content, failure, attemptNum);
          break;
          
        default:
          return false;
      }

      if (repaired !== content) {
        writeFileSync(filePath, repaired, 'utf8');
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private applySyntaxFix(content: string, failure: FailureDetails, attemptNum: number): string {
    const raw = failure.rawOutput.toLowerCase();
    
    // Fix missing semicolons (common in TypeScript)
    if (raw.includes('missing') && raw.includes('semicolon')) {
      if (failure.location?.line !== undefined) {
        return this.insertAtLine(content, failure.location.line, ';');
      }
    }

    // Fix unmatched brackets
    if (raw.includes('unexpected') && (raw.includes('}') || raw.includes(']') || raw.includes(')'))) {
      // Try removing extra closing bracket
      return this.removeExtraClosingBracket(content, failure);
    }

    // Fix missing brackets
    if (raw.includes('expected') && (raw.includes('{') || raw.includes('[') || raw.includes('('))) {
      if (failure.location?.line !== undefined) {
        return this.insertOpeningBracket(content, failure.location.line);
      }
    }

    return content;
  }

  private applyTypeFix(content: string, failure: FailureDetails, attemptNum: number): string {
    const raw = failure.rawOutput;
    
    // Add type annotation for implicit any
    if (raw.includes('implicitly has an') || raw.includes('implicit any')) {
      if (failure.location?.line !== undefined) {
        return this.addTypeAnnotation(content, failure.location.line, 'any');
      }
    }

    // Fix property does not exist
    if (raw.includes('does not exist on type')) {
      // This usually requires interface update, which is complex
      // For now, add type assertion as quick fix
      if (failure.location?.line !== undefined) {
        return this.addTypeAssertion(content, failure.location.line);
      }
    }

    return content;
  }

  private applyImportFix(content: string, failure: FailureDetails, attemptNum: number): string {
    const raw = failure.rawOutput;
    
    // Extract module name from error
    const moduleMatch = raw.match(/module\s+['"]([^'"]+)['"]/i);
    if (moduleMatch && moduleMatch[1]) {
      const moduleName = moduleMatch[1];
      
      // Check if it's a relative path issue
      if (!moduleName.startsWith('.') && !moduleName.startsWith('/')) {
        // Might need to install dependency - can't auto-fix
        return content;
      }
      
      // Try fixing relative path
      if (failure.location?.file) {
        const fixedPath = this.fixRelativeImport(content, moduleName, failure.location.file);
        if (fixedPath) {
          return fixedPath;
        }
      }
    }

    return content;
  }

  private applyNullCheck(content: string, failure: FailureDetails, attemptNum: number): string {
    // Extract property being accessed
    const propMatch = failure.rawOutput.match(/Cannot read propert(?:y|ies)\s+(?:of\s+)?['"]?(\w+)['"]?/i);
    
    if (propMatch && failure.location?.line !== undefined) {
      return this.addNullCheck(content, failure.location.line, propMatch[1]);
    }

    return content;
  }

  // Helper methods for applying fixes

  private insertAtLine(content: string, lineNum: number, text: string): string {
    const lines = content.split('\n');
    const index = Math.min(lineNum - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      lines[index] = lines[index].trimEnd() + text;
      return lines.join('\n');
    }
    
    return content;
  }

  private removeExtraClosingBracket(content: string, failure: FailureDetails): string {
    if (!failure.location?.line) return content;
    
    const lines = content.split('\n');
    const index = Math.min(failure.location.line - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      const line = lines[index];
      // Remove last closing bracket
      const modified = line.replace(/([}\]\)])\s*$/, '');
      if (modified !== line) {
        lines[index] = modified;
        return lines.join('\n');
      }
    }
    
    return content;
  }

  private insertOpeningBracket(content: string, lineNum: number): string {
    const lines = content.split('\n');
    const index = Math.min(lineNum - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      lines[index] = '{ ' + lines[index];
      return lines.join('\n');
    }
    
    return content;
  }

  private addTypeAnnotation(content: string, lineNum: number, type: string): string {
    const lines = content.split('\n');
    const index = Math.min(lineNum - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      const line = lines[index];
      // Look for variable declaration without type
      const match = line.match(/(let|const|var)\s+(\w+)\s*=/);
      if (match) {
        const varName = match[2];
        const replacement = `$1 ${varName}: ${type} =`;
        lines[index] = line.replace(match[0], replacement);
        return lines.join('\n');
      }
    }
    
    return content;
  }

  private addTypeAssertion(content: string, lineNum: number): string {
    const lines = content.split('\n');
    const index = Math.min(lineNum - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      const line = lines[index];
      // Add 'as any' assertion to the line
      if (!line.includes('as any')) {
        lines[index] = line.replace(/(\S+)\s*$/, '($1 as any)');
        return lines.join('\n');
      }
    }
    
    return content;
  }

  private fixRelativeImport(content: string, moduleName: string, currentFile: string): string | null {
    // Simple heuristic: try adding ../ prefix
    if (!moduleName.startsWith('.')) {
      const fixed = content.replace(
        new RegExp(`(['"])${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"])`, 'g'),
        `$1../${moduleName}$2`
      );
      
      if (fixed !== content) {
        return fixed;
      }
    }
    
    return null;
  }

  private addNullCheck(content: string, lineNum: number, propName: string): string {
    const lines = content.split('\n');
    const index = Math.min(lineNum - 1, lines.length - 1);
    
    if (index >= 0 && index < lines.length) {
      const indent = lines[index].match(/^\s*/)?.[0] ?? '';
      const nullCheck = `${indent}if (${propName} == null) return;\n`;
      lines.splice(index, 0, nullCheck);
      return lines.join('\n');
    }
    
    return content;
  }

  private async createBackup(filePath: string): Promise<string> {
    const backupPath = `${filePath}.mela-backup-${Date.now()}`;
    copyFileSync(filePath, backupPath);
    this.backups.set(filePath, backupPath);
    return backupPath;
  }

  private async rollback(filePath: string, backupPath: string): Promise<void> {
    copyFileSync(backupPath, filePath);
  }

  private async verifyRepair(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(command, { timeout: 30000 }, (error) => {
        resolve(!error);
      });
    });
  }
}

export function createAutoRepairLoop(config?: AutoRepairConfig): AutoRepairLoop {
  return new AutoRepairLoop(config);
}

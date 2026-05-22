import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export class ProjectMemory {
  private static readonly CANDIDATES = ['MELA.md', '.mela/memory.md', 'docs/MELA.md'];

  static findPath(): string | null {
    for (const cand of this.CANDIDATES) {
      const p = path.resolve(process.cwd(), cand);
      if (existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  static load(): string | null {
    const p = this.findPath();
    if (!p) return null;
    try {
      const content = readFileSync(p, 'utf8');
      return this.sanitize(content);
    } catch {
      return null;
    }
  }

  static init(): string {
    const template = `# Project Memory (MELA.md)

This file contains persistent project-level conventions, context, and configurations. Mela-Coder reads this on startup to align with the codebase.

## Tech Stack
- Framework: 
- Language: 
- Package Manager: 

## Commands
- Build: 
- Lint: 
- Test: 

## Conventions
- Code Style: 
- Error Handling: 

## Auth Patterns
- Setup: 

## Notes
- General hints and info.
`;
    const targetPath = path.resolve(process.cwd(), 'MELA.md');
    writeFileSync(targetPath, template, 'utf8');
    return targetPath;
  }

  static sanitize(content: string): string {
    const lines = content.split(/\r?\n/);
    const sanitized = lines.filter(line => !/KEY|SECRET|TOKEN|PASSWORD/i.test(line));
    return sanitized.join('\n');
  }

  static upsertSection(sectionName: string, content: string): void {
    let p = this.findPath();
    if (!p) {
      // Auto-initialize if it doesn't exist
      p = this.init();
    }
    try {
      const fileContent = readFileSync(p!, 'utf8');
      const newContent = this.upsertMarkdownSection(fileContent, sectionName, content);
      writeFileSync(p!, newContent, 'utf8');
    } catch {
      // Ignore errors
    }
  }

  private static upsertMarkdownSection(fileContent: string, sectionName: string, content: string): string {
    const lines = fileContent.split(/\r?\n/);
    const headerPattern = new RegExp(`^##\\s+${this.escapeRegExp(sectionName)}\\s*$`, 'i');
    
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (headerPattern.test(lines[i])) {
        startIndex = i;
        // Find next header or end
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith('##')) {
            endIndex = j;
            break;
          }
        }
        break;
      }
    }

    const sectionLines = [`## ${sectionName}`, ...content.split(/\r?\n/)];

    if (startIndex !== -1) {
      // Section exists, replace it
      const end = endIndex !== -1 ? endIndex : lines.length;
      lines.splice(startIndex, end - startIndex, ...sectionLines);
    } else {
      // Section does not exist, append it
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
        lines.push('');
      }
      lines.push(...sectionLines);
    }

    return lines.join('\n');
  }

  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

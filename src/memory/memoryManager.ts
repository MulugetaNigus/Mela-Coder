import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ProjectMemory } from './project';

export interface ShortTermMemory {
  currentTask: string;
  inspectedFiles: string[];
  editedFiles: string[];
  discoveredIssues: string[];
  pendingTasks: string[];
  verificationResults: string[];
}

export interface WorkingMemoryData {
  repoSummary: string;
  techStack: string[];
  commands: string[];
  conventions: string[];
  fileRelationships: Map<string, string[]>;
}

export interface MemorySnapshot {
  shortTerm: ShortTermMemory;
  working: Partial<WorkingMemoryData>;
  timestamp: number;
}

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private working: WorkingMemoryData;
  private readonly sessionDir: string;

  constructor() {
    this.shortTerm = this.emptyShortTerm();
    this.working = this.emptyWorking();
    this.sessionDir = path.join(os.homedir(), '.addis-code', 'sessions');
    this.ensureSessionDir();
  }

  private emptyShortTerm(): ShortTermMemory {
    return {
      currentTask: '',
      inspectedFiles: [],
      editedFiles: [],
      discoveredIssues: [],
      pendingTasks: [],
      verificationResults: []
    };
  }

  private emptyWorking(): WorkingMemoryData {
    return {
      repoSummary: '',
      techStack: [],
      commands: [],
      conventions: [],
      fileRelationships: new Map()
    };
  }

  private ensureSessionDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  // Short-term memory operations
  setTask(task: string): void {
    this.shortTerm.currentTask = task;
  }

  addInspectedFile(file: string): void {
    if (!this.shortTerm.inspectedFiles.includes(file)) {
      this.shortTerm.inspectedFiles.push(file);
    }
  }

  addEditedFile(file: string): void {
    if (!this.shortTerm.editedFiles.includes(file)) {
      this.shortTerm.editedFiles.push(file);
    }
  }

  addIssue(issue: string): void {
    if (!this.shortTerm.discoveredIssues.includes(issue)) {
      this.shortTerm.discoveredIssues.push(issue);
    }
  }

  addPendingTask(task: string): void {
    this.shortTerm.pendingTasks.push(task);
  }

  addVerificationResult(result: string): void {
    this.shortTerm.verificationResults.push(result);
  }

  getShortTerm(): ShortTermMemory {
    return { ...this.shortTerm };
  }

  // Working memory operations
  setRepoSummary(summary: string): void {
    this.working.repoSummary = summary;
  }

  addTechStack(tech: string): void {
    if (!this.working.techStack.includes(tech)) {
      this.working.techStack.push(tech);
    }
  }

  addCommand(command: string): void {
    this.working.commands.push(command);
  }

  addConvention(convention: string): void {
    this.working.conventions.push(convention);
  }

  addFileRelationship(file: string, related: string[]): void {
    this.working.fileRelationships.set(file, related);
  }

  getWorking(): WorkingMemoryData {
    return {
      ...this.working,
      fileRelationships: new Map(this.working.fileRelationships)
    };
  }

  // Load from project memory
  async loadProjectMemory(): Promise<void> {
    const projectMemory = ProjectMemory.load();
    if (projectMemory) {
      // Parse tech stack from project memory
      const lines = projectMemory.split('\n');
      let currentSection = '';
      
      for (const line of lines) {
        if (line.startsWith('## ')) {
          currentSection = line.slice(3).trim();
          continue;
        }
        
        if (currentSection === 'Tech Stack' && line.startsWith('-')) {
          this.working.techStack.push(line.slice(1).trim());
        } else if (currentSection === 'Commands' && line.startsWith('-')) {
          this.working.commands.push(line.slice(1).trim());
        }
      }
    }
  }

  // Snapshot for checkpointing
  createSnapshot(): MemorySnapshot {
    return {
      shortTerm: this.getShortTerm(),
      working: this.getWorking(),
      timestamp: Date.now()
    };
  }

  restoreFromSnapshot(snapshot: MemorySnapshot): void {
    this.shortTerm = snapshot.shortTerm;
    this.working = {
      ...this.emptyWorking(),
      ...snapshot.working,
      fileRelationships: new Map(snapshot.working.fileRelationships)
    };
  }

  reset(): void {
    this.shortTerm = this.emptyShortTerm();
    this.working = this.emptyWorking();
  }
}
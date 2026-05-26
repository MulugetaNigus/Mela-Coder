import type { SystemPromptResult } from './systemPrompt';
import type { TaskPlan, TaskStep } from './taskOrchestrator';
import { MemoryManager, ShortTermMemory, WorkingMemoryData } from '../memory/memoryManager';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WorkingMemory {
  inspectedFiles: string[];
  editedFiles: string[];
  pendingTasks: string[];
  discoveredIssues: string[];
  verificationResults: string[];
  repoSummary: string;
}

const MAX_HISTORY_TURNS = 30;
const COMPACT_THRESHOLD = 20;

export class ContextManager {
  private history: ConversationTurn[] = [];
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private memory: MemoryManager;
  private workingMemory: WorkingMemory;

  constructor(
    private readonly systemPrompt: SystemPromptResult,
    memory?: MemoryManager
  ) {
    this.memory = memory ?? new MemoryManager();
    this.workingMemory = {
      inspectedFiles: [],
      editedFiles: [],
      pendingTasks: [],
      discoveredIssues: [],
      verificationResults: [],
      repoSummary: ''
    };
    this.history.push({ role: 'user', content: this.systemPrompt.full });
  }

  addTurn(turn: ConversationTurn): void {
    this.history.push(turn);
    this.maybeCompact();
  }

  updateWorkingMemory(memory: Partial<WorkingMemory>): void {
    this.workingMemory = { ...this.workingMemory, ...memory };
  }

  getWorkingMemory(): WorkingMemory {
    return this.workingMemory;
  }

  updateSystemPrompt(systemPrompt: SystemPromptResult): void {
    (this as any).systemPrompt = systemPrompt;
    if (this.history.length > 0 && this.history[0].role === 'user') {
      this.history[0].content = systemPrompt.full;
    }
  }

  getHistoryForRequest(): ConversationTurn[] {
    return this.history;
  }

  restoreHistory(turns: ConversationTurn[]): void {
    this.history = [...turns];
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  reset(): void {
    this.history = [{ role: 'user', content: this.systemPrompt.full }];
    this.cumulativeInputTokens = 0;
    this.cumulativeOutputTokens = 0;
    this.workingMemory = {
      inspectedFiles: [],
      editedFiles: [],
      pendingTasks: [],
      discoveredIssues: [],
      verificationResults: [],
      repoSummary: ''
    };
    this.memory.reset();
  }

  getHistoryStats(): { turns: number; estimatedTokens: number } {
    return {
      turns: this.history.length,
      estimatedTokens: this.history.reduce((sum, turn) => sum + this.estimateTokens(turn.content), 0)
    };
  }

  getSegmentedPrompt(): SystemPromptResult {
    return this.systemPrompt;
  }

  recordInputTokens(tokens: number): void {
    this.cumulativeInputTokens += tokens;
  }

  recordOutputTokens(tokens: number): void {
    this.cumulativeOutputTokens += tokens;
  }

  getCacheStats(): { cumulativeInputTokens: number; cumulativeOutputTokens: number; estimatedSavings: number } {
    const systemPromptTokens = this.estimateTokens(this.systemPrompt.full);
    const userTurns = this.history.filter(t => t.role === 'user').length;
    const estimatedSavings = userTurns > 1 ? systemPromptTokens * (userTurns - 1) : 0;
    return {
      cumulativeInputTokens: this.cumulativeInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
      estimatedSavings
    };
  }

  private maybeCompact(): void {
    if (this.history.length <= COMPACT_THRESHOLD) return;

    const systemPrompt = this.history[0];
    const olderTurns = this.history.slice(1, -MAX_HISTORY_TURNS);
    const recentTurns = this.history.slice(-MAX_HISTORY_TURNS);

    if (olderTurns.length === 0) return;

    const summary = this.summarizeTurns(olderTurns);
    const summaryTurn: ConversationTurn = { role: 'user', content: summary };
    
    this.history = [systemPrompt, summaryTurn, ...recentTurns];
  }

  private summarizeTurns(turns: ConversationTurn[]): string {
    const editedFiles = new Set<string>();
    const inspectedFiles = new Set<string>();
    let errorsCount = 0;

    for (const turn of turns) {
      const text = turn.content;
      // Extract modified files
      const writeMatch = text.match(/write_file\s+path:\s*([^\n]+)/i) || 
                         text.match(/write_file\s+.*?path.*?:\s*["']?([^"'\n\s,]+)/i);
      if (writeMatch) editedFiles.add(writeMatch[1].trim());

      const editMatch = text.match(/edit_file\s+path:\s*([^\n]+)/i) || 
                        text.match(/edit_file\s+.*?path.*?:\s*["']?([^"'\n\s,]+)/i) || 
                        text.match(/str_replace\s+.*?path.*?:\s*["']?([^"'\n\s,]+)/i);
      if (editMatch) editedFiles.add(editMatch[1].trim());

      // Extract read files
      const readMatch = text.match(/read_file\s+path:\s*([^\n]+)/i) || 
                        text.match(/read_file\s+.*?path.*?:\s*["']?([^"'\n\s,]+)/i);
      if (readMatch) inspectedFiles.add(readMatch[1].trim());

      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('fail')) {
        errorsCount++;
      }
    }

    const lines = ['[SHORT-TERM MEMORY]'];
    if (editedFiles.size > 0) {
      lines.push(`Modified: ${Array.from(editedFiles).join(', ')}`);
    }
    if (inspectedFiles.size > 0) {
      lines.push(`Read: ${Array.from(inspectedFiles).join(', ')}`);
    }
    if (errorsCount > 0) {
      lines.push(`Errors: ${errorsCount}`);
    }

    return lines.join(' | ');
  }

  injectTaskContext(plan: TaskPlan): void {
    const context = this.buildTaskContext(plan);
    this.history.push({ role: 'user', content: context });
  }

  private buildTaskContext(plan: TaskPlan): string {
    const lines: string[] = ['--- EXECUTION CONTEXT ---'];
    lines.push(`Goal: ${plan.goal}`);
    
    const pending = plan.steps.filter(s => s.status === 'pending').slice(0, 3);
    if (pending.length > 0) {
      lines.push('Pending steps:');
      for (const step of pending) {
        lines.push(`  - ${step.description.slice(0, 60)}`);
      }
    }

    if (this.workingMemory.discoveredIssues.length > 0) {
      lines.push(`Issues: ${this.workingMemory.discoveredIssues.slice(-2).join('; ')}`);
    }

    return lines.join('\n');
  }

  getMemoryManager(): MemoryManager {
    return this.memory;
  }
}
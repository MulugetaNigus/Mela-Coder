import type { SystemPromptResult } from './systemPrompt';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class ContextManager {
  private history: ConversationTurn[] = [];
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;

  constructor(
    private readonly systemPrompt: SystemPromptResult
  ) {
    this.history.push({ role: 'user', content: this.systemPrompt.full });
  }

  addTurn(turn: ConversationTurn): void {
    this.history.push(turn);
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
}


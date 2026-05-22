import { MelaClient } from '../api/melaClient';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class ContextManager {
  private history: ConversationTurn[] = [];

  constructor(
    private readonly systemPrompt: string,
    private readonly tokenBudget = 6000
  ) {
    this.history.push({ role: 'user', content: this.systemPrompt });
  }

  addTurn(turn: ConversationTurn): void {
    this.history.push(turn);
  }

  getHistoryForRequest(): ConversationTurn[] {
    const available = this.tokenBudget - 2048 - 800;
    const selected: ConversationTurn[] = [];
    let tokens = 0;

    for (let index = this.history.length - 1; index >= 0; index--) {
      const turn = this.history[index];
      const turnTokens = this.estimateTokens(turn.content);
      if (tokens + turnTokens > available && index !== 0) break;
      selected.unshift(turn);
      tokens += turnTokens;
    }

    if (selected[0] !== this.history[0]) {
      selected.unshift(this.history[0]);
    }

    return selected;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  async ensureWithinBudget(client: MelaClient): Promise<void> {
    const available = this.tokenBudget - 2048 - 800;
    const tokens = this.history.reduce((sum, turn) => sum + this.estimateTokens(turn.content), 0);
    if (tokens > available) {
      await this.summarizeOldest(client);
    }
  }

  private async summarizeOldest(client: MelaClient): Promise<void> {
    try {
      if (this.history.length <= 5) return;
      const systemTurn = this.history[0];
      const lastTurns = this.history.slice(-4);
      const oldTurns = this.history.slice(1, -4);
      if (!oldTurns.length) return;

      const serialized = oldTurns.map(turn => `${turn.role}: ${turn.content}`).join('\n\n');
      const prompt = `Summarize the following conversation in 3-5 bullet points.
Be precise about what files were edited, what commands were run, and what the current task state is.

<conversation>
${serialized}
</conversation>`;
      const response = await client.generate(prompt, {});

      this.history = [
        systemTurn,
        { role: 'assistant', content: `## Previous context summary\n${response.response_text.trim()}` },
        ...lastTurns
      ];
    } catch (err: any) {
      throw new Error(err?.message ?? 'Failed to summarize conversation history');
    }
  }

  reset(): void {
    this.history = [{ role: 'user', content: this.systemPrompt }];
  }

  getHistoryStats(): { turns: number; estimatedTokens: number } {
    return {
      turns: this.history.length,
      estimatedTokens: this.history.reduce((sum, turn) => sum + this.estimateTokens(turn.content), 0)
    };
  }
}

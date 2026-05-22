import { runSubAgent, type SubAgentParams, type SubAgentResult } from '../agent/subAgent';
import { MelaClient } from '../api/melaClient';

export class Semaphore {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.activeCount--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class AgentDispatcher {
  private readonly semaphore: Semaphore;

  constructor(concurrency = 3) {
    this.semaphore = new Semaphore(concurrency);
  }

  async dispatch(
    specs: SubAgentParams[],
    melaToken: string,
    client: MelaClient,
    timeoutMs = 300000 // 5 minutes
  ): Promise<SubAgentResult[]> {
    const promises = specs.map(spec =>
      this.semaphore.run(() => this.runWithTimeout(spec, melaToken, client, timeoutMs))
    );
    return Promise.all(promises);
  }

  private async runWithTimeout(
    spec: SubAgentParams,
    melaToken: string,
    client: MelaClient,
    timeoutMs: number
  ): Promise<SubAgentResult> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<SubAgentResult>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Sub-agent ${spec.agentType} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        runSubAgent(spec, melaToken, client),
        timeoutPromise,
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      return {
        agentType: spec.agentType,
        success: false,
        output: '',
        error: err?.message ?? 'Execution failed or timed out',
        filesModified: [],
      };
    }
  }

  static checkConflicts(results: SubAgentResult[]): string[] {
    const fileToAgentIdx = new Map<string, number[]>();
    const warnings: string[] = [];

    results.forEach((res, idx) => {
      if (res.filesModified) {
        for (const file of res.filesModified) {
          if (!fileToAgentIdx.has(file)) {
            fileToAgentIdx.set(file, []);
          }
          fileToAgentIdx.get(file)!.push(idx);
        }
      }
    });

    for (const [file, indices] of fileToAgentIdx.entries()) {
      if (indices.length > 1) {
        const agentTypes = indices.map(i => `Agent ${i + 1} (${results[i].agentType})`).join(', ');
        warnings.push(`⚠️ Conflict: File "${file}" was modified by multiple agents: ${agentTypes}`);
      }
    }

    return warnings;
  }
}

import { writeFileSync, renameSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { ConversationTurn } from '../agent/contextManager';

export interface CheckpointData {
  version: string;
  timestamp: number;
  taskDescription: string;
  conversationHistory: ConversationTurn[];
}

const CHECKPOINT_PATH = path.join(process.cwd(), '.mela-checkpoint.json');
const CURRENT_VERSION = '1.0.0';

export class CheckpointManager {
  static save(taskDescription: string, history: ConversationTurn[]): void {
    const data: CheckpointData = {
      version: CURRENT_VERSION,
      timestamp: Date.now(),
      taskDescription,
      conversationHistory: history,
    };

    const tempPath = `${CHECKPOINT_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tempPath, CHECKPOINT_PATH);
  }

  static load(): CheckpointData | null {
    if (!existsSync(CHECKPOINT_PATH)) {
      return null;
    }
    try {
      const content = readFileSync(CHECKPOINT_PATH, 'utf8');
      const data = JSON.parse(content) as CheckpointData;
      if (data.version !== CURRENT_VERSION) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  static isStale(data: CheckpointData): boolean {
    const oneDayMs = 24 * 60 * 60 * 1000;
    return Date.now() - data.timestamp > oneDayMs;
  }

  static delete(): void {
    if (existsSync(CHECKPOINT_PATH)) {
      try {
        unlinkSync(CHECKPOINT_PATH);
      } catch {
        // Ignore deletion errors
      }
    }
  }
}

export function registerInterruptHandlers(
  taskDescription: string,
  getState: () => { history: ConversationTurn[] },
  onShutdown?: () => Promise<void>
): void {
  const handleSignal = async () => {
    process.stdout.write('\n\x1b[33m⚠️ Interrupted. Saving checkpoint state...\x1b[0m\n');
    try {
      if (onShutdown) {
        await onShutdown();
      }
      const state = getState();
      CheckpointManager.save(taskDescription, state.history);
      process.stdout.write('\x1b[32m✓ Checkpoint saved to .mela-checkpoint.json. You can resume with --resume\x1b[0m\n');
    } catch (err: any) {
      process.stderr.write(`Failed to save checkpoint: ${err?.message ?? err}\n`);
    }
    process.exit(130);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

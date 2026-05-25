/**
 * Short-Term Memory (STM)
 * 
 * Volatile, high-frequency memory for current task execution.
 * Stores: current task state, active files, recent actions, errors.
 * Lifecycle: Session-bound, cleared on task completion.
 */

import { EventEmitter } from 'events';

export interface STMEntry<T = unknown> {
  id: string;
  timestamp: number;
  ttl?: number; // Time-to-live in ms
  data: T;
  metadata?: {
    source: 'action' | 'observation' | 'error' | 'plan';
    priority: 'high' | 'medium' | 'low';
    tags?: string[];
  };
}

export interface ShortTermMemoryConfig {
  maxEntries: number;
  defaultTTL: number; // ms
  cleanupInterval: number; // ms
}

const DEFAULT_CONFIG: ShortTermMemoryConfig = {
  maxEntries: 500,
  defaultTTL: 30 * 60 * 1000, // 30 minutes
  cleanupInterval: 60 * 1000, // 1 minute
};

export class ShortTermMemory extends EventEmitter {
  private entries: Map<string, STMEntry>;
  private chronologicalOrder: string[];
  private config: ShortTermMemoryConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<ShortTermMemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entries = new Map();
    this.chronologicalOrder = [];
    this.startCleanup();
  }

  /**
   * Add entry to short-term memory
   */
  add<T>(key: string, data: T, metadata?: STMEntry<T>['metadata'], ttl?: number): void {
    const entry: STMEntry<T> = {
      id: key,
      timestamp: Date.now(),
      ttl: ttl ?? this.config.defaultTTL,
      data,
      metadata: metadata ?? {
        source: 'action',
        priority: 'medium',
      },
    };

    // Remove existing entry with same key
    if (this.entries.has(key)) {
      this.remove(key);
    }

    // Enforce max entries (evict oldest low-priority)
    if (this.entries.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(key, entry);
    this.chronologicalOrder.push(key);
    
    this.emit('entry-added', { key, entry });
  }

  /**
   * Get entry by key
   */
  get<T>(key: string): STMEntry<T> | null {
    const entry = this.entries.get(key) as STMEntry<T> | undefined;
    if (!entry) return null;
    
    // Check TTL
    if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
      this.remove(key);
      return null;
    }
    
    return entry;
  }

  /**
   * Get recent entries
   */
  getRecent(count: number = 50): STMEntry[] {
    const recent = this.chronologicalOrder
      .slice(-count)
      .map(key => this.entries.get(key))
      .filter((e): e is STMEntry => e !== undefined);
    
    return recent;
  }

  /**
   * Get entries by priority
   */
  getByPriority(priority: 'high' | 'medium' | 'low'): STMEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.metadata?.priority === priority)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get entries by tag
   */
  getByTag(tag: string): STMEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.metadata?.tags?.includes(tag));
  }

  /**
   * Get entries by source type
   */
  getBySource(source: 'action' | 'observation' | 'error' | 'plan'): STMEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.metadata?.source === source)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get all errors
   */
  getErrors(): STMEntry[] {
    return this.getBySource('error');
  }

  /**
   * Get active files tracking
   */
  getActiveFiles(): string[] {
    const fileEntries = this.getByTag('file');
    return fileEntries.map(e => e.id);
  }

  /**
   * Track file access
   */
  trackFileAccess(filePath: string, action: 'read' | 'write' | 'edit'): void {
    this.add(`file:${filePath}`, { filePath, action }, {
      source: 'action',
      priority: 'high',
      tags: ['file', action],
    }, 5 * 60 * 1000); // 5 min TTL for file tracking
  }

  /**
   * Track recent action
   */
  trackAction(actionType: string, details: unknown): void {
    this.add(`action:${Date.now()}`, { actionType, details }, {
      source: 'action',
      priority: 'medium',
      tags: ['action', actionType],
    });
  }

  /**
   * Track error
   */
  trackError(error: Error, context?: string): void {
    this.add(`error:${Date.now()}`, { 
      message: error.message, 
      stack: error.stack,
      context 
    }, {
      source: 'error',
      priority: 'high',
      tags: ['error'],
    }, 10 * 60 * 1000); // 10 min TTL for errors
  }

  /**
   * Remove entry
   */
  remove(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      const idx = this.chronologicalOrder.indexOf(key);
      if (idx > -1) {
        this.chronologicalOrder.splice(idx, 1);
      }
      this.emit('entry-removed', { key });
    }
    return existed;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.chronologicalOrder = [];
    this.emit('cleared');
  }

  /**
   * Clear old entries (manual trigger)
   */
  clearOlderThan(ageMs: number): number {
    const cutoff = Date.now() - ageMs;
    let removed = 0;
    
    for (const [key, entry] of this.entries) {
      if (entry.timestamp < cutoff) {
        this.remove(key);
        removed++;
      }
    }
    
    return removed;
  }

  /**
   * Export state for checkpointing
   */
  export(): unknown {
    return {
      entries: Array.from(this.entries.entries()),
      chronologicalOrder: [...this.chronologicalOrder],
      exportedAt: Date.now(),
    };
  }

  /**
   * Import state from checkpoint
   */
  import(state: unknown): void {
    const data = state as { entries: [string, STMEntry][]; chronologicalOrder: string[] };
    this.entries = new Map(data.entries);
    this.chronologicalOrder = [...data.chronologicalOrder];
    this.emit('restored');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number;
    byPriority: Record<string, number>;
    bySource: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.entries.values());
    
    return {
      totalEntries: entries.length,
      byPriority: {
        high: entries.filter(e => e.metadata?.priority === 'high').length,
        medium: entries.filter(e => e.metadata?.priority === 'medium').length,
        low: entries.filter(e => e.metadata?.priority === 'low').length,
      },
      bySource: {
        action: entries.filter(e => e.metadata?.source === 'action').length,
        observation: entries.filter(e => e.metadata?.source === 'observation').length,
        error: entries.filter(e => e.metadata?.source === 'error').length,
        plan: entries.filter(e => e.metadata?.source === 'plan').length,
      },
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : null,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : null,
    };
  }

  private evictOldest(): void {
    // Find oldest low-priority entry first, then medium, then high
    const priorities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
    
    for (const priority of priorities) {
      const oldestKey = this.chronologicalOrder.find(key => {
        const entry = this.entries.get(key);
        return entry?.metadata?.priority === priority;
      });
      
      if (oldestKey) {
        this.remove(oldestKey);
        return;
      }
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.clearOlderThan(this.config.defaultTTL);
    }, this.config.cleanupInterval);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
  }
}

/**
 * Unified Memory System
 * 
 * Orchestrates Short-Term, Working, and Long-Term memory.
 * Provides a single interface for all memory operations.
 */

import { EventEmitter } from 'events';
import { ShortTermMemory, STMEntry } from './short-term/stm';
import { WorkingMemory, DependencyNode, ArchitectureSummary, RepoConvention } from './working/wm';
import { LongTermMemory, MemoryDocument, SemanticQuery, RetrievalResult } from './long-term/ltm';

export interface MemorySystemConfig {
  stm?: Partial<ConstructorParameters<typeof ShortTermMemory>[0]>;
  wm?: Partial<ConstructorParameters<typeof WorkingMemory>[0]>;
  ltm?: Partial<ConstructorParameters<typeof LongTermMemory>[0]>;
  enableLTM: boolean;
}

export interface MemoryQuery {
  query: string;
  scope?: 'short' | 'working' | 'long' | 'all';
  limit?: number;
}

export interface MemoryContext {
  recentActions: STMEntry[];
  activeFiles: string[];
  relevantDependencies: Set<string>;
  architectureHints: ArchitectureSummary[];
  conventions: RepoConvention[];
  semanticMemories: RetrievalResult[];
  errors: STMEntry[];
}

export class MemorySystem extends EventEmitter {
  public shortTerm: ShortTermMemory;
  public working: WorkingMemory;
  public longTerm: LongTermMemory;
  private config: MemorySystemConfig;
  private initialized: boolean = false;

  constructor(config: Partial<MemorySystemConfig> = {}) {
    super();
    
    this.config = {
      enableLTM: true,
      ...config,
    };

    this.shortTerm = new ShortTermMemory(this.config.stm);
    this.working = new WorkingMemory(this.config.wm);
    this.longTerm = new LongTermMemory(this.config.ltm);

    this.setupEventForwarding();
  }

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.enableLTM) {
      await this.longTerm.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Build complete context for the agent
   */
  async buildContext(query?: MemoryQuery): Promise<MemoryContext> {
    const context: MemoryContext = {
      recentActions: this.shortTerm.getRecent(20),
      activeFiles: this.shortTerm.getActiveFiles(),
      relevantDependencies: new Set<string>(),
      architectureHints: [],
      conventions: this.working.getAllConventions().slice(0, 10),
      semanticMemories: [],
      errors: this.shortTerm.getErrors(),
    };

    // If query provided, enrich with relevant data
    if (query) {
      const scope = query.scope || 'all';
      const limit = query.limit || 5;

      if (scope === 'short' || scope === 'all') {
        context.recentActions = this.shortTerm.getRecent(limit * 2);
      }

      if (scope === 'working' || scope === 'all') {
        // Find relevant architecture summaries
        const keywords = query.query.split(/\s+/).filter(w => w.length > 3);
        for (const keyword of keywords.slice(0, 3)) {
          const summaries = this.working.findSummariesByKeyword(keyword);
          context.architectureHints.push(...summaries);
        }
        // Deduplicate
        context.architectureHints = Array.from(
          new Map(context.architectureHints.map(s => [s.id, s])).values()
        );
      }

      if (scope === 'long' || scope === 'all') {
        if (this.config.enableLTM) {
          context.semanticMemories = await this.longTerm.query({
            query: query.query,
            limit,
          });
        }
      }
    }

    return context;
  }

  /**
   * Record an action in memory
   */
  recordAction(actionType: string, details: unknown, metadata?: {
    priority?: 'high' | 'medium' | 'low';
    tags?: string[];
  }): void {
    this.shortTerm.trackAction(actionType, details);
    this.emit('action-recorded', { actionType, details });
  }

  /**
   * Record file access
   */
  recordFileAccess(filePath: string, action: 'read' | 'write' | 'edit'): void {
    this.shortTerm.trackFileAccess(filePath, action);
    this.emit('file-access', { filePath, action });
  }

  /**
   * Record an error
   */
  recordError(error: Error, context?: string): void {
    this.shortTerm.trackError(error, context);
    this.emit('error-recorded', { error, context });
  }

  /**
   * Add dependency node
   */
  addDependencyNode(node: DependencyNode): void {
    this.working.addNode(node);
  }

  /**
   * Add edge between dependencies
   */
  addDependencyEdge(fromId: string, toId: string): void {
    this.working.addEdge(fromId, toId);
  }

  /**
   * Get impact analysis for a file change
   */
  getImpactAnalysis(nodeId: string): ReturnType<WorkingMemory['findImpact']> {
    return this.working.findImpact(nodeId);
  }

  /**
   * Store knowledge in long-term memory
   */
  async storeKnowledge(
    type: 'fix' | 'pattern' | 'workflow' | 'knowledge',
    content: string,
    metadata: Partial<MemoryDocument['metadata']>
  ): Promise<void> {
    if (!this.config.enableLTM) return;

    await this.longTerm.store({
      id: `${type}:${Date.now()}:${Buffer.from(content).toString('base64').slice(0, 16)}`,
      content,
      metadata: {
        type,
        createdAt: Date.now(),
        ...metadata,
      },
    });

    this.emit('knowledge-stored', { type, content });
  }

  /**
   * Query memory semantically
   */
  async query(query: string, options?: {
    scope?: 'short' | 'working' | 'long' | 'all';
    limit?: number;
  }): Promise<{
    shortTerm: STMEntry[];
    working: { nodes: DependencyNode[]; summaries: ArchitectureSummary[]; conventions: RepoConvention[] };
    longTerm: RetrievalResult[];
  }> {
    const scope = options?.scope || 'all';
    const limit = options?.limit || 5;

    const results = {
      shortTerm: [] as STMEntry[],
      working: { nodes: [] as DependencyNode[], summaries: [] as ArchitectureSummary[], conventions: [] as RepoConvention[] },
      longTerm: [] as RetrievalResult[],
    };

    if (scope === 'short' || scope === 'all') {
      results.shortTerm = this.shortTerm.getRecent(limit * 2);
    }

    if (scope === 'working' || scope === 'all') {
      const keywords = query.split(/\s+/).filter(w => w.length > 3);
      for (const keyword of keywords.slice(0, 3)) {
        results.working.summaries.push(...this.working.findSummariesByKeyword(keyword));
      }
      results.working.conventions = this.working.getAllConventions().slice(0, limit);
    }

    if (scope === 'long' || scope === 'all') {
      if (this.config.enableLTM) {
        results.longTerm = await this.longTerm.query({ query, limit });
      }
    }

    return results;
  }

  /**
   * Compact memories
   */
  async compact(): Promise<{
    stmCleared: number;
    ltmCompacted: number;
  }> {
    const stmCleared = this.shortTerm.clearOlderThan(30 * 60 * 1000); // 30 min
    const ltmCompacted = this.config.enableLTM 
      ? await this.longTerm.compact(90 * 24 * 60 * 60 * 1000) // 90 days
      : 0;

    this.emit('compacted', { stmCleared, ltmCompacted });
    return { stmCleared, ltmCompacted };
  }

  /**
   * Export all memory state
   */
  export(): unknown {
    return {
      shortTerm: this.shortTerm.export(),
      working: this.working.export(),
      longTerm: this.config.enableLTM ? this.longTerm.export() : null,
      exportedAt: Date.now(),
    };
  }

  /**
   * Import memory state
   */
  import(state: unknown): void {
    const data = state as {
      shortTerm?: unknown;
      working?: unknown;
      longTerm?: unknown;
    };

    if (data.shortTerm) {
      this.shortTerm.import(data.shortTerm);
    }
    if (data.working) {
      this.working.import(data.working);
    }
    if (data.longTerm && this.config.enableLTM) {
      this.longTerm.import(data.longTerm);
    }

    this.emit('imported');
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    shortTerm: ReturnType<ShortTermMemory['getStats']>;
    working: ReturnType<WorkingMemory['getStats']>;
    longTerm: ReturnType<LongTermMemory['getStats']>;
    initialized: boolean;
  } {
    return {
      shortTerm: this.shortTerm.getStats(),
      working: this.working.getStats(),
      longTerm: this.config.enableLTM ? this.longTerm.getStats() : {
        totalDocuments: 0,
        byType: {},
        localCacheSize: 0,
      },
      initialized: this.initialized,
    };
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.shortTerm.clear();
    this.working.clear();
    if (this.config.enableLTM) {
      this.longTerm.clear();
    }
    this.emit('cleared');
  }

  /**
   * Destroy the memory system
   */
  destroy(): void {
    this.shortTerm.destroy();
    this.working.destroy();
    this.longTerm.destroy();
    this.emit('destroyed');
  }

  private setupEventForwarding(): void {
    // Forward events from sub-memories
    this.shortTerm.on('entry-added', (e) => this.emit('stm-entry', e));
    this.shortTerm.on('entry-removed', (e) => this.emit('stm-remove', e));
    
    this.working.on('node-added', (e) => this.emit('wm-node', e));
    this.working.on('summary-added', (e) => this.emit('wm-summary', e));
    this.working.on('convention-added', (e) => this.emit('wm-convention', e));
    
    if (this.config.enableLTM) {
      this.longTerm.on('stored', (e) => this.emit('ltm-store', e));
      this.longTerm.on('queried', (e) => this.emit('ltm-query', e));
    }
  }
}

// Convenience function to create a pre-configured memory system
export function createMemorySystem(workspacePath: string): MemorySystem {
  return new MemorySystem({
    enableLTM: true,
    wm: {
      persistencePath: `${workspacePath}/.mela/working-memory.json`,
      autoSaveInterval: 30 * 60 * 1000,
    },
    ltm: {
      persistDirectory: `${workspacePath}/.mela/ltm`,
    },
  });
}

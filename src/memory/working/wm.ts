/**
 * Working Memory (WM)
 * 
 * Mid-term memory for project structure, architecture, and relationships.
 * Stores: dependency graphs, module relationships, repo conventions, architecture summaries.
 * Lifecycle: Project-bound, persists across sessions.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DependencyNode {
  id: string;
  type: 'file' | 'module' | 'class' | 'function';
  path: string;
  dependencies: string[]; // IDs of dependent nodes
  dependents: string[]; // IDs of nodes that depend on this
  metadata?: {
    imports?: string[];
    exports?: string[];
    size?: number;
    lastModified?: number;
  };
}

export interface ArchitectureSummary {
  id: string;
  name: string;
  description: string;
  layers: string[];
  patterns: string[];
  conventions: string[];
  keyModules: string[];
  lastUpdated: number;
}

export interface RepoConvention {
  id: string;
  category: 'naming' | 'structure' | 'imports' | 'testing' | 'documentation';
  pattern: string;
  description: string;
  examples: string[];
  confidence: number; // 0-1
}

export interface WorkingMemoryConfig {
  maxNodes: number;
  maxSummaries: number;
  persistencePath?: string;
  autoSaveInterval?: number; // ms
}

const DEFAULT_CONFIG: WorkingMemoryConfig = {
  maxNodes: 5000,
  maxSummaries: 50,
  autoSaveInterval: 30 * 60 * 1000, // 30 minutes
};

export class WorkingMemory extends EventEmitter {
  private nodes: Map<string, DependencyNode>;
  private summaries: Map<string, ArchitectureSummary>;
  private conventions: Map<string, RepoConvention>;
  private config: WorkingMemoryConfig;
  private saveTimer?: NodeJS.Timeout;
  private dirty: boolean = false;

  constructor(config: Partial<WorkingMemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nodes = new Map();
    this.summaries = new Map();
    this.conventions = new Map();
    
    if (this.config.persistencePath) {
      this.load();
      this.startAutoSave();
    }
  }

  // ==================== DEPENDENCY GRAPH ====================

  /**
   * Add or update a dependency node
   */
  addNode(node: DependencyNode): void {
    if (this.nodes.size >= this.config.maxNodes && !this.nodes.has(node.id)) {
      this.evictLeastConnectedNode();
    }
    
    this.nodes.set(node.id, node);
    this.dirty = true;
    this.emit('node-added', { node });
  }

  /**
   * Get node by ID
   */
  getNode(id: string): DependencyNode | null {
    return this.nodes.get(id) || null;
  }

  /**
   * Get all dependencies of a node (recursive)
   */
  getDependencies(id: string, depth: number = -1): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; currentDepth: number }> = [{ id, currentDepth: 0 }];
    
    while (queue.length > 0) {
      const { id: currentId, currentDepth } = queue.shift()!;
      
      if (visited.has(currentId)) continue;
      if (depth >= 0 && currentDepth > depth) continue;
      
      visited.add(currentId);
      
      const node = this.nodes.get(currentId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            queue.push({ id: depId, currentDepth: currentDepth + 1 });
          }
        }
      }
    }
    
    visited.delete(id); // Remove self
    return visited;
  }

  /**
   * Get all dependents of a node (what depends on this)
   */
  getDependents(id: string, depth: number = -1): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; currentDepth: number }> = [{ id, currentDepth: 0 }];
    
    while (queue.length > 0) {
      const { id: currentId, currentDepth } = queue.shift()!;
      
      if (visited.has(currentId)) continue;
      if (depth >= 0 && currentDepth > depth) continue;
      
      visited.add(currentId);
      
      const node = this.nodes.get(currentId);
      if (node) {
        for (const depId of node.dependents) {
          if (!visited.has(depId)) {
            queue.push({ id: depId, currentDepth: currentDepth + 1 });
          }
        }
      }
    }
    
    visited.delete(id); // Remove self
    return visited;
  }

  /**
   * Find impact of changing a file/module
   */
  findImpact(id: string): {
    directDependents: string[];
    transitiveDependents: string[];
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const direct = this.nodes.get(id)?.dependents || [];
    const transitive = Array.from(this.getDependents(id));
    
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (transitive.length > 20) riskLevel = 'high';
    else if (transitive.length > 5) riskLevel = 'medium';
    
    return {
      directDependents: direct,
      transitiveDependents: transitive,
      riskLevel,
    };
  }

  /**
   * Build edge between nodes
   */
  addEdge(fromId: string, toId: string): void {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    
    if (fromNode && !fromNode.dependencies.includes(toId)) {
      fromNode.dependencies.push(toId);
      this.dirty = true;
    }
    
    if (toNode && !toNode.dependents.includes(fromId)) {
      toNode.dependents.push(fromId);
      this.dirty = true;
    }
  }

  /**
   * Remove edge between nodes
   */
  removeEdge(fromId: string, toId: string): void {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    
    if (fromNode) {
      fromNode.dependencies = fromNode.dependencies.filter(d => d !== toId);
      this.dirty = true;
    }
    
    if (toNode) {
      toNode.dependents = toNode.dependents.filter(d => d !== fromId);
      this.dirty = true;
    }
  }

  // ==================== ARCHITECTURE SUMMARIES ====================

  /**
   * Add or update architecture summary
   */
  addSummary(summary: ArchitectureSummary): void {
    if (this.summaries.size >= this.config.maxSummaries && !this.summaries.has(summary.id)) {
      // Remove oldest summary
      const oldest = Array.from(this.summaries.values())
        .sort((a, b) => a.lastUpdated - b.lastUpdated)[0];
      if (oldest) {
        this.summaries.delete(oldest.id);
      }
    }
    
    this.summaries.set(summary.id, summary);
    this.dirty = true;
    this.emit('summary-added', { summary });
  }

  /**
   * Get architecture summary
   */
  getSummary(id: string): ArchitectureSummary | null {
    return this.summaries.get(id) || null;
  }

  /**
   * Get all summaries
   */
  getAllSummaries(): ArchitectureSummary[] {
    return Array.from(this.summaries.values());
  }

  /**
   * Find relevant summaries by keyword
   */
  findSummariesByKeyword(keyword: string): ArchitectureSummary[] {
    const lowerKeyword = keyword.toLowerCase();
    return Array.from(this.summaries.values()).filter(s =>
      s.name.toLowerCase().includes(lowerKeyword) ||
      s.description.toLowerCase().includes(lowerKeyword) ||
      s.layers.some(l => l.toLowerCase().includes(lowerKeyword))
    );
  }

  // ==================== REPO CONVENTIONS ====================

  /**
   * Add or update convention
   */
  addConvention(convention: RepoConvention): void {
    this.conventions.set(convention.id, convention);
    this.dirty = true;
    this.emit('convention-added', { convention });
  }

  /**
   * Get conventions by category
   */
  getConventionsByCategory(category: RepoConvention['category']): RepoConvention[] {
    return Array.from(this.conventions.values())
      .filter(c => c.category === category)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get all conventions
   */
  getAllConventions(): RepoConvention[] {
    return Array.from(this.conventions.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Infer convention from patterns
   */
  inferConvention(
    id: string,
    category: RepoConvention['category'],
    pattern: string,
    description: string,
    examples: string[],
    confidence: number
  ): void {
    const existing = this.conventions.get(id);
    
    // Only update if new confidence is higher or doesn't exist
    if (!existing || confidence > existing.confidence) {
      this.addConvention({
        id,
        category,
        pattern,
        description,
        examples,
        confidence,
      });
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Clear all data
   */
  clear(): void {
    this.nodes.clear();
    this.summaries.clear();
    this.conventions.clear();
    this.dirty = true;
    this.emit('cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalNodes: number;
    totalSummaries: number;
    totalConventions: number;
    avgDependencies: number;
    avgDependents: number;
  } {
    const nodes = Array.from(this.nodes.values());
    const totalDeps = nodes.reduce((sum, n) => sum + n.dependencies.length, 0);
    const totalDependents = nodes.reduce((sum, n) => sum + n.dependents.length, 0);
    
    return {
      totalNodes: nodes.length,
      totalSummaries: this.summaries.size,
      totalConventions: this.conventions.size,
      avgDependencies: nodes.length > 0 ? totalDeps / nodes.length : 0,
      avgDependents: nodes.length > 0 ? totalDependents / nodes.length : 0,
    };
  }

  /**
   * Export state
   */
  export(): unknown {
    return {
      nodes: Array.from(this.nodes.entries()),
      summaries: Array.from(this.summaries.entries()),
      conventions: Array.from(this.conventions.entries()),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import state
   */
  import(state: unknown): void {
    const data = state as {
      nodes: [string, DependencyNode][];
      summaries: [string, ArchitectureSummary][];
      conventions: [string, RepoConvention][];
    };
    
    this.nodes = new Map(data.nodes);
    this.summaries = new Map(data.summaries);
    this.conventions = new Map(data.conventions);
    this.dirty = true;
    this.emit('restored');
  }

  // ==================== PERSISTENCE ====================

  private async load(): Promise<void> {
    if (!this.config.persistencePath) return;
    
    try {
      const content = await fs.readFile(this.config.persistencePath, 'utf-8');
      const data = JSON.parse(content);
      this.import(data);
    } catch (error) {
      // File doesn't exist yet or is corrupted, start fresh
      this.emit('load-error', { error });
    }
  }

  private async save(): Promise<void> {
    if (!this.config.persistencePath || !this.dirty) return;
    
    try {
      const dir = path.dirname(this.config.persistencePath);
      await fs.mkdir(dir, { recursive: true });
      
      const data = this.export();
      await fs.writeFile(this.config.persistencePath, JSON.stringify(data, null, 2));
      this.dirty = false;
      this.emit('saved');
    } catch (error) {
      this.emit('save-error', { error });
    }
  }

  private startAutoSave(): void {
    if (!this.config.autoSaveInterval) return;
    
    this.saveTimer = setInterval(() => {
      this.save();
    }, this.config.autoSaveInterval);
  }

  private evictLeastConnectedNode(): void {
    let minConnections = Infinity;
    let nodeToEvict: string | null = null;
    
    for (const [id, node] of this.nodes) {
      const connections = node.dependencies.length + node.dependents.length;
      if (connections < minConnections) {
        minConnections = connections;
        nodeToEvict = id;
      }
    }
    
    if (nodeToEvict) {
      this.nodes.delete(nodeToEvict);
      this.dirty = true;
    }
  }

  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    this.save(); // Final save
  }
}

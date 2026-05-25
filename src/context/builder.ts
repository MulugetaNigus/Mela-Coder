/**
 * PHASE 1: Minimal Viable Runtime - Context Builder
 * 
 * Dynamically assembles context for the LLM including:
 * - System prompt
 * - Task state
 * - Repo summaries
 * - Active files
 * - Recent tool outputs
 * - Skill overlays
 * - Architecture memory
 * - Retrieved semantic context
 * 
 * Supports context compaction, summarization, token budgeting, and prioritization.
 */

export interface ContextLayer {
  id: string;
  priority: number; // Lower = higher priority (0 = must include)
  content: string;
  tokenCount: number;
  isCompressible: boolean;
  summary?: string;
}

export interface ContextBuilderConfig {
  maxTokens: number;
  systemPrompt: string;
  tokenEstimator?: (text: string) => number;
  compressionThreshold?: number; // When to start compressing (0-1)
}

export interface ContextBuildResult {
  fullContext: string;
  layers: ContextLayer[];
  totalTokens: number;
  compressedLayers: string[];
  discardedLayers: string[];
  warnings: string[];
}

export class ContextBuilder {
  private readonly config: Required<ContextBuilderConfig>;
  private layers: Map<string, ContextLayer> = new Map();
  private layerOrder: string[] = [];

  constructor(config: ContextBuilderConfig) {
    this.config = {
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      tokenEstimator: config.tokenEstimator ?? ((text) => Math.ceil(text.length / 4)),
      compressionThreshold: config.compressionThreshold ?? 0.8,
    };
  }

  /**
   * Add a context layer
   */
  addLayer(id: string, content: string, priority: number, isCompressible: boolean = true): void {
    const tokenCount = this.config.tokenEstimator(content);
    
    const layer: ContextLayer = {
      id,
      priority,
      content,
      tokenCount,
      isCompressible,
    };

    this.layers.set(id, layer);
    
    // Insert in priority order
    const insertIndex = this.layerOrder.findIndex(
      existingId => (this.layers.get(existingId)?.priority ?? Infinity) > priority
    );
    
    if (insertIndex === -1) {
      this.layerOrder.push(id);
    } else {
      this.layerOrder.splice(insertIndex, 0, id);
    }
  }

  /**
   * Update an existing layer
   */
  updateLayer(id: string, content: string): void {
    const existing = this.layers.get(id);
    if (!existing) {
      throw new Error(`Layer ${id} not found`);
    }

    const tokenCount = this.config.tokenEstimator(content);
    existing.content = content;
    existing.tokenCount = tokenCount;
    this.layers.set(id, existing);
  }

  /**
   * Remove a layer
   */
  removeLayer(id: string): void {
    this.layers.delete(id);
    const index = this.layerOrder.indexOf(id);
    if (index !== -1) {
      this.layerOrder.splice(index, 1);
    }
  }

  /**
   * Get a layer by ID
   */
  getLayer(id: string): ContextLayer | undefined {
    return this.layers.get(id);
  }

  /**
   * Clear all layers
   */
  clear(): void {
    this.layers.clear();
    this.layerOrder = [];
  }

  /**
   * Build the final context within token budget
   */
  build(): ContextBuildResult {
    const warnings: string[] = [];
    const compressedLayers: string[] = [];
    const discardedLayers: string[] = [];
    
    // Start with system prompt
    const systemTokens = this.config.tokenEstimator(this.config.systemPrompt);
    let currentTokens = systemTokens;
    const selectedLayers: ContextLayer[] = [];

    // Calculate target budget (leave room for response)
    const targetBudget = Math.floor(this.config.maxTokens * this.config.compressionThreshold);

    // Add layers in priority order until we hit the budget
    for (const layerId of this.layerOrder) {
      const layer = this.layers.get(layerId)!;
      
      if (currentTokens + layer.tokenCount <= targetBudget) {
        selectedLayers.push(layer);
        currentTokens += layer.tokenCount;
      } else if (layer.isCompressible && layer.summary) {
        // Try compressed version
        const summaryTokens = this.config.tokenEstimator(layer.summary);
        if (currentTokens + summaryTokens <= targetBudget) {
          selectedLayers.push({
            ...layer,
            content: layer.summary!,
            tokenCount: summaryTokens,
          });
          currentTokens += summaryTokens;
          compressedLayers.push(layer.id);
          warnings.push(`Layer ${layer.id} was compressed`);
        } else {
          discardedLayers.push(layer.id);
          warnings.push(`Layer ${layer.id} was discarded due to token budget`);
        }
      } else {
        discardedLayers.push(layer.id);
        warnings.push(`Layer ${layer.id} was discarded due to token budget`);
      }
    }

    // Check if we're still over budget
    if (currentTokens > this.config.maxTokens) {
      warnings.push(
        `Context exceeds max tokens (${currentTokens}/${this.config.maxTokens}). ` +
        `Consider reducing system prompt or increasing max tokens.`
      );
    }

    // Build final context string
    const contextParts = [this.config.systemPrompt];
    
    for (const layer of selectedLayers) {
      if (layer.content.trim()) {
        contextParts.push(`\n\n[${layer.id.toUpperCase()}]\n${layer.content}`);
      }
    }

    const fullContext = contextParts.join('\n');
    const totalTokens = this.config.tokenEstimator(fullContext);

    return {
      fullContext,
      layers: selectedLayers,
      totalTokens,
      compressedLayers,
      discardedLayers,
      warnings,
    };
  }

  /**
   * Get current token usage estimate
   */
  getTokenUsage(): { total: number; byLayer: Record<string, number> } {
    const byLayer: Record<string, number> = {};
    let total = this.config.tokenEstimator(this.config.systemPrompt);

    for (const layerId of this.layerOrder) {
      const layer = this.layers.get(layerId)!;
      byLayer[layerId] = layer.tokenCount;
      total += layer.tokenCount;
    }

    return { total, byLayer };
  }

  /**
   * Set a summary for a compressible layer
   */
  setLayerSummary(layerId: string, summary: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer ${layerId} not found`);
    }
    if (!layer.isCompressible) {
      throw new Error(`Layer ${layerId} is not marked as compressible`);
    }
    layer.summary = summary;
    this.layers.set(layerId, layer);
  }

  /**
   * Get statistics about the context
   */
  getStats(): {
    layerCount: number;
    totalTokens: number;
    maxTokens: number;
    utilization: number;
    compressibleLayers: number;
    compressedLayers: number;
  } {
    const usage = this.getTokenUsage();
    const compressible = Array.from(this.layers.values()).filter(l => l.isCompressible).length;
    const compressed = Array.from(this.layers.values()).filter(l => l.summary !== undefined).length;

    return {
      layerCount: this.layers.size,
      totalTokens: usage.total,
      maxTokens: this.config.maxTokens,
      utilization: Math.round((usage.total / this.config.maxTokens) * 100),
      compressibleLayers: compressible,
      compressedLayers: compressed,
    };
  }

  /**
   * Prioritize layers for inclusion (returns ordered list of layer IDs)
   */
  getPriorityOrder(): string[] {
    return [...this.layerOrder];
  }

  /**
   * Compact context by summarizing lower-priority layers
   */
  compact(targetTokens: number): void {
    const usage = this.getTokenUsage();
    
    if (usage.total <= targetTokens) {
      return; // Already within budget
    }

    // Summarize from lowest priority first
    const reversedOrder = [...this.layerOrder].reverse();
    
    for (const layerId of reversedOrder) {
      const layer = this.layers.get(layerId);
      if (!layer || !layer.isCompressible || layer.summary) {
        continue;
      }

      // Create a simple summary (first N characters or first few lines)
      const lines = layer.content.split('\n');
      const summaryLines = lines.slice(0, Math.min(5, lines.length));
      const summary = summaryLines.join('\n') + (lines.length > 5 ? '\n[...compressed...]' : '');
      
      layer.summary = summary;
      this.layers.set(layerId, layer);

      // Check if we're now within budget
      const newUsage = this.getTokenUsage();
      if (newUsage.total <= targetTokens) {
        break;
      }
    }
  }
}

/**
 * Factory function to create a context builder
 */
export function createContextBuilder(config: ContextBuilderConfig): ContextBuilder {
  return new ContextBuilder(config);
}

/**
 * Default token estimator (rough approximation: 1 token ≈ 4 chars)
 */
export function defaultTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}

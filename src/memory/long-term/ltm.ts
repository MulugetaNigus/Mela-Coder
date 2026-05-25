/**
 * Long-Term Memory (LTM) - Vector-based Semantic Memory
 * 
 * Persistent, semantic memory for historical knowledge, patterns, and learned workflows.
 * Uses ChromaDB for vector storage and retrieval.
 * Stores: historical fixes, project knowledge, recurring patterns, learned workflows.
 * Lifecycle: Permanent, persists across all sessions and projects.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ChromaClient, Collection } from 'chromadb';

export interface MemoryDocument {
  id: string;
  content: string;
  metadata: {
    type: 'fix' | 'pattern' | 'workflow' | 'knowledge' | 'decision' | 'architecture';
    project?: string;
    tags?: string[];
    createdAt: number;
    updatedAt?: number;
    confidence?: number;
    source?: string;
    relatedFiles?: string[];
  };
}

export interface SemanticQuery {
  query: string;
  filters?: {
    type?: string;
    project?: string;
    tags?: string[];
    minConfidence?: number;
    maxAge?: number; // ms
  };
  limit?: number;
}

export interface RetrievalResult {
  document: MemoryDocument;
  distance: number;
  relevance: number;
}

export interface LongTermMemoryConfig {
  persistDirectory: string;
  collectionName: string;
  embeddingDimension: number;
  maxResults: number;
}

const DEFAULT_CONFIG: Partial<LongTermMemoryConfig> = {
  collectionName: 'mela-ltm',
  embeddingDimension: 384, // Default for many models
  maxResults: 10,
};

// Simple embedding function (in production, use a real model)
// This is a placeholder - in production you'd use @xenova/transformers or an API
async function generateEmbedding(text: string): Promise<number[]> {
  // Placeholder: In production, use actual embedding model
  // For now, return a simple hash-based vector
  const dimension = 384;
  const vector = new Array(dimension).fill(0);
  
  // Simple hash-based embedding (NOT production quality, just for testing)
  for (let i = 0; i < text.length && i < dimension; i++) {
    vector[i] = (text.charCodeAt(i) % 1000) / 1000;
  }
  
  return vector;
}

export class LongTermMemory extends EventEmitter {
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private config: LongTermMemoryConfig;
  private initialized: boolean = false;
  private documents: Map<string, MemoryDocument>; // Local cache

  constructor(config: Partial<LongTermMemoryConfig> = {}) {
    super();
    this.config = {
      persistDirectory: path.join(process.cwd(), '.mela', 'ltm'),
      ...DEFAULT_CONFIG,
      ...config,
    } as LongTermMemoryConfig;
    
    this.documents = new Map();
  }

  /**
   * Initialize the LTM system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure persist directory exists
      await fs.mkdir(this.config.persistDirectory, { recursive: true });

      // Initialize ChromaDB client
      this.client = new ChromaClient({
        path: 'http://localhost:8000', // ChromaDB server
      });

      // Get or create collection
      try {
        this.collection = await this.client.getCollection({
          name: this.config.collectionName,
        });
      } catch {
        this.collection = await this.client.createCollection({
          name: this.config.collectionName,
          metadata: { 'embedding_function': 'default' },
        });
      }

      this.initialized = true;
      this.emit('initialized');
    } catch (error) {
      // Fallback to in-memory only mode
      this.emit('initialization-warning', { 
        message: 'ChromaDB not available, using in-memory mode',
        error 
      });
      this.initialized = true;
    }
  }

  /**
   * Store a document in long-term memory
   */
  async store(document: MemoryDocument): Promise<void> {
    // Update timestamps
    const now = Date.now();
    if (!document.metadata.createdAt) {
      document.metadata.createdAt = now;
    }
    document.metadata.updatedAt = now;

    // Add to local cache
    this.documents.set(document.id, document);

    // Try to store in ChromaDB
    if (this.collection) {
      try {
        const embedding = await generateEmbedding(document.content);
        
        await this.collection.upsert({
          ids: [document.id],
          embeddings: [embedding],
          metadatas: [{ ...document.metadata }],
          documents: [document.content],
        });

        this.emit('stored', { document });
      } catch (error) {
        this.emit('store-error', { error, document });
      }
    } else {
      this.emit('stored-in-memory', { document });
    }
  }

  /**
   * Query long-term memory semantically
   */
  async query(query: SemanticQuery): Promise<RetrievalResult[]> {
    if (!this.collection || !this.initialized) {
      // Fallback: search local cache with simple text matching
      return this.queryLocalCache(query);
    }

    try {
      const queryEmbedding = await generateEmbedding(query.query);
      
      // Simple filter without complex where clauses to avoid type issues
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: query.limit ?? this.config.maxResults,
        include: ['documents', 'metadatas', 'distances'],
      });

      // Transform results
      const retrievalResults: RetrievalResult[] = [];
      
      if (results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const metadata = results.metadatas?.[0]?.[i] as MemoryDocument['metadata'] | undefined;
          
          // Apply filters manually after retrieval
          if (query.filters) {
            if (query.filters.type && metadata?.type !== query.filters.type) continue;
            if (query.filters.project && metadata?.project !== query.filters.project) continue;
            if (query.filters.minConfidence && (metadata?.confidence || 0) < query.filters.minConfidence) continue;
            if (query.filters.maxAge && metadata?.createdAt && metadata.createdAt < Date.now() - query.filters.maxAge) continue;
          }
          
          const doc: MemoryDocument = {
            id: results.ids[0][i],
            content: results.documents?.[0]?.[i] || '',
            metadata: metadata || { type: 'knowledge', createdAt: Date.now() },
          };
          
          retrievalResults.push({
            document: doc,
            distance: results.distances?.[0]?.[i] || 0,
            relevance: 1 - (results.distances?.[0]?.[i] || 1),
          });
        }
      }

      this.emit('queried', { query, resultCount: retrievalResults.length });
      return retrievalResults;
    } catch (error) {
      this.emit('query-error', { error, query });
      return this.queryLocalCache(query);
    }
  }

  /**
   * Find similar documents to a given text
   */
  async findSimilar(text: string, limit: number = 5): Promise<RetrievalResult[]> {
    return this.query({
      query: text,
      limit,
    });
  }

  /**
   * Store a fix pattern
   */
  async storeFix(fix: {
    problem: string;
    solution: string;
    files?: string[];
    tags?: string[];
    project?: string;
  }): Promise<void> {
    await this.store({
      id: `fix:${Date.now()}:${Buffer.from(fix.problem).toString('base64').slice(0, 16)}`,
      content: `Problem: ${fix.problem}\n\nSolution: ${fix.solution}`,
      metadata: {
        type: 'fix',
        project: fix.project,
        tags: fix.tags || [],
        relatedFiles: fix.files,
        confidence: 0.9,
        createdAt: Date.now(),
      },
    });
  }

  /**
   * Store a pattern
   */
  async storePattern(pattern: {
    name: string;
    description: string;
    example: string;
    tags?: string[];
    project?: string;
  }): Promise<void> {
    await this.store({
      id: `pattern:${Date.now()}:${Buffer.from(pattern.name).toString('base64').slice(0, 16)}`,
      content: `${pattern.name}: ${pattern.description}\n\nExample:\n${pattern.example}`,
      metadata: {
        type: 'pattern',
        project: pattern.project,
        tags: pattern.tags || [],
        confidence: 0.8,
        createdAt: Date.now(),
      },
    });
  }

  /**
   * Store project knowledge
   */
  async storeKnowledge(knowledge: {
    topic: string;
    content: string;
    tags?: string[];
    project: string;
  }): Promise<void> {
    await this.store({
      id: `knowledge:${Date.now()}:${Buffer.from(knowledge.topic).toString('base64').slice(0, 16)}`,
      content: `${knowledge.topic}: ${knowledge.content}`,
      metadata: {
        type: 'knowledge',
        project: knowledge.project,
        tags: knowledge.tags || [],
        confidence: 0.95,
        createdAt: Date.now(),
      },
    });
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<void> {
    this.documents.delete(id);

    if (this.collection) {
      try {
        await this.collection.delete({ ids: [id] });
        this.emit('deleted', { id });
      } catch (error) {
        this.emit('delete-error', { error, id });
      }
    }
  }

  /**
   * Clear all documents (use with caution)
   */
  async clear(): Promise<void> {
    this.documents.clear();

    if (this.collection) {
      try {
        await this.collection.delete({ where: {} });
        this.emit('cleared');
      } catch (error) {
        this.emit('clear-error', { error });
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalDocuments: number;
    byType: Record<string, number>;
    localCacheSize: number;
  } {
    const docs = Array.from(this.documents.values());
    
    return {
      totalDocuments: docs.length,
      byType: {
        fix: docs.filter(d => d.metadata.type === 'fix').length,
        pattern: docs.filter(d => d.metadata.type === 'pattern').length,
        workflow: docs.filter(d => d.metadata.type === 'workflow').length,
        knowledge: docs.filter(d => d.metadata.type === 'knowledge').length,
        decision: docs.filter(d => d.metadata.type === 'decision').length,
        architecture: docs.filter(d => d.metadata.type === 'architecture').length,
      },
      localCacheSize: this.documents.size,
    };
  }

  /**
   * Export all documents
   */
  export(): unknown {
    return {
      documents: Array.from(this.documents.values()),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import documents
   */
  import(data: unknown): void {
    const imported = data as { documents: MemoryDocument[] };
    for (const doc of imported.documents) {
      this.documents.set(doc.id, doc);
    }
    this.emit('imported', { count: imported.documents.length });
  }

  /**
   * Compact old documents (archive low-confidence, old entries)
   */
  async compact(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let compacted = 0;

    for (const [id, doc] of this.documents) {
      if (doc.metadata.createdAt < cutoff && (doc.metadata.confidence || 0) < 0.7) {
        await this.delete(id);
        compacted++;
      }
    }

    this.emit('compacted', { count: compacted });
    return compacted;
  }

  // ==================== PRIVATE METHODS ====================

  private async queryLocalCache(query: SemanticQuery): Promise<RetrievalResult[]> {
    // Simple keyword-based fallback
    const queryLower = query.query.toLowerCase();
    const results: RetrievalResult[] = [];

    for (const [id, doc] of this.documents) {
      // Apply filters
      if (query.filters) {
        if (query.filters.type && doc.metadata.type !== query.filters.type) continue;
        if (query.filters.project && doc.metadata.project !== query.filters.project) continue;
        if (query.filters.minConfidence && (doc.metadata.confidence || 0) < query.filters.minConfidence) continue;
        if (query.filters.maxAge && doc.metadata.createdAt < Date.now() - query.filters.maxAge) continue;
        if (query.filters.tags && !query.filters.tags.some(t => doc.metadata.tags?.includes(t))) continue;
      }

      // Simple relevance scoring
      const contentLower = doc.content.toLowerCase();
      const words = queryLower.split(/\s+/).filter(w => w.length > 2);
      let score = 0;
      
      for (const word of words) {
        if (contentLower.includes(word)) score += 1;
        if (doc.metadata.tags?.some(t => t.toLowerCase().includes(word))) score += 0.5;
      }

      if (score > 0) {
        results.push({
          document: doc,
          distance: 1 - score / words.length,
          relevance: score / words.length,
        });
      }
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, query.limit ?? this.config.maxResults);
  }

  destroy(): void {
    // Cleanup if needed
    this.emit('destroyed');
  }
}

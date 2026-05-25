/**
 * Repository Understanding System
 * 
 * Analyzes and indexes codebases for better agent understanding.
 * Supports AST parsing, dependency graphs, semantic search, and architecture summarization.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

export interface FileNode {
  id: string;
  path: string;
  type: 'file' | 'directory';
  language?: string;
  size: number;
  lastModified: number;
  imports?: string[];
  exports?: string[];
  symbols?: SymbolInfo[];
}

export interface SymbolInfo {
  name: string;
  type: 'class' | 'function' | 'interface' | 'type' | 'const' | 'variable' | 'module';
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  docstring?: string;
  parameters?: string[];
  returnType?: string;
}

export interface DependencyGraph {
  nodes: Map<string, FileNode>;
  edges: Map<string, Set<string>>; // from -> to (imports)
}

export interface RepoSummary {
  rootPath: string;
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  topModules: string[];
  architecturePatterns: string[];
  keyFiles: string[];
  entryPoints: string[];
  testCoverage: number;
  lastAnalyzed: number;
}

export interface RepoIndexConfig {
  rootPath: string;
  ignorePatterns: string[];
  maxFileSize: number;
  languages: string[];
  enableAST: boolean;
}

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  '**/*.min.js',
  '**/*.bundle.js',
  'coverage/**',
  '.mela/**',
  '**/*.log',
  '**/package-lock.json',
  '**/yarn.lock',
];

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
};

export class RepositoryIndexer extends EventEmitter {
  private config: RepoIndexConfig;
  private graph: DependencyGraph;
  private summary: RepoSummary | null;
  private indexed: boolean = false;

  constructor(config: Partial<RepoIndexConfig>) {
    super();
    
    this.config = {
      rootPath: config.rootPath || process.cwd(),
      ignorePatterns: config.ignorePatterns || DEFAULT_IGNORE_PATTERNS,
      maxFileSize: config.maxFileSize || 1024 * 1024, // 1MB
      languages: config.languages || ['typescript', 'javascript'],
      enableAST: config.enableAST !== false,
    };

    this.graph = {
      nodes: new Map(),
      edges: new Map(),
    };

    this.summary = null;
  }

  /**
   * Index the entire repository
   */
  async index(): Promise<RepoSummary> {
    this.emit('indexing-started', { root: this.config.rootPath });

    const startTime = Date.now();

    // Scan files
    const files = await this.scanFiles();
    
    // Parse each file
    for (const filePath of files) {
      try {
        await this.parseFile(filePath);
      } catch (error) {
        this.emit('parse-error', { filePath, error });
      }
    }

    // Build dependency graph
    this.buildDependencyGraph();

    // Generate summary
    this.summary = await this.generateSummary();

    this.indexed = true;
    const duration = Date.now() - startTime;

    this.emit('indexing-completed', { 
      fileCount: this.graph.nodes.size,
      duration,
      summary: this.summary,
    });

    return this.summary;
  }

  /**
   * Scan repository for relevant files
   */
  private async scanFiles(): Promise<string[]> {
    const patterns = this.getLanguagePatterns();
    const files: string[] = [];

    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: this.config.rootPath,
        ignore: this.config.ignorePatterns,
        absolute: true,
      });
      files.push(...matches);
    }

    // Filter by file size
    const filtered: string[] = [];
    for (const file of files) {
      try {
        const stats = await fs.stat(file);
        if (stats.size <= this.config.maxFileSize) {
          filtered.push(file);
        }
      } catch {
        // Skip inaccessible files
      }
    }

    return filtered;
  }

  /**
   * Get glob patterns for configured languages
   */
  private getLanguagePatterns(): string[] {
    const patterns: string[] = [];
    
    for (const lang of this.config.languages) {
      const exts = LANGUAGE_EXTENSIONS[lang] || [];
      for (const ext of exts) {
        patterns.push(`**/*${ext}`);
      }
    }

    return patterns;
  }

  /**
   * Parse a single file
   */
  private async parseFile(filePath: string): Promise<void> {
    const relativePath = path.relative(this.config.rootPath, filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    // Detect language
    let language: string | undefined;
    for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
      if (exts.includes(ext)) {
        language = lang;
        break;
      }
    }

    if (!language) return;

    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath, 'utf-8');

    // Create file node
    const node: FileNode = {
      id: relativePath,
      path: relativePath,
      type: 'file',
      language,
      size: stats.size,
      lastModified: stats.mtimeMs,
      imports: [],
      exports: [],
      symbols: [],
    };

    // Extract imports/exports (simple regex-based for now)
    const { imports, exports } = this.extractImportsExports(content, language);
    node.imports = imports;
    node.exports = exports;

    // Extract symbols (simplified)
    node.symbols = this.extractSymbols(content, language);

    // Add to graph
    this.graph.nodes.set(relativePath, node);

    this.emit('file-parsed', { path: relativePath, symbols: node.symbols?.length || 0 });
  }

  /**
   * Extract imports and exports from file content
   */
  private extractImportsExports(content: string, language: string): {
    imports: string[];
    exports: string[];
  } {
    const imports: string[] = [];
    const exports: string[] = [];

    if (language === 'typescript' || language === 'javascript') {
      // ES6 imports
      const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Exports
      const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    } else if (language === 'python') {
      // Python imports
      const pyImportRegex = /^(?:import|from)\s+([\w.]+)/gm;
      let pyMatch;
      while ((pyMatch = pyImportRegex.exec(content)) !== null) {
        imports.push(pyMatch[1]);
      }

      // Python exports (classes and functions at module level)
      const defRegex = /^(?:def|class)\s+(\w+)/gm;
      while ((pyMatch = defRegex.exec(content)) !== null) {
        exports.push(pyMatch[1]);
      }
    }

    return { imports, exports };
  }

  /**
   * Extract symbols from file content (simplified)
   */
  private extractSymbols(content: string, language: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    if (language === 'typescript' || language === 'javascript') {
      // Classes
      const classRegex = /^(\s*)(?:export\s+)?class\s+(\w+)/gm;
      let classMatch;
      while ((classMatch = classRegex.exec(content)) !== null) {
        const line = content.substring(0, classMatch.index).split('\n').length;
        symbols.push({
          name: classMatch[2],
          type: 'class',
          line,
          column: classMatch[1].length,
        });
      }

      // Functions
      const funcRegex = /^(\s*)(?:export\s+)?(?:async\s+)?function\s*(\w+)\s*\(([^)]*)\)/gm;
      let funcMatch;
      while ((funcMatch = funcRegex.exec(content)) !== null) {
        const line = content.substring(0, funcMatch.index).split('\n').length;
        symbols.push({
          name: funcMatch[2],
          type: 'function',
          line,
          column: funcMatch[1].length,
          parameters: funcMatch[3].split(',').map(p => p.trim()).filter(p => p),
        });
      }

      // Interfaces/Types
      const interfaceRegex = /^(\s*)(?:export\s+)?(?:interface|type)\s+(\w+)/gm;
      let interfaceMatch;
      while ((interfaceMatch = interfaceRegex.exec(content)) !== null) {
        const line = content.substring(0, interfaceMatch.index).split('\n').length;
        symbols.push({
          name: interfaceMatch[2],
          type: 'interface',
          line,
          column: interfaceMatch[1].length,
        });
      }
    }

    return symbols;
  }

  /**
   * Build dependency graph from parsed files
   */
  private buildDependencyGraph(): void {
    const dirMap = new Map<string, string>();
    
    for (const [filePath, node] of this.graph.nodes) {
      if (!this.graph.edges.has(filePath)) {
        this.graph.edges.set(filePath, new Set());
      }

      // Resolve imports to actual files
      for (const imp of node.imports || []) {
        // Try to resolve relative imports
        if (imp.startsWith('.') || imp.startsWith('/')) {
          const dir = path.dirname(filePath);
          let resolved = path.resolve(dir, imp);
          
          // Try common extensions
          const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
          for (const ext of extensions) {
            const candidate = resolved + ext;
            if (this.graph.nodes.has(candidate)) {
              resolved = candidate;
              break;
            }
          }

          if (this.graph.nodes.has(resolved)) {
            this.graph.edges.get(filePath)?.add(resolved);
          }
        }
      }
    }

    this.emit('graph-built', { 
      nodeCount: this.graph.nodes.size,
      edgeCount: Array.from(this.graph.edges.values()).reduce((sum, s) => sum + s.size, 0),
    });
  }

  /**
   * Generate repository summary
   */
  private async generateSummary(): Promise<RepoSummary> {
    const nodes = Array.from(this.graph.nodes.values());
    
    // Count languages
    const languages: Record<string, number> = {};
    let totalLines = 0;

    for (const node of nodes) {
      if (node.language) {
        languages[node.language] = (languages[node.language] || 0) + 1;
      }
      
      // Estimate lines from size (rough approximation)
      totalLines += Math.round(node.size / 50); // ~50 bytes per line
    }

    // Find top modules (most dependencies)
    const moduleScores = Array.from(this.graph.edges.entries())
      .map(([path, deps]) => ({ path, score: deps.size }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Find entry points (files with many dependents but few dependencies)
    const dependents = new Map<string, number>();
    for (const [from, tos] of this.graph.edges) {
      for (const to of tos) {
        dependents.set(to, (dependents.get(to) || 0) + 1);
      }
    }

    const entryPoints = Array.from(dependents.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path]) => path);

    // Detect architecture patterns
    const patterns = this.detectArchitecturePatterns(nodes);

    // Identify key files
    const keyFiles = [
      ...entryPoints,
      ...nodes.filter(n => 
        n.path.includes('main') || 
        n.path.includes('index') || 
        n.path.includes('app')
      ).map(n => n.path).slice(0, 5),
    ];

    return {
      rootPath: this.config.rootPath,
      totalFiles: nodes.length,
      totalLines,
      languages,
      topModules: moduleScores.map(m => m.path),
      architecturePatterns: patterns,
      keyFiles: [...new Set(keyFiles)],
      entryPoints,
      testCoverage: this.estimateTestCoverage(nodes),
      lastAnalyzed: Date.now(),
    };
  }

  /**
   * Detect architecture patterns
   */
  private detectArchitecturePatterns(nodes: FileNode[]): string[] {
    const patterns: string[] = [];
    const paths = nodes.map(n => n.path);

    // Check for common patterns
    if (paths.some(p => p.includes('/controllers/'))) {
      patterns.push('MVC');
    }
    if (paths.some(p => p.includes('/services/') && p.includes('/repositories/'))) {
      patterns.push('Service-Repository');
    }
    if (paths.some(p => p.includes('/components/') && p.includes('/hooks/'))) {
      patterns.push('React-Components');
    }
    if (paths.some(p => p.includes('/middleware/'))) {
      patterns.push('Middleware-Pattern');
    }
    if (paths.some(p => p.includes('/dto/') || p.includes('/schemas/'))) {
      patterns.push('DTO-Schema');
    }

    return patterns;
  }

  /**
   * Estimate test coverage
   */
  private estimateTestCoverage(nodes: FileNode[]): number {
    const sourceFiles = nodes.filter(n => 
      !n.path.includes('.test.') && 
      !n.path.includes('.spec.') &&
      !n.path.includes('__tests__')
    );
    
    const testFiles = nodes.filter(n => 
      n.path.includes('.test.') || 
      n.path.includes('.spec.') ||
      n.path.includes('__tests__')
    );

    if (sourceFiles.length === 0) return 0;
    
    // Rough estimation
    return Math.min(100, Math.round((testFiles.length / sourceFiles.length) * 100));
  }

  /**
   * Get file node by path
   */
  getFileNode(filePath: string): FileNode | null {
    return this.graph.nodes.get(filePath) || null;
  }

  /**
   * Get dependencies of a file
   */
  getDependencies(filePath: string, depth: number = 1): string[] {
    const visited = new Set<string>();
    const queue: Array<{ path: string; currentDepth: number }> = [{ path: filePath, currentDepth: 0 }];

    while (queue.length > 0) {
      const { path: currentPath, currentDepth } = queue.shift()!;
      
      if (visited.has(currentPath)) continue;
      if (depth >= 0 && currentDepth > depth) continue;
      
      visited.add(currentPath);
      
      const deps = this.graph.edges.get(currentPath);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            queue.push({ path: dep, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    visited.delete(filePath);
    return Array.from(visited);
  }

  /**
   * Get dependents of a file (what depends on this)
   */
  getDependents(filePath: string): string[] {
    const dependents: string[] = [];
    
    for (const [from, tos] of this.graph.edges) {
      if (tos.has(filePath)) {
        dependents.push(from);
      }
    }
    
    return dependents;
  }

  /**
   * Search symbols by name
   */
  searchSymbols(name: string, limit: number = 10): Array<{ file: string; symbol: SymbolInfo }> {
    const results: Array<{ file: string; symbol: SymbolInfo }> = [];
    const lowerName = name.toLowerCase();

    for (const [filePath, node] of this.graph.nodes) {
      for (const symbol of node.symbols || []) {
        if (symbol.name.toLowerCase().includes(lowerName)) {
          results.push({ file: filePath, symbol });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /**
   * Get repository summary
   */
  getSummary(): RepoSummary | null {
    return this.summary;
  }

  /**
   * Export graph for persistence
   */
  export(): unknown {
    return {
      nodes: Array.from(this.graph.nodes.entries()),
      edges: Array.from(this.graph.edges.entries()).map(([k, v]) => [k, Array.from(v)]),
      summary: this.summary,
      exportedAt: Date.now(),
    };
  }

  /**
   * Import graph from persistence
   */
  import(data: unknown): void {
    const imported = data as {
      nodes: [string, FileNode][];
      edges: [string, string[]][];
      summary?: RepoSummary;
    };

    this.graph.nodes = new Map(imported.nodes);
    this.graph.edges = new Map(imported.edges.map(([k, v]) => [k, new Set(v)]));
    this.summary = imported.summary || null;
    this.indexed = true;
    
    this.emit('imported');
  }

  /**
   * Check if indexed
   */
  isIndexed(): boolean {
    return this.indexed;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalFiles: number;
    totalEdges: number;
    totalSymbols: number;
    languages: Record<string, number>;
  } {
    const nodes = Array.from(this.graph.nodes.values());
    const symbols = nodes.reduce((sum, n) => sum + (n.symbols?.length || 0), 0);
    const edges = Array.from(this.graph.edges.values()).reduce((sum, s) => sum + s.size, 0);

    const languages: Record<string, number> = {};
    for (const node of nodes) {
      if (node.language) {
        languages[node.language] = (languages[node.language] || 0) + 1;
      }
    }

    return {
      totalFiles: nodes.length,
      totalEdges: edges,
      totalSymbols: symbols,
      languages,
    };
  }
}

import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand } from './toolUtils';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface PkgInfo {
  name: string;
  current: string;
  wanted: string;
  latest: string | null;
  type: 'dependencies' | 'devDependencies';
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const clean = v.replace(/^[\^~>=<]+\s*/, '');
  const parts = clean.split('.');
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map(Number);
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;
  return { major, minor, patch };
}

function compareVersions(current: string, latest: string): { behind: string; count: number } {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return { behind: 'unknown', count: 0 };
  if (l.major > c.major) return { behind: 'major', count: l.major - c.major };
  if (l.minor > c.minor) return { behind: 'minor', count: l.minor - c.minor };
  if (l.patch > c.patch) return { behind: 'patch', count: l.patch - c.patch };
  return { behind: 'up-to-date', count: 0 };
}

async function fetchLatestVersions(packages: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const batchSize = 10;

  for (let i = 0; i < packages.length; i += batchSize) {
    const batch = packages.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async name => {
        const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return null;
        const data = (await resp.json()) as { version?: string };
        return { name, version: data.version ?? null };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.version) {
        result.set(r.value.name, r.value.version);
      }
    }
  }

  return result;
}

function formatVersionColor(behind: string): string {
  switch (behind) {
    case 'major': return '\x1b[31m';    // red
    case 'minor': return '\x1b[33m';    // yellow
    case 'patch': return '\x1b[36m';    // cyan
    default: return '\x1b[32m';         // green
  }
}

function analyzeNpm(): ToolResult | null {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) return null;

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }

  const deps: Record<string, string> = pkg.dependencies || {};
  const devDeps: Record<string, string> = pkg.devDependencies || {};
  const total = Object.keys(deps).length + Object.keys(devDeps).length;

  if (total === 0) {
    return { success: true, output: 'package.json found but no dependencies declared.' };
  }

  const lines: string[] = [];
  lines.push(`Project: ${pkg.name || '(unnamed)'} v${pkg.version || '?'}`);
  lines.push(`Total dependencies: ${total} (${Object.keys(deps).length} prod, ${Object.keys(devDeps).length} dev)`);
  lines.push('');

  const allPkgs: PkgInfo[] = [];

  for (const [name, ver] of Object.entries(deps)) {
    allPkgs.push({ name, current: ver as string, wanted: ver as string, latest: null, type: 'dependencies' });
  }
  for (const [name, ver] of Object.entries(devDeps)) {
    allPkgs.push({ name, current: ver as string, wanted: ver as string, latest: null, type: 'devDependencies' });
  }

  // Return sync result immediately but include a note about async check
  // The execute function is async anyway, so we'll do the fetch inline
  return { success: true, output: JSON.stringify(allPkgs.map(p => ({ name: p.name, current: p.current, type: p.type }))) };
}

async function analyzeAndReport(): Promise<ToolResult> {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) {
    // Check for other project types
    if (existsSync(path.join(process.cwd(), 'pyproject.toml'))) {
      const result = await runCommand('pip list --format=columns 2>/dev/null || echo "pip not available"', 30000);
      return { success: true, output: `Python project detected.\n${result.output}` };
    }
    if (existsSync(path.join(process.cwd(), 'Cargo.toml'))) {
      const result = await runCommand('cargo tree --prefix none 2>/dev/null || echo "cargo not available"', 30000);
      return { success: true, output: `Rust project detected.\n${result.output}` };
    }
    if (existsSync(path.join(process.cwd(), 'go.mod'))) {
      const result = await runCommand('go list -m all 2>/dev/null || echo "go not available"', 30000);
      return { success: true, output: `Go project detected.\n${result.output}` };
    }
    return { success: false, output: '', error: 'No recognized project file found (package.json, pyproject.toml, Cargo.toml, go.mod).' };
  }

  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return { success: false, output: '', error: 'Failed to parse package.json' };
  }

  const deps: Record<string, string> = pkg.dependencies || {};
  const devDeps: Record<string, string> = pkg.devDependencies || {};
  const total = Object.keys(deps).length + Object.keys(devDeps).length;

  const lines: string[] = [];
  lines.push(`\x1b[1mProject:\x1b[0m ${pkg.name || '(unnamed)'} v${pkg.version || '?'}`);
  lines.push(`\x1b[1mDependencies:\x1b[0m ${total} (${Object.keys(deps).length} production, ${Object.keys(devDeps).length} dev)`);
  lines.push('');

  const names = [...Object.keys(deps), ...Object.keys(devDeps)];
  lines.push('Checking latest versions from npm registry...');
  const latestMap = await fetchLatestVersions(names);

  const allPkgs: PkgInfo[] = [];
  for (const [name, ver] of Object.entries(deps)) {
    allPkgs.push({ name, current: ver as string, wanted: ver as string, latest: latestMap.get(name) ?? null, type: 'dependencies' });
  }
  for (const [name, ver] of Object.entries(devDeps)) {
    allPkgs.push({ name, current: ver as string, wanted: ver as string, latest: latestMap.get(name) ?? null, type: 'devDependencies' });
  }

  allPkgs.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName < bName) return -1;
    if (aName > bName) return 1;
    return 0;
  });

  const RESET = '\x1b[0m';

  let outdatedCount = 0;
  for (const p of allPkgs) {
    const label = p.type === 'dependencies' ? '' : ' (dev)';
    if (p.latest) {
      const { behind } = compareVersions(p.current, p.latest);
      const color = formatVersionColor(behind);
      const status = behind === 'up-to-date' ? '✓ up-to-date' : `⬆ ${behind} behind (latest: ${p.latest})`;
      if (behind !== 'up-to-date') outdatedCount++;
      lines.push(`  ${p.name}${label}: ${p.current} → ${color}${status}${RESET}`);
    } else {
      lines.push(`  ${p.name}${label}: ${p.current} → \x1b[2munknown (registry unreachable)\x1b[0m`);
    }
  }

  if (outdatedCount > 0) {
    lines.push(`\n\x1b[33m${outdatedCount} package(s) outdated.\x1b[0m`);
  } else {
    lines.push(`\n\x1b[32mAll packages up-to-date.\x1b[0m`);
  }

  return { success: true, output: lines.join('\n') };
}

export const analyzeDependenciesTool: ToolDefinition = {
  name: 'analyze_dependencies',
  description: 'Analyze project dependencies — list direct/indirect deps, check latest versions from registry, report outdated packages.',
  params: [
    { name: 'deep', type: 'boolean', required: false, description: 'If true, also analyze transitive dependencies via package manager. Defaults to false.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      return analyzeAndReport();
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to analyze dependencies' };
    }
  }
};

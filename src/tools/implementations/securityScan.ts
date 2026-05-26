import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand } from './toolUtils';

interface Finding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file: string;
  line: number;
  message: string;
  snippet: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', 'target']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.eot', '.ttf', '.otf', '.pdf', '.zip', '.tar', '.gz', '.lock']);

interface Pattern {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  message: string;
  regex: RegExp;
}

const SECRET_PATTERNS: Pattern[] = [
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'AWS Access Key ID detected', regex: /AKIA[0-9A-Z]{16}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'AWS Secret Access Key detected', regex: /aws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9\/+]{40}['"]/i },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'GitHub token detected', regex: /ghp_[0-9a-zA-Z]{36}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'GitHub OAuth token detected', regex: /gho_[0-9a-zA-Z]{36}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'GitHub App token detected', regex: /ghu_[0-9a-zA-Z]{36}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'Slack token detected', regex: /xox[abpors]-[0-9a-zA-Z\-]{10,}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'Google API key detected', regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'Heroku API key detected', regex: /heroku.*api.*key\s*[=:]\s*['"][0-9A-F]{8}[-][0-9A-F]{4}[-][0-9A-F]{4}[-][0-9A-F]{4}[-][0-9A-F]{12}['"]/i },
  { severity: 'CRITICAL', category: 'Secret Leak', message: 'Private key block detected', regex: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/ },
  { severity: 'HIGH', category: 'Secret Leak', message: 'Hardcoded password assignment', regex: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{6,}['"]/i },
  { severity: 'HIGH', category: 'Secret Leak', message: 'Hardcoded API key/token assignment', regex: /(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token)\s*[=:]\s*['"][^'"]{8,}['"]/i },
  { severity: 'MEDIUM', category: 'Secret Leak', message: 'Connection string containing credentials', regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/ },
  { severity: 'MEDIUM', category: 'Secret Leak', message: 'Database URL with credentials', regex: /(?:postgres|mysql|redis):\/\/[^:]+:[^@]+@/ },
];

const DANGEROUS_PATTERNS: Pattern[] = [
  { severity: 'HIGH', category: 'Dangerous API', message: 'eval() usage - potential code injection', regex: /\beval\s*\(/ },
  { severity: 'HIGH', category: 'Dangerous API', message: 'Function() constructor - potential code injection', regex: /new\s+Function\s*\(/ },
  { severity: 'HIGH', category: 'Dangerous API', message: 'exec() with string argument', regex: /child_process\.exec\s*\(/ },
  { severity: 'HIGH', category: 'Dangerous API', message: 'spawn() with shell:true - potential injection', regex: /spawn\s*\([^)]*shell\s*:\s*true/ },
  { severity: 'MEDIUM', category: 'Dangerous API', message: 'innerHTML assignment - XSS risk', regex: /\.innerHTML\s*=/ },
  { severity: 'MEDIUM', category: 'Dangerous API', message: 'dangerouslySetInnerHTML usage', regex: /dangerouslySetInnerHTML/ },
  { severity: 'LOW', category: 'Dangerous API', message: 'setTimeout with string argument', regex: /setTimeout\s*\(\s*['"`]/ },
  { severity: 'LOW', category: 'Dangerous API', message: 'setInterval with string argument', regex: /setInterval\s*\(\s*['"`]/ },
  { severity: 'MEDIUM', category: 'Dangerous API', message: 'localStorage for sensitive data', regex: /localStorage\.\w+\s*\(/ },
  { severity: 'MEDIUM', category: 'Dangerous API', message: 'document.write usage', regex: /document\.write\s*\(/ },
];

const SQL_PATTERNS: Pattern[] = [
  { severity: 'HIGH', category: 'SQL Injection', message: 'Raw SQL query with string concatenation', regex: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER).*(?:\+|\$\{|%s)/i },
  { severity: 'MEDIUM', category: 'SQL Injection', message: 'execute() with concatenated query', regex: /\.execute\s*\(\s*(?:['"`]|.*\+)/ },
  { severity: 'MEDIUM', category: 'SQL Injection', message: 'query() with concatenated string', regex: /\.query\s*\(\s*(?:['"`]|.*\+)/ },
];

const CONFIG_PATTERNS: Pattern[] = [
  { severity: 'LOW', category: 'Hardcoded Config', message: 'Hardcoded IP address', regex: /(?:host|ip|address|server)\s*[=:]\s*['"]\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}['"]/i },
  { severity: 'LOW', category: 'Hardcoded Config', message: 'Hardcoded port number', regex: /(?:port)\s*[=:]\s*\d{4,5}\b/i },
  { severity: 'LOW', category: 'Hardcoded Config', message: 'Hardcoded secret in config', regex: /(?:secret|salt|pepper)\s*[=:]\s*['"][A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]{8,}['"]/i },
];

const ALL_PATTERNS = [...SECRET_PATTERNS, ...DANGEROUS_PATTERNS, ...SQL_PATTERNS, ...CONFIG_PATTERNS];

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

async function scanFile(filePath: string, relativePath: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const pattern of ALL_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({
          severity: pattern.severity,
          category: pattern.category,
          file: relativePath,
          line: lineIdx + 1,
          message: pattern.message,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }

  return findings;
}

async function npmAudit(): Promise<string | null> {
  const result = await runCommand('npm audit --json 2>/dev/null', 60000);
  if (!result.success) return null;
  try {
    const data = JSON.parse(result.output);
    const vulns = data.vulnerabilities;
    if (!vulns) return null;
    const entries = Object.entries(vulns as Record<string, any>)
      .filter(([, v]) => v.severity)
      .map(([name, v]) => `  ${v.severity.toUpperCase().padEnd(8)} ${name}@${v.via?.[0]?.source || 'unknown'} — ${v.range}`)
      .slice(0, 30);
    return entries.length > 0 ? `npm audit findings:\n${entries.join('\n')}` : null;
  } catch {
    return null;
  }
}

async function walkAndScan(root: string): Promise<Finding[]> {
  const all: Finding[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SKIP_EXT.has(ext)) continue;
        try {
          const findings = await scanFile(fullPath, relativePath);
          all.push(...findings);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(root);
  return all;
}

export const securityScanTool: ToolDefinition = {
  name: 'security_scan',
  description: 'Scan the project for security vulnerabilities: leaked secrets, dangerous APIs, SQL injection patterns, hardcoded configs, and dependency vulnerabilities.',
  params: [
    { name: 'depth', type: 'string', required: false, description: 'Scan scope: "quick" (source only), "full" (source + npm audit). Defaults to "quick".' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const depth = typeof params.depth === 'string' ? params.depth : 'quick';
      const findings = await walkAndScan(process.cwd());

      let npmFindings: string | null = null;
      if (depth === 'full') {
        npmFindings = await npmAudit();
      }

      if (findings.length === 0 && !npmFindings) {
        return { success: true, output: 'No security issues found.' };
      }

      findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));

      const lines: string[] = [];

      if (findings.length > 0) {
        const severityColors: Record<string, string> = {
          CRITICAL: '\x1b[31mCRITICAL\x1b[0m',
          HIGH: '\x1b[33mHIGH\x1b[0m',
          MEDIUM: '\x1b[36mMEDIUM\x1b[0m',
          LOW: '\x1b[2mLOW\x1b[0m',
        };

        for (const f of findings) {
          const sev = severityColors[f.severity] || f.severity;
          lines.push(`${sev}  ${f.file}:${f.line}`);
          lines.push(`     ${f.category}: ${f.message}`);
          lines.push(`     ${f.snippet}`);
          lines.push('');
        }
      }

      if (npmFindings) {
        lines.push('---');
        lines.push(npmFindings);
      }

      lines.push(`\nTotal: ${findings.length} issue(s) found in source.${npmFindings ? ' + npm audit results above.' : ''}`);

      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to run security scan' };
    }
  }
};

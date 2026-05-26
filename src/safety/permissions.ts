import readline from 'node:readline';
import { Renderer } from '../cli/renderer';

export enum PermissionTier {
  READ = 0,
  WRITE_LOCAL = 1,
  WRITE_REMOTE = 2,
  DESTRUCTIVE = 3,
}

export interface GateConfig {
  autoAllow?: PermissionTier;
  allowAll?: boolean;
  readOnly?: boolean;
}

const DESTRUCTIVE_BASH = [
  /rm\s+-rf\s+\//,
  /sudo\s+rm/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\{\s*:\|:&\s*\};:/, // Fork bomb
  /rm\s+-rf\s+(?:\$HOME|~|\*|\.\.)/,
  /\bshred\b/,
  /\bwipe\b/
];

const WRITE_REMOTE_BASH = [
  /\b(git push|docker push|npm publish|yarn publish|pnpm publish)\b/,
  /\b(curl\b.*\b-(?:X\s*POST|d|F|u|H)|wget\b.*\b--post-data)\b/i,
  /\b(ssh|rsync|sftp|ftp|scp)\b/i
];

const WRITE_LOCAL_BASH = [
  /\b(mkdir|touch|cp|mv|rm|git commit|git add|npm install|yarn add|pnpm add|npm run|yarn run|pnpm run|npx|pip install|cargo add|npm init)\b/
];

export function classifyBashCommand(cmd: string): PermissionTier {
  if (DESTRUCTIVE_BASH.some(p => p.test(cmd))) {
    return PermissionTier.DESTRUCTIVE;
  }
  if (WRITE_REMOTE_BASH.some(p => p.test(cmd))) {
    return PermissionTier.WRITE_REMOTE;
  }
  if (WRITE_LOCAL_BASH.some(p => p.test(cmd))) {
    return PermissionTier.WRITE_LOCAL;
  }
  return PermissionTier.READ;
}

export function classifyToolCall(toolName: string, params: Record<string, unknown>): PermissionTier {
  if (toolName === 'execute_bash' || toolName === 'run_cmd') {
    const cmd = String(params.cmd ?? params.command ?? '');
    return classifyBashCommand(cmd);
  }

  if (toolName === 'delete_file') {
    return PermissionTier.DESTRUCTIVE;
  }

  if (
    ['write_file', 'edit_file', 'str_replace', 'copy_file', 'rename_file', 'make_dir'].includes(toolName)
  ) {
    return PermissionTier.WRITE_LOCAL;
  }

  return PermissionTier.READ;
}

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export class PermissionGate {
  private cache = new Map<string, 'allow' | 'allow-always'>();
  private readonly config: Required<GateConfig>;

  constructor(config: GateConfig = {}) {
    this.config = {
      autoAllow: config.autoAllow ?? PermissionTier.WRITE_LOCAL,
      allowAll: config.allowAll ?? false,
      readOnly: config.readOnly ?? false,
    };
  }

  async check(tier: PermissionTier, cmdPreview: string): Promise<boolean> {
    if (this.config.allowAll) {
      return true;
    }

    if (this.config.readOnly && tier > PermissionTier.READ) {
      process.stdout.write(`\n${red('  ✗ Read-only mode active. Blocked modifications:')} ${cmdPreview}\n`);
      return false;
    }

    if (tier <= this.config.autoAllow) {
      return true;
    }

    const key = `${tier}:${cmdPreview}`;
    const cached = this.cache.get(key);
    if (cached === 'allow-always') return true;
    if (cached === 'allow') {
      this.cache.set(key, 'allow-always');
      return true;
    }

    const answer = await this.prompt(tier, cmdPreview);

    if (answer === 'aa') {
      this.cache.set(key, 'allow-always');
      return true;
    }
    if (answer === 'a' || answer === '') {
      this.cache.set(key, 'allow');
      return true;
    }
    return false;
  }

  private async prompt(tier: PermissionTier, cmdPreview: string): Promise<string> {
    Renderer.stopActiveSpinner();
    const options = ['Allow', 'Allow Always', 'Deny'];
    let selectedIndex = 0;

    const border = yellow('═'.repeat(50));
    process.stdout.write(`\n${border}\n`);
    process.stdout.write(`${bold(yellow('  ⚠ Security Gate Permission Required'))}\n\n`);
    process.stdout.write(`  Tier: ${bold(this.getTierName(tier))}\n`);
    process.stdout.write(`  Action: ${cyan(cmdPreview)}\n\n`);

    const renderOptions = () => {
      const rendered = options.map((opt, idx) => {
        if (idx === selectedIndex) {
          return `\x1b[7m\x1b[1m\x1b[33m[ ${opt} ]\x1b[0m`;
        } else {
          return `\x1b[2m  ${opt}  \x1b[0m`;
        }
      }).join('   ');
      process.stdout.write(`\r\x1b[K  ${rendered}`);
    };

    renderOptions();

    return new Promise<string>(resolve => {
      const wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const handleKey = (chunk: Buffer) => {
        const key = chunk.toString();

        if (key === '\u0003') {
          process.stdin.setRawMode(wasRaw);
          process.stdin.removeListener('data', handleKey);
          process.stdout.write('\n');
          process.exit(130);
        }

        if (key === '\r' || key === '\n') {
          process.stdin.setRawMode(wasRaw);
          process.stdin.removeListener('data', handleKey);
          process.stdout.write('\n\n');
          const choice = options[selectedIndex];
          Renderer.startActiveSpinner();
          if (choice === 'Allow Always') resolve('aa');
          if (choice === 'Deny') resolve('d');
          resolve('a');
          return;
        }

        if (key === '\u001b[C' || key === '\t') {
          selectedIndex = (selectedIndex + 1) % options.length;
          renderOptions();
        } else if (key === '\u001b[D') {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          renderOptions();
        }

        const lowerKey = key.toLowerCase();
        if (lowerKey === 'a') {
          selectedIndex = 0;
          renderOptions();
        } else if (lowerKey === 'd') {
          selectedIndex = 2;
          renderOptions();
        }
      };

      process.stdin.on('data', handleKey);
    });
  }

  private getTierName(tier: PermissionTier): string {
    switch (tier) {
      case PermissionTier.READ: return green('READ');
      case PermissionTier.WRITE_LOCAL: return cyan('WRITE_LOCAL');
      case PermissionTier.WRITE_REMOTE: return yellow('WRITE_REMOTE');
      case PermissionTier.DESTRUCTIVE: return red('DESTRUCTIVE');
      default: return 'UNKNOWN';
    }
  }
}

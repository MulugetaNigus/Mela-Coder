import readline from 'node:readline';

type PermissionLevel = 'allow' | 'allow-always';

const DESTRUCTIVE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'str_replace',
  'delete_file',
  'rename_file',
]);

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export class PermissionManager {
  private cache = new Map<string, PermissionLevel>();

  isDestructive(toolName: string): boolean {
    return DESTRUCTIVE_TOOLS.has(toolName);
  }

  async require(toolName: string, description: string): Promise<boolean> {
    const key = `${toolName}:${description}`;
    const cached = this.cache.get(key);
    if (cached === 'allow-always') return true;
    if (cached === 'allow') {
      this.cache.set(key, 'allow-always');
      return true;
    }

    const answer = await this.prompt(toolName, description);

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

  private async prompt(toolName: string, description: string): Promise<string> {
    return new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const border = yellow('═'.repeat(50));
      process.stdout.write(`\n${border}\n`);
      process.stdout.write(`${bold(yellow('  ⚠ Permission Required'))}\n\n`);
      process.stdout.write(`  ${cyan(toolName)} → ${description}\n\n`);
      process.stdout.write(`  ${dim('[A] Allow    [AA] Allow Always    [D] Deny')}\n`);
      process.stdout.write(`${bold(yellow('  ──'))} `);
      rl.once('line', line => {
        rl.close();
        resolve(line.trim().toLowerCase());
      });
    });
  }
}

export const permissionManager = new PermissionManager();

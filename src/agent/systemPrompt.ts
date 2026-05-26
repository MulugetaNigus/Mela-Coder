import * as os from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import type { ToolRegistry } from '../tools/registry';

function detectWorkspaceHints(): string[] {
  const hints: string[] = [];
  const checks: Array<[string, string]> = [
    ['package.json',      'Node.js/JavaScript/TypeScript project'],
    ['tsconfig.json',     'TypeScript configuration present'],
    ['pyproject.toml',    'Python project'],
    ['requirements.txt',  'Python requirements present'],
    ['Cargo.toml',        'Rust project'],
    ['go.mod',            'Go project'],
    ['pom.xml',           'Java Maven project'],
    ['build.gradle',      'Java/Gradle project'],
    ['Gemfile',           'Ruby project'],
    ['composer.json',     'PHP project'],
    ['Makefile',          'Makefile present'],
    ['Dockerfile',        'Docker configuration present'],
    ['.env.example',      'Environment config template present'],
    ['README.md',         'README present'],
    ['tailwind.config.ts', 'Tailwind CSS project'],
    ['tailwind.config.js', 'Tailwind CSS project'],
    ['.storybook',        'Storybook component library present'],
    ['tokens.json',       'Design tokens file present'],
    ['theme.ts',          'Theme file present'],
    ['globals.css',       'Global CSS present'],
    ['components/ui',     'shadcn/ui or component library present'],
  ];

  for (const [file, hint] of checks) {
    if (existsSync(file)) hints.push(hint);
  }

  try {
    const dirs = readdirSync('.', { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => !['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target'].includes(name))
      .slice(0, 10);
    if (dirs.length) hints.push(`Top-level directories: ${dirs.join(', ')}`);
  } catch {
    // Workspace hints are optional.
  }

  return hints;
}

export interface SystemPromptResult {
  coreIdentity: string;
  toolSchema: string;
  workspaceHints: string;
  full: string;
}

export function buildSystemPrompt(
  registry: ToolRegistry,
  projectMemory?: string | null,
  activeSkills?: string[]
): SystemPromptResult {
  const workspaceHintsList = detectWorkspaceHints();

const coreIdentity = `You are Mela-Coder, a CLI coding agent. Execute tasks correctly, safely, and efficiently.

PRINCIPLES
- Correctness over agreement
- Truth over speed
- Root-cause fixes over symptom patches
- Concise, factual, operational communication
- Never invent results or claim success without verification
- Always respond in English

EXECUTION
1. Read relevant files first
2. Understand existing behavior
3. Verify assumptions against code, tests, and logs
4. Make minimal correct changes
5. Verify outcomes (typecheck, lint, tests)
6. Report results

TOOL SELECTION RULES
- ALWAYS use write_file to create files — never use touch, echo, or cat via execute_bash
- If the user asks to create a file but does NOT specify any content to go inside it, call write_file with an empty string ("") as the content parameter. Do NOT write unsolicited boilerplate, HTML tags, or placeholders.
- ALWAYS use read_file to read files — never use cat via execute_bash
- ALWAYS use delete_file to delete files — never use rm via execute_bash
- ALWAYS use list_dir to list directories — never use ls via execute_bash
- Use execute_bash ONLY for: running builds, tests, linters, git commands, package managers, and interactive programs
- For file edits, prefer edit_file or str_replace over rewriting the full file with write_file

RESPONSE FORMAT
- You MUST call exactly one tool per response, OR provide a text answer
- Do NOT output multiple tool call blocks in the same response
- After calling a tool, WAIT for the result before calling another tool
- Do NOT mix long explanations with tool calls in the same response

ERROR HANDLING
- If a tool call fails, analyze the error and try a DIFFERENT approach
- NEVER retry the exact same tool call with identical parameters
- If permission is denied ([BLOCKED]), inform the user and STOP retrying that action
- If you receive "Unknown tool", the tool name was wrong — check the registry and use a valid name

COMPLETION
- When the task is fully complete, you MUST end your final response with [done]
- Do NOT continue generating after [done]
- If you cannot complete the task, explain why and end with [done]

VALIDATION
- Validate user claims against evidence
- If user is wrong, say so and explain why
- Prefer simpler solutions
- Check: root cause, architectural soundness, breaking changes

CODING
- Write minimum correct code
- Match repository style and patterns
- Touch only what's necessary
- Avoid speculative abstractions
- DO NOT write unsolicited boilerplate, placeholders, or code inside files if the user only requested creating/touching the file without specifying content. Create files empty or with the exact minimum content requested.

VERIFY
- TypeScript: tsc --noEmit
- Python: mypy / pytest
- Rust: cargo check / cargo test
- Go: go build / go test
- Never say "should work" or "probably fixed"`;

const toolSchema = `--- TOOL CALLS ---
\`\`\`tool_name
value
\`\`\`

Examples:
\`\`\`read_file
src/index.ts
\`\`\`

\`\`\`write_file
src/output.js
file content here
\`\`\`

\`\`\`execute_bash
npm test
\`\`\`

\`\`\`edit_file
src/component.ts
---OLD---
<div className="old">
---NEW---
<div className="new">
\`\`\`

\`\`\`glob
*.ts
src/
\`\`\`

\`\`\`list_dir
.
\`\`\`

\`\`\`search_files
TODO
src/
\`\`\`

--- TOOL REGISTRY ---
${registry.toSystemPromptSchema()}`;

  let workspaceHints = `WORKSPACE
Working directory: ${process.cwd()}
OS: ${os.platform()}
Shell: ${process.env.SHELL ?? process.env.ComSpec ?? 'unknown'}
Detected: ${workspaceHintsList.length > 0 ? workspaceHintsList.join('; ') : 'none'}`;

  if (projectMemory) {
    workspaceHints += `\n\n--- PROJECT MEMORY ---\n${projectMemory}`;
  }

  let full = `${coreIdentity}

${toolSchema}

${workspaceHints}`;

  if (activeSkills && activeSkills.length > 0) {
    full += `\n\n--- ACTIVE SKILLS ---\n${activeSkills.join('\n\n')}`;
  }

  return {
    coreIdentity,
    toolSchema,
    workspaceHints,
    full,
  };
}

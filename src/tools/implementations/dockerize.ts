import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand, pathExists } from './toolUtils';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface ProjectProfile {
  language: string;
  baseImage: string;
  buildImage: string;
  buildCmd: string[];
  runCmd: string[];
  workdir: string;
  expose: number;
  ignorePatterns: string[];
  installCmd: string[];
  buildArtifact: string;
  preBuildCopy: string[];
}

function detectProjectProfile(): ProjectProfile {
  const pkg = tryRead('package.json');
  if (pkg) {
    const isNext = pkg.dependencies?.next || pkg.devDependencies?.next;
    return {
      language: 'node',
      baseImage: 'node:20-alpine',
      buildImage: 'node:20-alpine',
      buildCmd: ['npm ci', 'npm run build'],
      runCmd: isNext ? ['npx next start -p ${PORT:-3000}'] : ['node', 'dist/index.js'],
      workdir: '/app',
      expose: isNext ? 3000 : 3000,
      ignorePatterns: ['node_modules', 'dist', '.next', 'coverage', '.git'],
      installCmd: ['npm ci --omit=dev'],
      buildArtifact: isNext ? '.next' : 'dist',
      preBuildCopy: ['package*.json', '.'],
    };
  }

  const pyproject = tryReadToml('pyproject.toml');
  if (pyproject) {
    const projectSection = pyproject['project'] as Record<string, any> | undefined;
    const moduleName = projectSection?.name || 'app';
    return {
      language: 'python',
      baseImage: 'python:3.12-slim',
      buildImage: 'python:3.12-slim',
      buildCmd: ['pip install .'],
      runCmd: ['python', '-m', moduleName],
      workdir: '/app',
      expose: 8000,
      ignorePatterns: ['__pycache__', '*.pyc', '.venv', '.git', 'dist'],
      installCmd: ['pip install --no-cache-dir .'],
      buildArtifact: 'dist',
      preBuildCopy: ['pyproject.toml', 'requirements.txt', '.'],
    };
  }

  const reqs = tryReadBytes('requirements.txt');
  if (reqs) {
    return {
      language: 'python',
      baseImage: 'python:3.12-slim',
      buildImage: 'python:3.12-slim',
      buildCmd: [],
      runCmd: ['python', 'main.py'],
      workdir: '/app',
      expose: 8000,
      ignorePatterns: ['__pycache__', '*.pyc', '.venv', '.git'],
      installCmd: ['pip install --no-cache-dir -r requirements.txt'],
      buildArtifact: '',
      preBuildCopy: ['requirements.txt', '.'],
    };
  }

  const cargo = tryReadToml('Cargo.toml');
  if (cargo) {
    const packageSection = cargo['package'] as Record<string, any> | undefined;
    const crateName = packageSection?.name || 'app';
    return {
      language: 'rust',
      baseImage: 'gcr.io/distroless/cc-debian12',
      buildImage: 'rust:1.85-slim-bookworm',
      buildCmd: ['cargo build --release'],
      runCmd: ['./target/release/' + crateName],
      workdir: '/app',
      expose: 8080,
      ignorePatterns: ['target', '.git'],
      installCmd: [],
      buildArtifact: 'target/release',
      preBuildCopy: ['Cargo.toml', 'Cargo.lock', '.'],
    };
  }

  const gomod = tryRead('go.mod');
  if (gomod) {
    return {
      language: 'go',
      baseImage: 'gcr.io/distroless/base-debian12',
      buildImage: 'golang:1.23-alpine',
      buildCmd: ['CGO_ENABLED=0 go build -o /app/server .'],
      runCmd: ['/app/server'],
      workdir: '/app',
      expose: 8080,
      ignorePatterns: ['.git'],
      installCmd: [],
      buildArtifact: '/app/server',
      preBuildCopy: ['go.mod', 'go.sum', '.'],
    };
  }

  return {
    language: 'generic',
    baseImage: 'alpine:3.20',
    buildImage: 'alpine:3.20',
    buildCmd: [],
    runCmd: [],
    workdir: '/app',
    expose: 8080,
    ignorePatterns: ['.git'],
    installCmd: [],
    buildArtifact: '',
    preBuildCopy: ['.'],
  };
}

function tryRead(filename: string): Record<string, any> | null {
  try {
    return JSON.parse(require('node:fs').readFileSync(path.join(process.cwd(), filename), 'utf8'));
  } catch {
    return null;
  }
}

function tryReadBytes(filename: string): boolean {
  try {
    const { existsSync } = require('node:fs');
    return existsSync(path.join(process.cwd(), filename));
  } catch {
    return false;
  }
}

function tryReadToml(filename: string): Record<string, any> | null {
  try {
    const raw = require('node:fs').readFileSync(path.join(process.cwd(), filename), 'utf8');
    const result: Record<string, any> = {};
    let currentSection: string | null = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1).trim();
        result[currentSection as string] = result[currentSection as string] || {};
      } else if (trimmed.includes('=') && currentSection) {
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
        (result[currentSection] as Record<string, any>)[key] = value;
      }
    }
    return result;
  } catch {
    return null;
  }
}

function generateDockerfile(profile: ProjectProfile): string {
  const lines: string[] = [];
  lines.push(`# syntax=docker/dockerfile:1`);
  lines.push(`FROM ${profile.buildImage} AS builder`);
  lines.push(`WORKDIR ${profile.workdir}`);
  lines.push(``);

  if (profile.preBuildCopy.length > 0) {
    for (const src of profile.preBuildCopy) {
      lines.push(`COPY ${src} ./`);
    }
    lines.push(``);
  } else {
    lines.push(`COPY . .`);
    lines.push(``);
  }

  for (const cmd of profile.installCmd) {
    lines.push(`RUN ${cmd}`);
    lines.push(``);
  }

  for (const cmd of profile.buildCmd) {
    lines.push(`RUN ${cmd}`);
    lines.push(``);
  }

  lines.push(`FROM ${profile.baseImage} AS production`);
  lines.push(`WORKDIR ${profile.workdir}`);
  lines.push(``);

  if (profile.language === 'node') {
    lines.push(`COPY --from=builder ${profile.workdir}/node_modules ./node_modules`);
    if (profile.buildArtifact) {
      lines.push(`COPY --from=builder ${profile.workdir}/${profile.buildArtifact} ./${profile.buildArtifact}`);
    }
    lines.push(`COPY --from=builder ${profile.workdir}/package*.json ./`);
  } else if (profile.language === 'python') {
    lines.push(`COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages`);
    lines.push(`COPY --from=builder ${profile.workdir} .`);
  } else if (profile.language === 'rust' || profile.language === 'go') {
    lines.push(`COPY --from=builder ${profile.buildArtifact} ${profile.buildArtifact}`);
  } else {
    lines.push(`COPY --from=builder ${profile.workdir} .`);
  }

  lines.push(``);

  if (profile.runCmd.length > 0) {
    lines.push(`EXPOSE ${profile.expose}`);
    lines.push(`CMD [${profile.runCmd.map(c => JSON.stringify(c)).join(', ')}]`);
  }

  return lines.join('\n');
}

function generateDockerignore(profile: ProjectProfile): string {
  const lines = profile.ignorePatterns.map(p => `${p}/`);
  lines.push('Dockerfile');
  lines.push('.dockerignore');
  lines.push('.env');
  lines.push('.git');
  return lines.join('\n');
}

async function dockerizeBuild(): Promise<ToolResult> {
  const profile = detectProjectProfile();

  const dockerfile = generateDockerfile(profile);
  const dockerignore = generateDockerignore(profile);

  await fs.writeFile(path.join(process.cwd(), 'Dockerfile'), dockerfile, 'utf8');
  await fs.writeFile(path.join(process.cwd(), '.dockerignore'), dockerignore, 'utf8');

  const message = [
    `Detected project type: ${profile.language}`,
    `Generated Dockerfile and .dockerignore`,
    ``,
    dockerfile,
    ``,
    `To build: docker build -t <name> .`,
    `To run:   docker run -p ${profile.expose}:${profile.expose} <name>`,
  ];

  const hasDocker = await runCommand('which docker 2>/dev/null && docker --version', 15000);
  const dockerAvailable = hasDocker.success;

  if (dockerAvailable) {
    const build = await runCommand('docker build -t mela-temp-build . 2>&1', 120000);
    if (build.success) {
      message.push(`\n✓ Docker build succeeded.`);
    } else {
      message.push(`\n⚠ Docker build failed:\n${build.output}`);
    }
  } else {
    message.push(`\n⚠ Docker not available on this machine. Install Docker and run the build command manually.`);
  }

  return {
    success: true,
    output: message.join('\n'),
  };
}

export const dockerizeTool: ToolDefinition = {
  name: 'dockerize',
  description: 'Analyze the project and generate a production-ready multi-stage Dockerfile with .dockerignore. Optionally runs a test build.',
  params: [
    { name: 'runBuild', type: 'boolean', required: false, description: 'If true, runs docker build to verify. Defaults to true.' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      return dockerizeBuild();
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Failed to dockerize project' };
    }
  }
};

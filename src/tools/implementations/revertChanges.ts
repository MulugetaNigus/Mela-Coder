import type { ToolDefinition, ToolResult } from '../registry';
import { runCommand } from './toolUtils';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SNAPSHOTS_DIR = path.join(process.cwd(), '.mela-snapshots');

interface SnapshotMeta {
  name: string;
  description: string;
  timestamp: number;
  files: string[];
}

function ensureSnapshotsDir(): void {
  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 100);
}

function metaPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${sanitizeName(name)}.json`);
}

function patchPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${sanitizeName(name)}.patch`);
}

function stagedPatchPath(name: string): string {
  return path.join(SNAPSHOTS_DIR, `${sanitizeName(name)}_staged.patch`);
}

async function createSnapshot(name: string, description: string): Promise<ToolResult> {
  ensureSnapshotsDir();
  const safe = sanitizeName(name);

  const staged = await runCommand('git diff --cached', 15000);
  const unstaged = await runCommand('git diff', 15000);
  const fileList = await runCommand('git diff --name-only', 15000);
  const stagedFiles = await runCommand('git diff --cached --name-only', 15000);

  writeFileSync(stagedPatchPath(safe), staged.output);
  writeFileSync(patchPath(safe), unstaged.output);

  const files = [
    ...(stagedFiles.output ? stagedFiles.output.split('\n').filter(Boolean) : []),
    ...(fileList.output ? fileList.output.split('\n').filter(Boolean) : []),
  ];

  const meta: SnapshotMeta = {
    name: safe,
    description: description || 'No description',
    timestamp: Date.now(),
    files: [...new Set(files)],
  };

  writeFileSync(metaPath(safe), JSON.stringify(meta, null, 2));

  const fileCount = meta.files.length;
  return {
    success: true,
    output: `Snapshot "${safe}" created. ${fileCount} file(s) tracked.`,
  };
}

function listSnapshots(): ToolResult {
  ensureSnapshotsDir();
  const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter(e => e.name.endsWith('.json'))
    .map(e => {
      try {
        const meta: SnapshotMeta = JSON.parse(readFileSync(path.join(SNAPSHOTS_DIR, e.name), 'utf8'));
        return meta;
      } catch {
        return null;
      }
    })
    .filter((m): m is SnapshotMeta => m !== null)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (entries.length === 0) {
    return { success: true, output: 'No snapshots found.' };
  }

  const lines = entries.map(m => {
    const date = new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19);
    return `  ${m.name.padEnd(30)} ${date}  (${m.files.length} files)  ${m.description}`;
  });

  return { success: true, output: `Snapshots:\n${lines.join('\n')}` };
}

async function revertToSnapshot(name: string): Promise<ToolResult> {
  const safe = sanitizeName(name);
  const mpath = metaPath(safe);
  const ppath = patchPath(safe);

  if (!existsSync(mpath)) {
    return { success: false, output: '', error: `Snapshot "${safe}" not found.` };
  }

  const meta: SnapshotMeta = JSON.parse(readFileSync(mpath, 'utf8'));
  const snapshotPatch = existsSync(ppath) ? readFileSync(ppath, 'utf8') : '';
  const stagedPatch = existsSync(stagedPatchPath(safe)) ? readFileSync(stagedPatchPath(safe), 'utf8') : '';

  const currentDiff = await runCommand('git diff --name-only', 15000);
  const currentStaged = await runCommand('git diff --cached --name-only', 15000);
  const filesBeforeRevert = [
    ...(currentDiff.output ? currentDiff.output.split('\n').filter(Boolean) : []),
    ...(currentStaged.output ? currentStaged.output.split('\n').filter(Boolean) : []),
  ];

  for (const file of meta.files) {
    await runCommand(`git checkout HEAD -- ${JSON.stringify(file)}`, 15000);
  }

  if (stagedPatch) {
    const sp = path.join(SNAPSHOTS_DIR, `${safe}_restore_staged.patch`);
    writeFileSync(sp, stagedPatch);
    await runCommand(`git apply --cached ${JSON.stringify(sp)}`, 15000);
  }

  if (snapshotPatch) {
    await runCommand(`git apply ${JSON.stringify(ppath)}`, 15000);
  }

  const undone = filesBeforeRevert.filter(f => !meta.files.includes(f));
  const restored = meta.files;

  const lines: string[] = [];
  lines.push(`Reverted to snapshot "${safe}" (${meta.description})`);

  if (restored.length > 0) {
    lines.push(`Reset ${restored.length} file(s) to snapshot state: ${restored.join(', ')}`);
  }
  if (undone.length > 0) {
    lines.push(`Undone ${undone.length} file(s) not in snapshot: ${undone.join(', ')}`);
  }

  return { success: true, output: lines.join('\n') };
}

async function revertLast(): Promise<ToolResult> {
  ensureSnapshotsDir();
  const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter(e => e.name.endsWith('.json'))
    .map(e => {
      try {
        return JSON.parse(readFileSync(path.join(SNAPSHOTS_DIR, e.name), 'utf8')) as SnapshotMeta;
      } catch {
        return null;
      }
    })
    .filter((m): m is SnapshotMeta => m !== null)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (entries.length === 0) {
    return { success: false, output: '', error: 'No snapshots to revert to.' };
  }

  return revertToSnapshot(entries[0].name);
}

export const revertChangesTool: ToolDefinition = {
  name: 'revert_changes',
  description: 'Manage named snapshots of working tree state and revert to them. Supports create_snapshot, list_snapshots, revert_to_snapshot, revert_last.',
  params: [
    { name: 'action', type: 'string', required: true, description: 'Action: create_snapshot | list_snapshots | revert_to_snapshot | revert_last' },
    { name: 'name', type: 'string', required: false, description: 'Snapshot name (required for create_snapshot, revert_to_snapshot).' },
    { name: 'description', type: 'string', required: false, description: 'Description for the snapshot (only for create_snapshot).' },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      if (typeof params.action !== 'string') throw new Error('action must be a string');

      switch (params.action) {
        case 'create_snapshot': {
          if (typeof params.name !== 'string' || !params.name.trim()) throw new Error('name is required for create_snapshot');
          return createSnapshot(params.name, typeof params.description === 'string' ? params.description : '');
        }
        case 'list_snapshots':
          return listSnapshots();
        case 'revert_to_snapshot': {
          if (typeof params.name !== 'string' || !params.name.trim()) throw new Error('name is required for revert_to_snapshot');
          return revertToSnapshot(params.name);
        }
        case 'revert_last':
          return revertLast();
        default:
          throw new Error(`Unknown action: ${params.action}. Valid: create_snapshot, list_snapshots, revert_to_snapshot, revert_last`);
      }
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? 'Unknown error in revert_changes' };
    }
  }
};

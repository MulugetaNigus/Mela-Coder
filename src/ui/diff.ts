type DiffDecision = 'apply' | 'skip' | 'abort';

let autoApply = false;

export function setAutoApply(value: boolean): void {
  autoApply = value;
}

export async function promptDiff(
  _oldContent: string,
  _newContent: string,
  _filePath: string
): Promise<DiffDecision> {
  if (autoApply) return 'apply';
  return 'apply';
}

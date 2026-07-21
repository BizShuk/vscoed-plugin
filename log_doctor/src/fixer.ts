// src/fixer.ts — 取代表項、讀檔、組提示、打 provider、解析修補。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFixPrompt } from './prompt';
import { sendForFixes } from './providers/provider';
import { FixProposal, RepresentativeDiagnostic } from './types';
import type { Provider } from './providers/provider';

export interface FixOneInput {
  diagnostic: RepresentativeDiagnostic;
  provider: Provider;
  contextLines?: number;
}

export interface FixOneResult {
  fixes: FixProposal[];
  error?: string;
}

function uriToFsPath(uri: string): string {
  if (uri.startsWith('file://')) return fileURLToPath(uri);
  return uri;
}

export async function fixOne(input: FixOneInput): Promise<FixOneResult> {
  const uri = input.diagnostic.info.uri;
  const fsPath = uriToFsPath(uri);
  let fileText: string;
  try {
    fileText = await readFile(fsPath, 'utf8');
  } catch (e) {
    return { fixes: [], error: `cannot read ${fsPath}: ${(e as Error).message}` };
  }

  const { system, user } = buildFixPrompt({
    diagnostic: input.diagnostic,
    fileUri: uri,
    fileText,
    contextLines: input.contextLines,
  });

  const { fixes, error } = await sendForFixes(input.provider, system, user);
  // 過濾:只保留對應這個診斷 uri 的修補,其他視為雜訊丟棄
  const matched = fixes.filter((f) => f.uri === uri);
  return { fixes: matched, error: matched.length === 0 ? error : undefined };
}

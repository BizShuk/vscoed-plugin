// src/prompt.ts — 純邏輯,組 LLM 提示。
import { FixProposal, RepresentativeDiagnostic } from './types';

export interface PromptInput {
  diagnostic: RepresentativeDiagnostic;
  fileUri: string;
  fileText: string;
  contextLines?: number;   // 預設 3
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

const SYSTEM = `You are Log Doctor, a precise code-fixing assistant.
You will receive a single VSCode diagnostic and the file it points to.
Respond ONLY with a JSON object of the form:
{
  "fixes": [
    { "uri": "<exact file uri>", "oldText": "<verbatim substring of file>", "newText": "<replacement>", "rationale": "<one sentence>" }
  ]
}
Rules:
- oldText MUST appear verbatim in the file. Do not paraphrase.
- newText MUST be a drop-in replacement at the same location.
- If the fix is uncertain, return { "fixes": [] } and explain in rationale.
- Never touch lines outside the diagnostic range unless strictly required.
- No prose outside the JSON.`;

/** 依行號從全文抽出診斷周圍的 snippet。 */
function snippetAround(
  text: string,
  startLine: number,
  endLine: number,
  context: number,
): string {
  const lines = text.split('\n');
  const lo = Math.max(0, startLine - context);
  const hi = Math.min(lines.length - 1, endLine + context);
  return lines
    .slice(lo, hi + 1)
    .map((l, i) => `${lo + i + 1}: ${l}`)
    .join('\n');
}

export function buildFixPrompt(input: PromptInput): BuiltPrompt {
  const context = input.contextLines ?? 3;
  const d = input.diagnostic.info;
  const snippet = snippetAround(
    input.fileText,
    d.range.start.line,
    d.range.end.line,
    context,
  );
  const user = [
    `File: ${input.fileUri}`,
    `Source: ${d.source}${d.code !== undefined ? ` (${d.code})` : ''}`,
    `Severity: ${d.severity}`,
    `Range: line ${d.range.start.line + 1}, col ${d.range.start.character + 1}` +
      (d.range.start.line !== d.range.end.line
        ? ` to line ${d.range.end.line + 1}, col ${d.range.end.character + 1}`
        : ''),
    `Message: ${d.message}`,
    `Group: this diagnostic represents ${input.diagnostic.groupSize} occurrence(s) across: ${
      [input.fileUri, ...input.diagnostic.groupUris].join(', ')
    }`,
    ``,
    `Snippet:`,
    '```',
    snippet,
    '```',
    ``,
    `Return JSON only.`,
  ].join('\n');
  return { system: SYSTEM, user };
}

/** 從 LLM 回傳文字抽出 fixes 陣列;解析失敗時回傳空陣列並附上錯誤。 */
export function parseFixResponse(raw: string): { fixes: FixProposal[]; error?: string } {
  const trimmed = raw.trim();
  // 寬容解析:允許 ```json ... ``` 包裹
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced ? fenced[1] : trimmed;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.fixes)) {
      return { fixes: [], error: 'missing fixes[]' };
    }
    const fixes: FixProposal[] = parsed.fixes.map((f: any) => ({
      uri: String(f.uri ?? ''),
      oldText: String(f.oldText ?? ''),
      newText: String(f.newText ?? ''),
      rationale: f.rationale ? String(f.rationale) : undefined,
    }));
    return { fixes };
  } catch (e) {
    return { fixes: [], error: (e as Error).message };
  }
}

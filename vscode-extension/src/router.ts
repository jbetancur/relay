import * as vscode from 'vscode';
import type { RouteHints } from './relayClient';

export interface GatheredContext {
  hints: RouteHints;
  // Active selection text, fenced — injected into the message so the backend
  // and classifier see the actual code the user is asking about.
  selectionBlock: string;
}

const DIFF_LANGUAGES = new Set(['diff', 'patch', 'git-commit', 'git-rebase']);

export function gatherContext(
  editor: vscode.TextEditor | undefined,
  prompt: string,
): GatheredContext {
  const selection = editor?.selection;
  const selText = editor && selection && !selection.isEmpty
    ? editor.document.getText(selection)
    : '';
  const language = editor?.document.languageId ?? '';

  // File count: number of distinct file tabs currently open (not previews).
  const fileCount = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputText)
    .length;

  const hasDiff =
    DIFF_LANGUAGES.has(language) ||
    /^[-+]{3} /m.test(selText.slice(0, 500)); // quick diff-header sniff

  const selectionBlock =
    selText.length > 0
      ? `\`\`\`${language}\n${selText.slice(0, 8000)}\n\`\`\``
      : '';

  // charCount estimate for the backend scorer: prompt + selection.
  const charCount = prompt.length + selText.length;

  return {
    hints: {
      fileCount,
      selectionLen: selText.length,
      language,
      hasDiff,
    },
    selectionBlock,
  };
}

// buildMessages composes the final message list sent to /api/v1/chat/completions.
// We keep it minimal: a system prompt that injects the code context, then the
// user's raw prompt. History isn't threaded across turns (chat participants
// handle multi-turn via vscode.ChatContext) — keeping this simple for v1.
export function buildMessages(
  prompt: string,
  ctx: GatheredContext,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

  if (ctx.selectionBlock) {
    messages.push({
      role: 'system',
      content: `The user is working in a ${ctx.hints.language || 'code'} file. Their selected code:\n\n${ctx.selectionBlock}`,
    });
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}

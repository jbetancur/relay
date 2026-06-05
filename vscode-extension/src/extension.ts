import * as vscode from 'vscode';
import { readConfig, setToken, getToken } from './config';
import { RelayClient } from './relayClient';
import { gatherContext, buildMessages } from './router';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('relay.setToken', () =>
      setToken(context.secrets),
    ),
  );

  const participant = vscode.chat.createChatParticipant(
    'relay.chat',
    makeHandler(context),
  );
  participant.iconPath = new vscode.ThemeIcon('rocket');
  context.subscriptions.push(participant);
}

export function deactivate(): void {}

function makeHandler(
  context: vscode.ExtensionContext,
): vscode.ChatRequestHandler {
  return async (
    request: vscode.ChatRequest,
    _chatCtx: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => {
    const cfg = readConfig();
    const authToken = await getToken(context.secrets);
    const client = new RelayClient(cfg.baseUrl, authToken, cfg.connectionId);

    const editor = vscode.window.activeTextEditor;
    const ctx = gatherContext(editor, request.prompt);

    stream.progress('Routing to best model…');

    let decision;
    try {
      decision = await client.route({
        task: request.prompt,
        hints: ctx.hints,
      });
    } catch (err) {
      stream.markdown(
        `> **Relay error:** ${err instanceof Error ? err.message : String(err)}\n\n` +
        `> Is the backend running at \`${cfg.baseUrl}\`? Run **Relay: Set Auth Token** if auth is needed.`,
      );
      return;
    }

    if (cfg.showRoutingReason) {
      const tierIcon = { local: '🟢', mid: '🟡', frontier: '🔴' }[decision.tier] ?? '⚪';
      const classifier = decision.classifierUsed ? ' *(classifier)*' : '';
      stream.markdown(
        `*${tierIcon} \`${decision.model}\` — ${decision.reason}${classifier}*\n\n`,
      );
    }

    if (token.isCancellationRequested) return;

    const messages = buildMessages(request.prompt, ctx);

    try {
      for await (const chunk of client.chatCompletionsStream(
        decision.model,
        decision.connectionId,
        messages,
        token,
      )) {
        stream.markdown(chunk);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        stream.markdown(
          `\n\n> **Stream error:** ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      metadata: { model: decision.model, tier: decision.tier },
    };
  };
}

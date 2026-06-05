import * as vscode from 'vscode';

export interface Config {
  baseUrl: string;
  connectionId: string;
  showRoutingReason: boolean;
}

export function readConfig(): Config {
  const cfg = vscode.workspace.getConfiguration('relay');
  return {
    baseUrl: (cfg.get<string>('baseUrl') ?? 'http://localhost:8080').replace(/\/$/, ''),
    connectionId: cfg.get<string>('connectionId') ?? '',
    showRoutingReason: cfg.get<boolean>('showRoutingReason') ?? true,
  };
}

export async function setToken(secrets: vscode.SecretStorage): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: 'Relay: Set Auth Token',
    prompt: 'Enter your Relay backend auth token (leave blank to clear)',
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return; // cancelled
  }
  if (token === '') {
    await secrets.delete('relay.token');
    vscode.window.showInformationMessage('Relay: auth token cleared');
  } else {
    await secrets.store('relay.token', token);
    vscode.window.showInformationMessage('Relay: auth token saved');
  }
}

export async function getToken(secrets: vscode.SecretStorage): Promise<string> {
  return (await secrets.get('relay.token')) ?? '';
}

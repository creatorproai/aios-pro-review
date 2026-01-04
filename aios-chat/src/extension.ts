import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { ChatViewProvider } from './chatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AIOS Chat] Activating...');

  // Register sidebar webview provider (activity bar icon)
  const chatViewProvider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider
    )
  );

  // Register open chat command (legacy panel support)
  const openChat = vscode.commands.registerCommand('extension-a.openChat', () => {
    ChatPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(openChat);

  console.log('[AIOS Chat] Activated');
}

export function deactivate(): void {
  console.log('[AIOS Chat] Deactivating');
}

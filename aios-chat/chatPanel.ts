import * as vscode from 'vscode';
import { handleTurn } from './turnHandler';
import { ensureSession, waitForCapsuleCompiler } from './capsuleClient';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private sessionId: string | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;

    // Handle messages from webview (per Sage-Architect: handle ALL message types)
    this.panel.webview.onDidReceiveMessage(
      async (message: { type: string; text?: string }) => {
        if (message.type === 'send' && message.text) {
          await this.handleUserMessage(message.text);
        }
      },
      null,
      this.disposables
    );

    // Cleanup on dispose
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Initialize (wait for Capsule-Compiler per Sage-Architect guidance)
    this.initialize();
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiosChat',
      'AIOS Chat',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel);
    ChatPanel.currentPanel.panel.webview.html = ChatPanel.getHtml();
  }

  private async initialize(): Promise<void> {
    try {
      // Wait for Capsule-Compiler before accepting user input (per Sage-Architect)
      this.sendStatus('Connecting to AIOS...');
      await waitForCapsuleCompiler();

      // Ensure session
      this.sessionId = await ensureSession();
      this.sendStatus('Ready');

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize';
      this.sendStatus(`Error: ${message}`);
    }
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (!this.sessionId) {
      this.sendError('No active session');
      return;
    }

    // Show user message
    this.sendMessage('user', text);

    // Show assistant placeholder
    this.sendMessage('assistant', '', true);

    try {
      // Handle turn with streaming
      const generator = handleTurn(
        this.sessionId,
        text,
        (status) => this.sendStatus(status)
      );

      let result;
      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          result = value;
          break;
        }
        // Stream token to UI
        this.streamToken(value);
      }

      // Finalize message
      this.finalizeMessage();
      this.sendStatus('Ready');

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(message);
    }
  }

  private sendMessage(role: 'user' | 'assistant', content: string, streaming = false): void {
    this.panel.webview.postMessage({
      type: 'message',
      role,
      content,
      streaming
    });
  }

  private streamToken(token: string): void {
    this.panel.webview.postMessage({ type: 'token', token });
  }

  private finalizeMessage(): void {
    this.panel.webview.postMessage({ type: 'finalize' });
  }

  private sendStatus(status: string): void {
    this.panel.webview.postMessage({ type: 'status', status });
  }

  private sendError(error: string): void {
    this.panel.webview.postMessage({ type: 'error', error });
  }

  private dispose(): void {
    ChatPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private static getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; }
    #messages { margin-bottom: 80px; }
    .message { margin: 8px 0; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
    .user { background: var(--vscode-editor-selectionBackground); }
    .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
    #input-area { position: fixed; bottom: 0; left: 0; right: 0; padding: 16px; background: var(--vscode-editor-background); }
    #input { width: calc(100% - 80px); padding: 8px; }
    #send { width: 60px; padding: 8px; }
    #status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-area">
    <div id="status">Initializing...</div>
    <input id="input" type="text" placeholder="Type a message..." />
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const status = document.getElementById('status');
    let currentMessage = null;

    document.getElementById('send').onclick = send;
    input.onkeypress = (e) => { if (e.key === 'Enter') send(); };

    function send() {
      const text = input.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'send', text });
      input.value = '';
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'message') {
        const div = document.createElement('div');
        div.className = 'message ' + msg.role;
        div.textContent = msg.content;
        messages.appendChild(div);
        if (msg.streaming) currentMessage = div;
        div.scrollIntoView();
      } else if (msg.type === 'token') {
        if (currentMessage) currentMessage.textContent += msg.token;
      } else if (msg.type === 'finalize') {
        currentMessage = null;
      } else if (msg.type === 'status') {
        status.textContent = msg.status;
      } else if (msg.type === 'error') {
        status.textContent = 'Error: ' + msg.error;
      }
    });
  </script>
</body>
</html>`;
  }
}

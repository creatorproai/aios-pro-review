import * as vscode from 'vscode';
import { handleTurn } from './turnHandler';
import { ensureSession, waitForCapsuleCompiler } from './capsuleClient';

/**
 * ChatViewProvider - WebviewViewProvider for activity bar sidebar
 * Mirrors ChatPanel exactly per Sage-Architect directive
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiosChatView';

  private view?: vscode.WebviewView;
  private sessionId: string | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from webview (same pattern as ChatPanel)
    webviewView.webview.onDidReceiveMessage(
      async (message: { type: string; text?: string }) => {
        if (message.type === 'send' && message.text) {
          await this.handleUserMessage(message.text);
        }
      }
    );

    // Initialize (wait for Capsule-Compiler per Sage-Architect guidance)
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Wait for Capsule-Compiler before accepting user input
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
      // Handle turn with streaming (same pattern as ChatPanel)
      const generator = handleTurn(
        this.sessionId,
        text,
        (status) => this.sendStatus(status)
      );

      while (true) {
        const { value, done } = await generator.next();
        if (done) {
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
    this.view?.webview.postMessage({
      type: 'message',
      role,
      content,
      streaming
    });
  }

  private streamToken(token: string): void {
    this.view?.webview.postMessage({ type: 'token', token });
  }

  private finalizeMessage(): void {
    this.view?.webview.postMessage({ type: 'finalize' });
  }

  private sendStatus(status: string): void {
    this.view?.webview.postMessage({ type: 'status', status });
  }

  private sendError(error: string): void {
    this.view?.webview.postMessage({ type: 'error', error });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 8px; margin: 0; height: 100vh; display: flex; flex-direction: column; }
    #messages { flex: 1; overflow-y: auto; margin-bottom: 8px; }
    .message { margin: 8px 0; padding: 8px; border-radius: 6px; white-space: pre-wrap; font-size: 13px; }
    .user { background: var(--vscode-editor-selectionBackground); }
    .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
    #input-area { padding: 8px 0; border-top: 1px solid var(--vscode-panel-border); }
    #input { width: calc(100% - 60px); padding: 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
    #send { width: 50px; padding: 6px; margin-left: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    #send:hover { background: var(--vscode-button-hoverBackground); }
    #status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
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

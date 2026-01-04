const CAPSULE_COMPILER_URL = 'http://localhost:11436';

/**
 * Wait for Capsule-Compiler to be ready
 * Implements Reliability Policy: 10 retries, 300ms delay
 */
export async function waitForCapsuleCompiler(
  maxRetries = 10,
  delayMs = 300
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${CAPSULE_COMPILER_URL}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error('Capsule Compiler not available');
}

/**
 * Create or get session
 */
export async function ensureSession(): Promise<string> {
  // Try to get current session
  try {
    const res = await fetch(`${CAPSULE_COMPILER_URL}/session/current`);
    if (res.ok) {
      const data = await res.json() as { sessionId: string };
      return data.sessionId;
    }
  } catch {}

  // Create new session
  const res = await fetch(`${CAPSULE_COMPILER_URL}/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  if (!res.ok) {
    throw new Error('Failed to create session');
  }

  const data = await res.json() as { sessionId: string };
  return data.sessionId;
}

/**
 * Begin a turn
 * @param extensionChain Optional - which extensions to run (Phase 1A: ['extension-a'] only)
 */
export async function beginTurn(
  sessionId: string,
  userInput: string,
  extensionChain?: string[]
): Promise<{ turnId: string; sessionId: string }> {
  const res = await fetch(`${CAPSULE_COMPILER_URL}/turn/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, userInput, extensionChain })
  });

  if (!res.ok) {
    const error = await res.json() as { error?: { message?: string } };
    throw new Error(error.error?.message || 'Failed to begin turn');
  }

  return res.json() as Promise<{ turnId: string; sessionId: string }>;
}

/**
 * Call LLM (non-streaming)
 */
export async function callLLM(
  llmId: string,
  surfaces: string[],
  userInput?: string
): Promise<{ response: string }> {
  const res = await fetch(`${CAPSULE_COMPILER_URL}/llm/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ llmId, surfaces, userInput })
  });

  if (!res.ok) {
    const error = await res.json() as { error?: { message?: string } };
    throw new Error(error.error?.message || 'LLM call failed');
  }

  return res.json() as Promise<{ response: string }>;
}

/**
 * Stream LLM (for LLM2)
 */
export async function* streamLLM(
  surfaces: string[]
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${CAPSULE_COMPILER_URL}/llm/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ llmId: 'llm2', surfaces })
  });

  if (!res.ok) {
    throw new Error('LLM stream failed');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as { token?: string; done?: boolean };
          if (data.token && !data.done) {
            yield data.token;
          }
          if (data.done) return;
        } catch {}
      }
    }
  }
}

/**
 * Update surface
 */
export async function updateSurface(
  surfaceId: string,
  content: object
): Promise<void> {
  const res = await fetch(`${CAPSULE_COMPILER_URL}/surface/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surfaceId, content })
  });

  if (!res.ok) {
    const error = await res.json() as { error?: { message?: string } };
    throw new Error(error.error?.message || 'Surface update failed');
  }
}

/**
 * Emit turn event
 */
export async function emitTurnEvent(event: string): Promise<void> {
  const res = await fetch(`${CAPSULE_COMPILER_URL}/turn/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event })
  });

  if (!res.ok) {
    const error = await res.json() as { error?: { message?: string } };
    throw new Error(error.error?.message || 'Turn emit failed');
  }
}

/**
 * Mark turn as failed
 */
export async function failTurn(error: string): Promise<void> {
  await fetch(`${CAPSULE_COMPILER_URL}/turn/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error })
  });
}

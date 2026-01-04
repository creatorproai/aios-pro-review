import { InferRequest, InferResponse, StreamEvent } from '../types';
import { withRetry, fetchWithTimeout } from './retryService';

// Use 127.0.0.1 to avoid IPv6 resolution issues in Node.js 17+
const LLM_SERVICE_URL = 'http://127.0.0.1:3456';

const LLM_TIMEOUT_MS = 150000; // 2.5 minutes - for non-streaming calls

// Streaming-specific timeouts
const LLM_CONNECT_TIMEOUT_MS = 240000; // 4 minutes - allows cold-start model loads
const LLM_STREAM_IDLE_TIMEOUT_MS = 45000; // 45 seconds - abort if stream stalls

/**
 * Non-streaming call to llm-service /infer
 * Used by LLM1, LLM3A, LLM3B, LLM4A, LLM4B
 * Includes retry policy (3 attempts with exponential backoff)
 */
export async function callLLM(
  systemPrompt: string, 
  capsule: string
): Promise<InferResponse> {
  return withRetry(async () => {
    const request: InferRequest = {
      systemPrompt,
      userMessage: capsule,
    };
    
    const response = await fetchWithTimeout(
      `${LLM_SERVICE_URL}/infer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
      LLM_TIMEOUT_MS
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`llm-service error: ${response.status} - ${error}`);
    }
    
    return response.json() as Promise<InferResponse>;
  });
}

/**
 * Streaming call to llm-service /infer/stream
 * Used by LLM2 only
 * Returns async generator of stream events
 * 
 * Timeout Strategy:
 * - Connect timeout (240s): Allows cold-start model loading
 * - Idle timeout (45s): Resets on each chunk, catches stalled streams
 * - No retry on streaming - if connection fails, stream fails
 */
export async function* streamLLM(
  systemPrompt: string,
  capsule: string
): AsyncGenerator<StreamEvent, void, unknown> {
  const request: InferRequest = {
    systemPrompt,
    userMessage: capsule,
  };

  // Single AbortController for both timeouts
  const controller = new AbortController();
  
  // Phase 1: Connect timeout (cleared when response headers arrive)
  const connectTimeout = setTimeout(() => controller.abort(), LLM_CONNECT_TIMEOUT_MS);

  // Phase 2: Idle timeout (resets on each chunk)
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimeout = () => {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => controller.abort(), LLM_STREAM_IDLE_TIMEOUT_MS);
  };

  console.log('[streamLLM] Initiating streaming request...');

  // Make the fetch request
  const response = await fetch(`${LLM_SERVICE_URL}/infer/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal: controller.signal,
  });

  // Response headers received - clear connect timeout, start idle timeout
  clearTimeout(connectTimeout);
  
  console.log(`[streamLLM] Response status: ${response.status}`);

  if (!response.ok) {
    throw new Error(`llm-service error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    console.error('[streamLLM] Failed to get reader from response.body');
    throw new Error('No response body - streaming not supported in this environment');
  }

  console.log('[streamLLM] Reader obtained, starting chunk processing...');

  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

  // Start idle timeout now that we're reading
  resetIdleTimeout();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log(`[streamLLM] Stream complete after ${chunkCount} chunks`);
        break;
      }
      
      // Chunk received - reset idle timeout
      resetIdleTimeout();
      chunkCount++;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: StreamEvent = JSON.parse(line.slice(6));
            yield data;
          } catch {
            // Skip non-JSON lines (e.g., empty keep-alive)
          }
        }
      }
    }
  } catch (error) {
    // Distinguish between abort and other errors
    if (controller.signal.aborted) {
      throw new Error('LLM stream timed out - no data received within timeout period');
    }
    throw error;
  } finally {
    // Clean up timeouts
    if (idleTimeout) clearTimeout(idleTimeout);
    reader.releaseLock();
  }
}

/**
 * Check llm-service health
 */
export async function checkLLMServiceHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${LLM_SERVICE_URL}/health`,
      { method: 'GET' },
      5000
    );
    
    if (!response.ok) return false;
    
    const data = await response.json() as { status: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

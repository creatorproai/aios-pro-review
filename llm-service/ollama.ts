// src/services/ollama.ts
// Ollama API wrapper - pure routing, no intelligence

import { OllamaGenerateRequest, OllamaGenerateResponse } from '../types/index.js';

const OLLAMA_ENDPOINT = 'http://localhost:11434';

// Cached default model (set on first auto-detect)
let cachedDefaultModel: string | null = null;

export interface CallOllamaOptions {
  prompt: string;
  model?: string;  // Optional - will auto-detect if not provided
  temperature?: number;  // Optional - let Ollama use its default if not provided
  timeout: number;
}

// Preferred model families in order of priority (case-insensitive matching)
// Updated Jan 2, 2026: aios-pro-8k is the AIOS Pro Reasoning Core (8K context, ~6GB RAM)
const PREFERRED_MODEL_PATTERNS = [
  'aios-pro-8k',           // AIOS Pro Reasoning Core (REQUIRED - Jan 2, 2026)
  'ministral-3-unsloth',   // Fallback: Custom Q4_K_M quantized
  'mistral',               // Fallback: Mistral family
  'llama3.2',              // Fallback: Llama 3.2 family
  'llama3.1',              // Fallback: Llama 3.1 family
  'llama'                  // Fallback: Any Llama
];

/**
 * Auto-detect available model from Ollama
 * Uses case-insensitive matching for provider-agnostic detection
 */
export async function getDefaultModel(): Promise<string> {
  if (cachedDefaultModel) {
    return cachedDefaultModel;
  }

  try {
    const models = await listOllamaModels();
    if (models.length === 0) {
      throw new Error('No models available in Ollama');
    }

    console.log(`[ollama] Available models: ${models.join(', ')}`);

    // Check for preferred models in order (CASE-INSENSITIVE)
    for (const pattern of PREFERRED_MODEL_PATTERNS) {
      const found = models.find(m => 
        m.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) {
        cachedDefaultModel = found;
        console.log(`[ollama] Auto-detected preferred model: ${found} (matched pattern: ${pattern})`);
        return found;
      }
    }

    // Otherwise use first available
    cachedDefaultModel = models[0];
    console.log(`[ollama] Auto-detected model: ${cachedDefaultModel}`);
    return cachedDefaultModel;
  } catch (error) {
    console.error('[ollama] Failed to auto-detect model:', error);
    throw new Error('Failed to auto-detect Ollama model. Is Ollama running?');
  }
}

/**
 * Call Ollama API for inference
 * Auto-detects model if not provided
 */
export async function callOllama(options: CallOllamaOptions): Promise<OllamaGenerateResponse> {
  const { prompt, temperature, timeout } = options;
  
  // Auto-detect model if not provided
  const model = options.model || await getDefaultModel();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const request: OllamaGenerateRequest = {
      model,
      prompt,
      stream: false,
      options: {
        ...(temperature !== undefined && { temperature }),  // Only if explicitly provided
        num_ctx: 8192  // Reduced to 8K for performance - Phase 1A
      }
    };
    
    console.log(`[ollama] Calling model: ${model}`);
    
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Ollama error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }
    
    return await response.json() as OllamaGenerateResponse;
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List available models from Ollama
 */
export async function listOllamaModels(): Promise<string[]> {
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000)
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch models from Ollama');
  }
  
  const data = await response.json() as { models?: Array<{ name: string }> };
  return data.models?.map((m) => m.name) || [];
}

/**
 * Stream tokens from Ollama API
 * Used for LLM2 streaming responses
 */
export async function* callOllamaStream(options: CallOllamaOptions): AsyncGenerator<{
  token: string;
  done: boolean;
  model: string;
  tokensGenerated?: number;
}, void, unknown> {
  const { prompt, temperature, timeout } = options;

  // Auto-detect model if not provided
  const model = options.model || await getDefaultModel();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const request: OllamaGenerateRequest = {
      model,
      prompt,
      stream: true,
      options: {
        ...(temperature !== undefined && { temperature }),
        num_ctx: 8192  // Reduced to 8K for performance - Phase 1A
      }
    };

    console.log(`[ollama] Streaming model: ${model}`);

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Ollama error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk = JSON.parse(trimmed) as OllamaGenerateResponse & { error?: string };

          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }

          yield {
            token: chunk.response,
            done: chunk.done,
            model: chunk.model || model,
            tokensGenerated: chunk.eval_count
          };

          if (chunk.done) {
            return;
          }
        } catch (parseError) {
          console.error('[ollama] Failed to parse stream chunk:', parseError);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

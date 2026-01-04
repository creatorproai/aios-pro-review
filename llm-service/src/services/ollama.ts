import { SKELETAL_ANCHOR } from '../constants/skeletal-anchor.js';

/**
 * AIOS Pro Ollama Service
 * Implements "Skeletal Anchoring" for KV Cache optimization
 * Updated: Jan 3, 2026
 */

const OLLAMA_ENDPOINT = process.env.OLLAMA_HOST || 'http://localhost:11434';

// Cached default model
let cachedDefaultModel: string | null = null;

// Preferred model patterns (case-insensitive)
const PREFERRED_MODEL_PATTERNS = [
  'aios-pro-8k',
  'ministral-3-unsloth',
  'mistral',
  'llama3.2',
  'llama3.1',
  'llama'
];

export interface CallOllamaOptions {
  rolePrompt: string;      // Content from llm1-curator.md, llm2-responder.md, etc.
  userMessage: string;     // Capsule data or user input for this specific turn
  model?: string;          // Default: auto-detect
  temperature?: number;    // Default: 0.1
  timeout?: number;        // Default: 30000ms
}

export interface OllamaMetrics {
  total: number;           // Total duration in seconds
  load: number;            // Model load time (0 if cached)
  prefill: number;         // KV cache prefill time (KEY METRIC: <0.5s = cache hit)
  gen: number;             // Token generation time
}

export interface OllamaResponse {
  content: string;
  metrics: OllamaMetrics;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  keep_alive: number | string;
  options: {
    num_ctx: number;
    temperature: number;
    num_predict?: number;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Auto-detect available model from Ollama
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

    // Check for preferred models in order
    for (const pattern of PREFERRED_MODEL_PATTERNS) {
      const found = models.find(m => 
        m.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) {
        cachedDefaultModel = found;
        console.log(`[ollama] Auto-detected preferred model: ${found}`);
        return found;
      }
    }

    // Use first available
    cachedDefaultModel = models[0];
    console.log(`[ollama] Auto-detected model: ${cachedDefaultModel}`);
    return cachedDefaultModel;
  } catch (error) {
    console.error('[ollama] Failed to auto-detect model:', error);
    throw new Error('Failed to auto-detect Ollama model. Is Ollama running?');
  }
}

/**
 * Call Ollama with Skeletal Anchor architecture
 * System message: SKELETAL_ANCHOR (constant, ~50 tokens)
 * User message: Role Prompt + Turn Data (fused)
 */
export async function callOllamaChat(options: CallOllamaOptions): Promise<OllamaResponse> {
  const { 
    rolePrompt, 
    userMessage, 
    model: requestedModel,
    temperature = 0.1, 
    timeout = 30000 
  } = options;

  const model = requestedModel || await getDefaultModel();

  // CRITICAL: Fuse role intelligence + data into user message
  // System message stays constant for KV cache hit
  const fusedUserPayload = `# ROLE_STANCE
${rolePrompt.trim()}

---

# TURN_DATA
${userMessage.trim()}`.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const request: OllamaChatRequest = {
      model,
      messages: [
        { 
          role: 'system', 
          content: SKELETAL_ANCHOR  // CONSTANT - locked in KV cache via num_keep 64
        },
        { 
          role: 'user', 
          content: fusedUserPayload  // DYNAMIC (role + data)
        }
      ],
      stream: false,
      keep_alive: -1,  // CRITICAL: Never unload model from VRAM
      options: {
        num_ctx: 8192,
        temperature,
        num_predict: 1024  // Prevents runaway generation
      }
    };

    console.log(`[ollama/chat] Calling model: ${model} (KV cache enabled)`);

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Ollama error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const data = await response.json() as OllamaChatResponse;

    clearTimeout(timeoutId);

    // Extract performance metrics
    const metrics: OllamaMetrics = {
      total: (data.total_duration || 0) / 1e9,
      load: (data.load_duration || 0) / 1e9,
      prefill: (data.prompt_eval_duration || 0) / 1e9,  // KEY METRIC
      gen: (data.eval_duration || 0) / 1e9
    };

    // Log cache performance
    const isCacheHit = metrics.prefill < 0.5;
    console.log(
      `[ollama/chat] ${isCacheHit ? 'CACHE HIT' : 'CACHE MISS'} ` +
      `- Total: ${metrics.total.toFixed(2)}s, Prefill: ${metrics.prefill.toFixed(2)}s`
    );

    return {
      content: data.message?.content || '',
      metrics
    };

  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Stream tokens from Ollama (for LLM2 only)
 */
export async function* callOllamaChatStream(
  options: CallOllamaOptions
): AsyncGenerator<{ token: string; done: boolean; metrics?: OllamaMetrics }> {
  const { 
    rolePrompt, 
    userMessage, 
    model: requestedModel,
    temperature = 0.1, 
    timeout = 30000 
  } = options;

  const model = requestedModel || await getDefaultModel();

  const fusedUserPayload = `# ROLE_STANCE
${rolePrompt.trim()}

---

# TURN_DATA
${userMessage.trim()}`.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const request: OllamaChatRequest = {
      model,
      messages: [
        { role: 'system', content: SKELETAL_ANCHOR },  // CONSTANT - locked in KV cache
        { role: 'user', content: fusedUserPayload }    // DYNAMIC
      ],
      stream: true,
      keep_alive: -1,
      options: {
        num_ctx: 8192,
        temperature,
        num_predict: 1024
      }
    };

    console.log(`[ollama/stream] Streaming model: ${model} (KV cache enabled)`);

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Ollama stream error: ${response.status} - ${JSON.stringify(errorBody)}`);
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
          const chunk = JSON.parse(trimmed) as OllamaChatResponse;

          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }

          const isComplete = chunk.done;

          if (isComplete) {
            const metrics: OllamaMetrics = {
              total: (chunk.total_duration || 0) / 1e9,
              load: (chunk.load_duration || 0) / 1e9,
              prefill: (chunk.prompt_eval_duration || 0) / 1e9,
              gen: (chunk.eval_duration || 0) / 1e9
            };

            yield {
              token: chunk.message?.content || '',
              done: true,
              metrics
            };

            return;
          }

          yield {
            token: chunk.message?.content || '',
            done: false
          };

        } catch (parseError) {
          console.error('[ollama/stream] Failed to parse chunk:', parseError);
        }
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama stream timeout after ${timeout}ms`);
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

/**
 * Retry Policy Configuration
 * - 3 retries with exponential backoff
 * - Delays: immediate, 1 second, 3 seconds
 */
const RETRY_DELAYS = [0, 1000, 3000]; // ms

export interface RetryOptions {
  maxRetries?: number;
  timeout?: number;
}

/**
 * Execute an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Apply delay for retries
      if (attempt > 0 && RETRY_DELAYS[attempt - 1]) {
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      
      return await fn();
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`);
    }
  }
  
  throw lastError ?? new Error('All retry attempts failed');
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 60000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

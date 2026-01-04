import { Request, Response } from 'express';
import { HealthResponse } from '../types';
import { getCurrentSessionId } from './session';

const LLM_SERVICE_URL = 'http://localhost:3456';

/**
 * GET /health
 */
export async function getHealth(req: Request, res: Response): Promise<void> {
  let llmServiceAvailable = false;

  try {
    const response = await fetch(`${LLM_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    llmServiceAvailable = response.ok;
  } catch {
    llmServiceAvailable = false;
  }

  const response: HealthResponse = {
    status: llmServiceAvailable ? 'ok' : 'degraded',
    sessionId: getCurrentSessionId(),
    llmServiceAvailable
  };

  res.json(response);
}

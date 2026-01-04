import { Request, Response } from 'express';
import { LLMId, LLMProcessRequest, LLMProcessResponse, ErrorResponse } from '../types';
import { loadSystemPrompt } from '../services/promptService';
import { callLLM } from '../services/llmClient';
import { compileCapsule } from '../services/capsuleService';
import { getCurrentSessionId } from './session';

// Valid LLM IDs for non-streaming
const VALID_LLM_IDS: LLMId[] = ['llm1', 'llm3', 'llm3a', 'llm3b', 'llm4a', 'llm4b'];

/**
 * POST /llm/process - Non-streaming LLM call
 * 
 * 1. Validates request
 * 2. Assembles capsule using Sprint 2's variable substitution
 * 3. Loads system prompt for LLM
 * 4. Calls llm-service /infer (with retry)
 * 5. Returns response
 */
export async function handleLLMProcess(req: Request, res: Response): Promise<void> {
  const sessionId = getCurrentSessionId();
  
  if (!sessionId) {
    res.status(400).json({
      error: { code: 'NO_SESSION', message: 'No active session' }
    } as ErrorResponse);
    return;
  }

  try {
    const { llmId, surfaces, userInput } = req.body as LLMProcessRequest;
    
    // Validate llmId
    if (!llmId || !VALID_LLM_IDS.includes(llmId)) {
      res.status(400).json({
        error: {
          code: 'INVALID_LLM_ID',
          message: `Invalid llmId. Valid IDs for /llm/process: ${VALID_LLM_IDS.join(', ')}`,
        },
      } as ErrorResponse);
      return;
    }
    
    // Validate surfaces
    if (!Array.isArray(surfaces) || surfaces.length === 0) {
      res.status(400).json({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'surfaces must be a non-empty array',
        },
      } as ErrorResponse);
      return;
    }
    
    // LLM2 should use /llm/stream, not /llm/process
    if ((llmId as string) === 'llm2') {
      res.status(400).json({
        error: {
          code: 'INVALID_LLM_ID',
          message: 'LLM2 requires streaming. Use /llm/stream endpoint.',
        },
      } as ErrorResponse);
      return;
    }
    
    console.log(`[LLM Process] ${llmId} - Assembling capsule...`);
    
    // 1. Assemble capsule using Sprint 2's variable substitution
    const capsule = await compileCapsule(sessionId, surfaces, userInput);
    
    // 2. Load system prompt for this LLM
    const systemPrompt = await loadSystemPrompt(llmId);
    
    console.log(`[LLM Process] ${llmId} - Calling llm-service...`);
    
    // 3. Call llm-service (with retry policy)
    const result = await callLLM(systemPrompt, capsule.text);
    
    console.log(`[LLM Process] ${llmId} - Complete, ${result.tokensGenerated} tokens`);
    
    // 4. Return response
    const response: LLMProcessResponse = {
      response: result.text,
      tokensUsed: result.tokensGenerated,
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('[LLM Process] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Determine error code
    let code = 'LLM_FAILED';
    let status = 500;
    
    if (message.includes('llm-service error')) {
      code = 'LLM_SERVICE_UNAVAILABLE';
      status = 502;
    } else if (message.includes('abort')) {
      code = 'LLM_TIMEOUT';
      status = 504;
    }
    
    res.status(status).json({
      error: { code, message },
    } as ErrorResponse);
  }
}

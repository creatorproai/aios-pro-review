import { Request, Response } from 'express';
import { LLMProcessRequest, ErrorResponse } from '../types';
import { loadSystemPrompt } from '../services/promptService';
import { streamLLM } from '../services/llmClient';
import { compileCapsule } from '../services/capsuleService';
import { getCurrentSessionId } from './session';

/**
 * POST /llm/stream - Streaming LLM call (LLM2 only)
 * 
 * 1. Validates request (must be llm2)
 * 2. Assembles capsule using Sprint 2's variable substitution
 * 3. Loads LLM2 system prompt
 * 4. Streams from llm-service /infer/stream
 * 5. Proxies SSE to client
 */
export async function handleLLMStream(req: Request, res: Response): Promise<void> {
  const sessionId = getCurrentSessionId();
  
  if (!sessionId) {
    res.status(400).json({
      error: { code: 'NO_SESSION', message: 'No active session' }
    } as ErrorResponse);
    return;
  }

  try {
    const { llmId, surfaces } = req.body as LLMProcessRequest;
    
    // LLM2 only for streaming
    if (llmId !== 'llm2') {
      res.status(400).json({
        error: {
          code: 'INVALID_LLM_ID',
          message: 'Only llm2 supports streaming. Use /llm/process for other LLMs.',
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
    
    console.log(`[LLM Stream] llm2 - Assembling capsule...`);
    
    // 1. Assemble capsule using Sprint 2's variable substitution
    // Note: LLM2 should NOT receive userInput - it's already in HEAD from LLM1
    const capsule = await compileCapsule(sessionId, surfaces, undefined);
    
    // 2. Load LLM2 system prompt
    const systemPrompt = await loadSystemPrompt('llm2');
    
    // 3. Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders(); // Immediately send headers to client (prevents buffering)
    
    console.log(`[LLM Stream] llm2 - Streaming...`);
    
    // 4. Stream from llm-service and proxy to client
    for await (const event of streamLLM(systemPrompt, capsule.text)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      
      // If done or error, close stream
      if ('done' in event && event.done) {
        if ('tokensGenerated' in event) {
          console.log(`[LLM Stream] llm2 - Complete, ${event.tokensGenerated} tokens`);
        }
        break;
      }
    }
    
    res.end();
    
  } catch (error) {
    console.error('[LLM Stream] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Send error as SSE event if headers already sent
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: message, done: true })}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        error: { code: 'LLM_STREAM_FAILED', message }
      } as ErrorResponse);
    }
  }
}

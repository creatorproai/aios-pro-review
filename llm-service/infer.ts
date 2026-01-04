// src/routes/infer.ts
// Inference endpoint for llm-service V4

import { Router, Request, Response } from 'express';
import { InferRequest, InferResponse, InferStreamChunk } from '../types/index.js';
import { callOllama, callOllamaStream, getDefaultModel } from '../services/ollama.js';

export const inferRouter = Router();

// Config from environment — can be overridden by auto-detection
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const DEFAULT_TIMEOUT = 120000;  // 2 minutes - accommodates cold start for 8B models

inferRouter.post('/infer', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const body: InferRequest = req.body;
    
    // Validate required fields
    if (!body.systemPrompt && !body.userMessage) {
      return res.status(400).json({
        error: 'Missing required field: systemPrompt or userMessage'
      });
    }
    
    // Determine model: request > environment > auto-detect from Ollama
    let targetModel = body.model || OLLAMA_MODEL;
    if (!targetModel) {
      console.log('[llm-service] No model specified, auto-detecting...');
      targetModel = await getDefaultModel();
      console.log(`[llm-service] Auto-detected model: ${targetModel}`);
    }
    
    // Build full prompt
    const fullPrompt = body.systemPrompt 
      ? `${body.systemPrompt}\n\n${body.userMessage || ''}`
      : body.userMessage;
    
    // Call Ollama - only pass temperature if explicitly provided
    const result = await callOllama({
      prompt: fullPrompt,
      model: targetModel,
      ...(body.temperature !== undefined && { temperature: body.temperature }),
      timeout: body.timeout || DEFAULT_TIMEOUT
    });
    
    const response: InferResponse = {
      text: result.response,
      model: result.model,
      tokensGenerated: result.eval_count,
      duration: Date.now() - startTime
    };
    
    console.log(`[llm-service] Inference complete: ${response.tokensGenerated || 0} tokens in ${response.duration}ms`);
    
    res.json(response);
    
  } catch (error) {
    console.error('[llm-service] Inference error:', error);
    
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Inference failed'
    });
  }
});

/**
 * POST /infer/stream - Streaming inference endpoint (SSE)
 * Used by LLM2 for real-time response streaming
 */
inferRouter.post('/infer/stream', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const body: InferRequest = req.body;

    // Validate required fields
    if (!body.systemPrompt && !body.userMessage) {
      return res.status(400).json({
        error: 'Missing required field: systemPrompt or userMessage'
      });
    }

    // Determine model: request > environment > auto-detect from Ollama
    let targetModel = body.model || OLLAMA_MODEL;
    if (!targetModel) {
      console.log('[llm-service] No model specified for stream, auto-detecting...');
      targetModel = await getDefaultModel();
      console.log(`[llm-service] Auto-detected model for stream: ${targetModel}`);
    }

    // Build full prompt
    const fullPrompt = body.systemPrompt
      ? `${body.systemPrompt}\n\n${body.userMessage || ''}`
      : body.userMessage;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    console.log(`[llm-service] Streaming inference start (model=${targetModel})`);

    // Stream from Ollama
    for await (const chunk of callOllamaStream({
      prompt: fullPrompt,
      model: targetModel,
      temperature: body.temperature,
      timeout: body.timeout || DEFAULT_TIMEOUT
    })) {
      const event: InferStreamChunk = {
        token: chunk.token,
        done: chunk.done,
        model: chunk.model,
        tokensGenerated: chunk.tokensGenerated,
      };

      res.write(`data: ${JSON.stringify(event)}\n\n`);

      if (event.done) {
        console.log(`[llm-service] Streaming inference complete in ${Date.now() - startTime}ms`);
        break;
      }
    }

    res.end();

  } catch (error) {
    console.error('[llm-service] Streaming inference error:', error);

    const message = error instanceof Error ? error.message : 'Streaming inference failed';

    // If headers not yet sent, return JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: message });
      return;
    }

    // If already streaming, emit SSE error event
    const errorEvent: InferStreamChunk = { done: true, error: message };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.end();
  }
});

import * as client from './capsuleClient';
import { parseLLM1Output, parseLLM3Output } from './toonParser';

export interface TurnResult {
  response: string;
  framing: string;
  topics: string[];
  turnSummary: string;  // Phase 1A: LLM3 turn summary
  conversationalNextStep: string;  // Phase 1A: LLM3 next step
}

/**
 * Handle a complete turn
 * Returns async generator to stream tokens to UI
 */
export async function* handleTurn(
  sessionId: string,
  userInput: string,
  onStatus: (status: string) => void
): AsyncGenerator<string, TurnResult, unknown> {
  try {
    // 1. Begin turn - Phase 1A: Extension A only (no B/C)
    onStatus('Starting turn...');
    const { turnId } = await client.beginTurn(sessionId, userInput, ['extension-a']);
    console.log(`[Extension A] Turn ${turnId} started`);

    // 2. Call LLM1 (Curator)
    onStatus('Analyzing context...');
    const llm1Result = await client.callLLM(
      'llm1',
      ['capsule.head', 'capsule.body', 'capsule.tail', 'intuition-outline'],
      userInput
    );

    // 3. Parse LLM1 output
    const { framing, topics, context } = parseLLM1Output(llm1Result.response);
    console.log(`[Extension A] Framing: ${framing}, Topics: ${topics.join(', ')}`);

    // 4. Update HEAD surface
    await client.updateSurface('capsule', {
      head: {
        framing,
        selectedTopics: topics,
        turnContext: context,
        userInput
      }
    });

    // 5. Stream LLM2 (Responder)
    onStatus('Generating response...');
    let fullResponse = '';

    for await (const token of client.streamLLM([
      'capsule.head',
      'capsule.body',
      'capsule.tail'
    ])) {
      fullResponse += token;
      yield token;
    }

    // 6. Update trace (AFTER accumulating full response per Sage-Architect guidance)
    await client.updateSurface('trace', {
      turnId,
      userInput,
      llm1Output: llm1Result.response,
      llm2Output: fullResponse,
      timestamp: new Date().toISOString()
    });

    // 7. Phase 1A: Call LLM3 (Turn Encoder) to create turn summary
    onStatus('Encoding turn...');
    const llm3Result = await client.callLLM(
      'llm3',
      ['capsule.head', 'trace'],  // LLM3 reads HEAD + trace
      undefined  // No userInput needed - it reads from trace
    );

    // 8. Parse LLM3 output
    const { turnSummary, conversationalNextStep } = parseLLM3Output(llm3Result.response);
    console.log(`[Extension A] Turn summary: ${turnSummary.substring(0, 50)}...`);

    // 9. Update capsule.body with turn summary (read → append → write for multi-turn context)
    // CRITICAL: This fixes the "memory leak" - turns now accumulate instead of being replaced
    const currentCapsule = await client.getSurface('capsule') as { body?: { recentTurns?: unknown[] } } | null;
    const existingTurns = currentCapsule?.body?.recentTurns || [];

    const newTurn = {
      turnId,
      userInput,
      responsePreview: fullResponse.substring(0, 200),
      summary: turnSummary,
      timestamp: new Date().toISOString()
    };

    // Append new turn, keep last 5 (sliding window)
    const updatedTurns = [...existingTurns, newTurn].slice(-5);

    await client.updateSurface('capsule', {
      body: {
        recentTurns: updatedTurns
      }
    });

    // 10. Update capsule.tail with session-level context
    // Note: For Phase 1A MVP, use simple extraction from turn summary
    await client.updateSurface('capsule', {
      tail: {
        goals: [], // TODO: Extract from LLM3 in future phase
        trajectory: `Turn ${turnId}: ${turnSummary.substring(0, 100)}`,
        pulse: 'Active'
      }
    });

    // 11. Emit completion (AFTER all surface updates per Sage-Architect guidance)
    await client.emitTurnEvent('extension-a.complete');
    console.log(`[Extension A] Turn complete, emitted extension-a.complete`);

    return { response: fullResponse, framing, topics, turnSummary, conversationalNextStep };

  } catch (error) {
    // Call failTurn on ANY error per Sage-Architect guidance
    const message = error instanceof Error ? error.message : 'Unknown error';
    await client.failTurn(message);
    throw error;
  }
}

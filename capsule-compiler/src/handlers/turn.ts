import { Request, Response } from 'express';
import { turnSequencer, TurnBeginRequest, TurnEmitRequest, TurnFailRequest } from '../turn-sequencer';
import { ErrorResponse } from '../types';

/**
 * POST /turn/begin
 * Start a new turn
 */
export async function handleTurnBegin(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId, userInput, extensionChain } = req.body as TurnBeginRequest;

    if (!sessionId) {
      res.status(400).json({
        error: { code: 'MISSING_SESSION_ID', message: 'sessionId is required' }
      } as ErrorResponse);
      return;
    }

    if (!userInput) {
      res.status(400).json({
        error: { code: 'MISSING_USER_INPUT', message: 'userInput is required' }
      } as ErrorResponse);
      return;
    }

    const context = turnSequencer.beginTurn(sessionId, userInput, extensionChain);
    res.status(201).json(context);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    if (message.includes('Turn already in progress')) {
      res.status(409).json({
        error: { code: 'TURN_IN_PROGRESS', message }
      } as ErrorResponse);
      return;
    }

    res.status(500).json({
      error: { code: 'TURN_BEGIN_FAILED', message }
    } as ErrorResponse);
  }
}

/**
 * GET /turn/context
 * Get current turn context
 */
export async function handleTurnContext(req: Request, res: Response): Promise<void> {
  const context = turnSequencer.getContext();

  if (!context) {
    res.status(404).json({
      error: { code: 'NO_ACTIVE_TURN', message: 'No active turn' }
    } as ErrorResponse);
    return;
  }

  res.json(context);
}

/**
 * POST /turn/emit
 * Emit a turn event
 */
export async function handleTurnEmit(req: Request, res: Response): Promise<void> {
  try {
    const { event } = req.body as TurnEmitRequest;

    if (!event) {
      res.status(400).json({
        error: { code: 'MISSING_EVENT', message: 'event is required' }
      } as ErrorResponse);
      return;
    }

    const validEvents = ['extension-a.complete', 'extension-b.complete', 'extension-c.complete'];
    if (!validEvents.includes(event)) {
      res.status(400).json({
        error: { 
          code: 'INVALID_EVENT', 
          message: `Invalid event. Valid events: ${validEvents.join(', ')}` 
        }
      } as ErrorResponse);
      return;
    }

    await turnSequencer.emit(event);
    
    const context = turnSequencer.getContext();
    res.json({ success: true, status: context?.status });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: { code: 'TURN_EMIT_FAILED', message }
    } as ErrorResponse);
  }
}

/**
 * POST /turn/fail
 * Mark turn as failed
 */
export async function handleTurnFail(req: Request, res: Response): Promise<void> {
  try {
    const { error } = req.body as TurnFailRequest;

    if (!error) {
      res.status(400).json({
        error: { code: 'MISSING_ERROR', message: 'error message is required' }
      } as ErrorResponse);
      return;
    }

    turnSequencer.failTurn(error);
    
    const context = turnSequencer.getContext();
    res.json({ success: true, status: context?.status, error: context?.error });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
      error: { code: 'TURN_FAIL_ERROR', message }
    } as ErrorResponse);
  }
}

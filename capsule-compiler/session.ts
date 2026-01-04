import { Request, Response } from 'express';
import { SessionResponse, ErrorResponse } from '../types';
import { createSession, sessionExists } from '../services/fileService';

// In-memory session tracking (single session for MVP)
let currentSessionId: string | null = null;

/**
 * Generate session ID
 * Format: {timestamp}-{random6}
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * GET /session/current
 */
export async function getCurrentSession(req: Request, res: Response): Promise<void> {
  if (!currentSessionId) {
    const error: ErrorResponse = {
      error: {
        code: 'NO_SESSION',
        message: 'No active session'
      }
    };
    res.status(404).json(error);
    return;
  }

  const response: SessionResponse = {
    sessionId: currentSessionId
  };
  res.json(response);
}

/**
 * POST /session/create
 */
export async function createNewSession(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = generateSessionId();
    
    await createSession(sessionId);
    currentSessionId = sessionId;

    const response: SessionResponse = {
      sessionId
    };
    res.status(201).json(response);

  } catch (error) {
    console.error('[Capsule Compiler] Session creation failed:', error);
    const errorResponse: ErrorResponse = {
      error: {
        code: 'SESSION_CREATE_FAILED',
        message: (error as Error).message
      }
    };
    res.status(500).json(errorResponse);
  }
}

/**
 * Get current session ID (for other handlers)
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

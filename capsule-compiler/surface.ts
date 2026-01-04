import { Request, Response } from 'express';
import { SurfaceGetRequest, SurfaceUpdateRequest, SurfaceResponse, ErrorResponse, SurfaceId } from '../types';
import { readSurface, writeSurface } from '../services/fileService';
import { getCurrentSessionId } from './session';

const VALID_SURFACES: SurfaceId[] = ['capsule', 'trace', 'digr', 'session-state', 'intuition-outline'];

/**
 * POST /surface/get
 */
export async function getSurface(req: Request, res: Response): Promise<void> {
  const sessionId = getCurrentSessionId();
  
  if (!sessionId) {
    const error: ErrorResponse = {
      error: {
        code: 'NO_SESSION',
        message: 'No active session'
      }
    };
    res.status(400).json(error);
    return;
  }

  const { surfaceId } = req.body as SurfaceGetRequest;

  if (!surfaceId || !VALID_SURFACES.includes(surfaceId)) {
    const error: ErrorResponse = {
      error: {
        code: 'INVALID_SURFACE',
        message: `Invalid surfaceId. Valid: ${VALID_SURFACES.join(', ')}`
      }
    };
    res.status(400).json(error);
    return;
  }

  try {
    const content = await readSurface(sessionId, surfaceId);
    const response: SurfaceResponse = {
      surfaceId,
      content
    };
    res.json(response);

  } catch (error) {
    console.error('[Capsule Compiler] Surface read failed:', error);
    const errorResponse: ErrorResponse = {
      error: {
        code: 'SURFACE_READ_FAILED',
        message: (error as Error).message
      }
    };
    res.status(500).json(errorResponse);
  }
}

/**
 * POST /surface/update
 */
export async function updateSurface(req: Request, res: Response): Promise<void> {
  const sessionId = getCurrentSessionId();
  
  if (!sessionId) {
    const error: ErrorResponse = {
      error: {
        code: 'NO_SESSION',
        message: 'No active session'
      }
    };
    res.status(400).json(error);
    return;
  }

  const { surfaceId, content } = req.body as SurfaceUpdateRequest;

  if (!surfaceId || !VALID_SURFACES.includes(surfaceId)) {
    const error: ErrorResponse = {
      error: {
        code: 'INVALID_SURFACE',
        message: `Invalid surfaceId. Valid: ${VALID_SURFACES.join(', ')}`
      }
    };
    res.status(400).json(error);
    return;
  }

  if (!content || typeof content !== 'object') {
    const error: ErrorResponse = {
      error: {
        code: 'INVALID_CONTENT',
        message: 'content must be an object'
      }
    };
    res.status(400).json(error);
    return;
  }

  try {
    await writeSurface(sessionId, surfaceId, content);
    res.json({ success: true, surfaceId });

  } catch (error) {
    console.error('[Capsule Compiler] Surface write failed:', error);
    const errorResponse: ErrorResponse = {
      error: {
        code: 'SURFACE_WRITE_FAILED',
        message: (error as Error).message
      }
    };
    res.status(500).json(errorResponse);
  }
}

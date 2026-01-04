import { Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { compileCapsule } from '../services/capsuleService';
import { getCurrentSessionId } from './session';

interface CapsuleTestRequest {
  surfaces: string[];
  userInput?: string;
}

/**
 * POST /capsule/test
 * For debugging capsule assembly
 */
export async function testCapsule(req: Request, res: Response): Promise<void> {
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
  
  const { surfaces, userInput } = req.body as CapsuleTestRequest;
  
  if (!surfaces || !Array.isArray(surfaces) || surfaces.length === 0) {
    const error: ErrorResponse = {
      error: {
        code: 'INVALID_SURFACES',
        message: 'surfaces must be a non-empty array'
      }
    };
    res.status(400).json(error);
    return;
  }
  
  try {
    const capsule = await compileCapsule(sessionId, surfaces, userInput);
    
    res.json({
      assembledText: capsule.text,
      resolvedVariables: capsule.variables.map(v => ({
        path: v.path,
        marker: v.marker,
        hasContent: v.content !== null
      }))
    });
    
  } catch (error) {
    console.error('[Capsule Compiler] Capsule assembly failed:', error);
    const errorResponse: ErrorResponse = {
      error: {
        code: 'CAPSULE_ASSEMBLY_FAILED',
        message: (error as Error).message
      }
    };
    res.status(500).json(errorResponse);
  }
}

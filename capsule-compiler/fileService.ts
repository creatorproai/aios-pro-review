import * as vscode from 'vscode';
import * as yaml from 'yaml';
import * as os from 'os';
import { SurfaceId } from '../types';

/**
 * AIOS Pro storage root: ~/.aios-sessions/
 * Global storage SEPARATE from VS Code's dataFolderName (.aios-pro)
 * 
 * CRITICAL: Do NOT use .aios-pro — that is VS Code's internal data folder
 * which stores settings, extensions, and context history.
 */
const AIOS_HOME = '.aios-sessions';

/**
 * Get AIOS Pro home directory URI (~/.aios-sessions/)
 */
export function getAiosHomeUri(): vscode.Uri {
  const homeDir = os.homedir();
  return vscode.Uri.file(`${homeDir}/${AIOS_HOME}`);
}

/**
 * Get path to session directory (~/.aios-sessions/sessions/{sessionId}/)
 */
export function getSessionUri(sessionId: string): vscode.Uri {
  const aiosHome = getAiosHomeUri();
  return vscode.Uri.joinPath(aiosHome, 'sessions', sessionId);
}

/**
 * Get path to a surface file
 */
export function getSurfaceUri(sessionId: string, surfaceId: SurfaceId): vscode.Uri {
  const sessionUri = getSessionUri(sessionId);
  return vscode.Uri.joinPath(sessionUri, `${surfaceId}.yaml`);
}

/**
 * Create ~/.aios-sessions directories if missing
 */
export async function ensureAiosDirectories(): Promise<void> {
  const aiosUri = getAiosHomeUri();
  const sessionsUri = vscode.Uri.joinPath(aiosUri, 'sessions');

  try {
    await vscode.workspace.fs.createDirectory(aiosUri);
    await vscode.workspace.fs.createDirectory(sessionsUri);
    console.log(`[Capsule Compiler] AIOS directories ensured at ${aiosUri.fsPath}`);
  } catch (error) {
    // Directories may already exist
    console.log('[Capsule Compiler] AIOS directories already exist or error:', error);
  }
}

/**
 * Create a new session directory with empty surfaces
 */
export async function createSession(sessionId: string): Promise<void> {
  const sessionUri = getSessionUri(sessionId);

  // Create session directory
  await vscode.workspace.fs.createDirectory(sessionUri);

  // Create empty surface files
  const surfaces: SurfaceId[] = ['capsule', 'trace', 'digr', 'session-state', 'intuition-outline'];
  
  for (const surfaceId of surfaces) {
    const uri = vscode.Uri.joinPath(sessionUri, `${surfaceId}.yaml`);
    const emptyContent = getEmptySurface(surfaceId);
    const encoded = new TextEncoder().encode(yaml.stringify(emptyContent));
    await vscode.workspace.fs.writeFile(uri, encoded);
  }

  console.log(`[Capsule Compiler] Session ${sessionId} created`);
}

/**
 * Get empty surface content by type
 * 
 * NOTE: trace and digr schemas updated per Sprint-Prompt Alignment (Dec 28, 2025)
 * - trace: Extended with quad, optimized, intent fields (added by LLM3A)
 * - digr: Extended with confidence, addresses, trace fields (from LLM3B)
 */
function getEmptySurface(surfaceId: SurfaceId): object {
  switch (surfaceId) {
    case 'capsule':
      return {
        head: { framing: null, selectedTopics: [], turnContext: null, userInput: null },
        body: { recentTurns: [] },
        tail: { goals: [], trajectory: null, pulse: null, planning: null }
      };
    case 'trace':
      // Extended schema: LLM3A adds quad, optimized, intent after processing
      return { 
        turnId: null, 
        userInput: null, 
        llm1Output: null, 
        llm2Output: null, 
        // Added by Extension B (LLM3A - Input Encoder)
        quad: null,       // { questions: [], uncertainties: [], aims: [], directives: [] }
        optimized: null,  // TOON-optimized user input
        intent: null,     // One-sentence intent summary
        timestamp: null 
      };
    case 'digr':
      // Extended schema: items now have confidence, addresses, trace fields
      return { 
        decisions: [],     // DIGREntry[]
        insights: [],      // DIGREntry[]
        goals: [],         // DIGREntry[] with status field
        relationships: [], // DIGREntry[] with concepts, type fields
        // Session-level metadata
        milestone: null,       // 'decision_committed' | 'symbolic_inflection' | 'step_completed' | null
        contribution: null,    // Last turn's contribution summary
        patterns: [],          // Session Integrator patterns
        refinements: []        // Session Integrator refinements
      };
    case 'session-state':
      return { lastTurnId: null, turnCount: 0, activeGoals: [], trajectory: null };
    case 'intuition-outline':
      return { 
        intuitions: [],        // IntuitionItem[] from LLM4B
        planning: null,        // { priority, nextStep, horizon }
        pulse: null,           // Living narrative from LLM4B
        suggestedFocus: null   // Focus recommendation for next turn
      };
  }
}

/**
 * Read a surface file
 */
export async function readSurface(sessionId: string, surfaceId: SurfaceId): Promise<object> {
  const uri = getSurfaceUri(sessionId, surfaceId);

  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);
    return yaml.parse(text) || {};
  } catch (error) {
    // Surface doesn't exist, return empty
    console.log(`[Capsule Compiler] Surface ${surfaceId} not found, returning empty`);
    return getEmptySurface(surfaceId);
  }
}

/**
 * Surface write strategies
 */
type WriteStrategy = 'overwrite' | 'shallow-merge' | 'array-append';

const SURFACE_STRATEGIES: Record<SurfaceId, WriteStrategy> = {
  'trace': 'overwrite',             // Current turn only - full replace
  'digr': 'array-append',           // Accumulates D/I/G/R across turns
  'intuition-outline': 'overwrite', // Pre-computed for next turn
  'capsule': 'shallow-merge',       // HEAD/BODY/TAIL sections merge
  'session-state': 'shallow-merge'  // Incremental updates
};

/**
 * Write a surface file with appropriate merge strategy
 */
export async function writeSurface(
  sessionId: string, 
  surfaceId: SurfaceId, 
  content: object
): Promise<void> {
  const uri = getSurfaceUri(sessionId, surfaceId);

  const strategy = SURFACE_STRATEGIES[surfaceId];
  let finalContent: object;

  // Read existing content for merge/append strategies
  let existing: object = {};
  if (strategy !== 'overwrite') {
    try {
      const existingBytes = await vscode.workspace.fs.readFile(uri);
      existing = yaml.parse(new TextDecoder().decode(existingBytes)) || {};
    } catch {
      existing = {};
    }
  }

  // Apply strategy
  switch (strategy) {
    case 'overwrite':
      finalContent = content;
      break;

    case 'shallow-merge':
      finalContent = { ...existing, ...content };
      break;

    case 'array-append':
      // Special handling for DIGR - append to arrays
      finalContent = mergeDigrArrays(existing, content);
      break;

    default:
      finalContent = { ...existing, ...content };
  }

  // Write final content
  const encoded = new TextEncoder().encode(yaml.stringify(finalContent));
  await vscode.workspace.fs.writeFile(uri, encoded);
  
  console.log(`[Capsule Compiler] Surface ${surfaceId} updated (${strategy})`);
}

/**
 * Merge DIGR arrays - appends new items to existing arrays
 */
function mergeDigrArrays(existing: any, incoming: any): object {
  return {
    decisions: [
      ...(existing.decisions || []),
      ...(incoming.decisions || [])
    ],
    insights: [
      ...(existing.insights || []),
      ...(incoming.insights || [])
    ],
    goals: [
      ...(existing.goals || []),
      ...(incoming.goals || [])
    ],
    relationships: [
      ...(existing.relationships || []),
      ...(incoming.relationships || [])
    ],
    // Preserve or update metadata fields
    milestone: incoming.milestone ?? existing.milestone ?? null,
    contribution: incoming.contribution ?? existing.contribution ?? null,
    patterns: [
      ...(existing.patterns || []),
      ...(incoming.patterns || [])
    ],
    refinements: [
      ...(existing.refinements || []),
      ...(incoming.refinements || [])
    ]
  };
}

/**
 * Check if session exists
 */
export async function sessionExists(sessionId: string): Promise<boolean> {
  const uri = getSessionUri(sessionId);

  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

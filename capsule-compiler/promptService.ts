import * as vscode from 'vscode';
import { LLMId, extensionContext } from '../types';

// Prompt file mapping
// Phase 1A: Added llm3 (Turn Encoder)
const PROMPT_FILES: Record<LLMId, string> = {
  llm1: 'llm1-curator.md',
  llm2: 'llm2-responder.md',
  llm3: 'llm3-encoder.md',  // Phase 1A: Turn Encoder
  llm3a: 'llm3a-quad.md',
  llm3b: 'llm3b-digr.md',
  llm4a: 'llm4a-tasks.md',
  llm4b: 'llm4b-integrator.md',
};

// Cache for loaded prompts
const promptCache: Map<LLMId, string> = new Map();

/**
 * Load system prompt for an LLM
 * Prompts are bundled with the extension in prompts/ directory
 */
export async function loadSystemPrompt(llmId: LLMId): Promise<string> {
  // Check cache first
  const cached = promptCache.get(llmId);
  if (cached) {
    return cached;
  }
  
  const filename = PROMPT_FILES[llmId];
  if (!filename) {
    throw new Error(`Unknown LLM ID: ${llmId}`);
  }
  
  // Load from extension's bundled prompts directory
  const promptUri = vscode.Uri.joinPath(extensionContext.extensionUri, 'prompts', filename);
  
  try {
    const content = await vscode.workspace.fs.readFile(promptUri);
    const prompt = new TextDecoder().decode(content);
    promptCache.set(llmId, prompt);
    return prompt;
  } catch (error) {
    console.warn(`[Prompt Service] Prompt ${filename} not found, using placeholder`);
    // Return placeholder if file not found (development/MVP)
    const placeholder = getPlaceholderPrompt(llmId);
    promptCache.set(llmId, placeholder);
    return placeholder;
  }
}

/**
 * Placeholder prompts for MVP development
 * These will be replaced with production prompts
 */
function getPlaceholderPrompt(llmId: LLMId): string {
  const placeholders: Record<LLMId, string> = {
    llm1: `You are the Curator. Your role is to select context framing for the conversation.

Analyze the provided context and determine:
1. The appropriate framing (exploratory, strategic, technical, etc.)
2. Relevant topics to focus on
3. Turn context summary

Output in TOON format:
FRAMING: [framing type]
TOPICS: [comma-separated topics]
CONTEXT: [brief context summary]`,

    llm2: `You are the Responder. Your role is to provide helpful, insightful responses to the user.

Use the provided context (HEAD, BODY, TAIL) to inform your response. Be conversational but substantive.

Respond directly to the user's needs based on the framing and context provided.`,

    llm3: `You are the Turn Encoder. Your role is to create a semantic summary of the turn for future context.

Analyze the completed turn and produce:
1. TURN_SUMMARY: A semantic compression of what happened and what mattered
2. CONVERSATIONAL_NEXT_STEP: A natural continuation that makes the user lean forward

Output format:
TURN_SUMMARY:
[semantic compression of the turn]

CONVERSATIONAL_NEXT_STEP:
[natural continuation matching user's tone]`,

    llm3a: `You are the QUAD Extractor. Extract Questions, Uncertainties, Aims, and Directives from the conversation.

Output in TOON format (one per line):
Q: [question from the conversation]
U: [uncertainty expressed]
A: [aim or goal mentioned]
D: [directive or action item]`,

    llm3b: `You are the DIGR Extractor. Extract Decisions, Insights, Goals, and Relationships from the conversation.

Output in TOON format (one per line):
D: [decision made]
I: [insight gained]
G: [goal identified]
R: [relationship between concepts]`,

    llm4a: `You are the Task Identifier. Identify tasks and action items from the conversation.

Output in TOON format (one per line):
TASK: [task description]`,

    llm4b: `You are the Integrator. Synthesize the session state and prepare context for future turns.

Output in TOON format:
GOALS: [comma-separated active goals]
TRAJECTORY: [session trajectory summary]
PULSE: [current session energy/focus]
TOPICS: [topics for next turn]
FRAMING: [suggested framing for next turn]`,
  };
  
  return placeholders[llmId] || 'You are a helpful assistant.';
}

/**
 * Clear prompt cache (for testing/development)
 */
export function clearPromptCache(): void {
  promptCache.clear();
}

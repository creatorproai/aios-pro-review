/**
 * Parse LLM1 output (TOON format)
 */
export interface LLM1Output {
  framing: string;
  topics: string[];
  context: string;
}

export function parseLLM1Output(raw: string): LLM1Output {
  const result: LLM1Output = {
    framing: 'exploratory',
    topics: [],
    context: ''
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('FRAMING:')) {
      result.framing = line.slice(8).trim();
    } else if (line.startsWith('TOPICS:')) {
      result.topics = line.slice(7).split(',').map(t => t.trim());
    } else if (line.startsWith('CONTEXT:')) {
      result.context = line.slice(8).trim();
    }
  }

  return result;
}

/**
 * Parse LLM3 output (Turn Encoder format)
 * Phase 1A: LLM3 encodes turn summary and conversational next step
 */
export interface LLM3Output {
  turnSummary: string;
  conversationalNextStep: string;
}

export function parseLLM3Output(raw: string): LLM3Output {
  const result: LLM3Output = {
    turnSummary: '',
    conversationalNextStep: ''
  };

  // Parse TURN_SUMMARY: block (multiline)
  const summaryMatch = raw.match(/TURN_SUMMARY:\s*([\s\S]*?)(?=CONVERSATIONAL_NEXT_STEP:|$)/i);
  if (summaryMatch) {
    result.turnSummary = summaryMatch[1].trim();
  }

  // Parse CONVERSATIONAL_NEXT_STEP: block (multiline)
  const nextStepMatch = raw.match(/CONVERSATIONAL_NEXT_STEP:\s*([\s\S]*?)$/i);
  if (nextStepMatch) {
    result.conversationalNextStep = nextStepMatch[1].trim();
  }

  return result;
}

/**
 * AIOS Pro - Skeletal Universal Anchor
 * Purpose: Provides 100% stable prefix for KV Cache hit across all LLM calls
 * Token count: ~45-50 tokens
 * CRITICAL: This string must NEVER change. Any modification invalidates cache.
 */

export const SKELETAL_ANCHOR = `# AIOS_PRO_SUBSTRATE_v1
[MODE: SEMANTIC_OS | PROVIDER: LOCAL]
[SUBSTRATE: QUAD/GRID | LOGIC: SYMBOLIC]

## CORE_DIRECTIVE
You will receive TWO types of content below:
1. ROLE INSTRUCTIONS — How to think and operate (follow these)
2. CAPSULE DATA — Context and user input (respond to this)

## OUTPUT_RULES (CRITICAL)
- Output ONLY your natural language response to the user
- End with exactly one line: TRACE: {one sentence summary}
- NEVER output structural markers: TURN_DATA, TURN_LOGIC, HEAD, BODY, TAIL, FRAMING, ROLE_STANCE, INSTRUCTIONS, CONTEXT
- These markers are for YOUR reference only, NOT for output
- Do not echo section headers or formatting scaffolding`.trim();

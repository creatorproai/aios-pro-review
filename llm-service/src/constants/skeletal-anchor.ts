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
Follow the [ROLE_STANCE] and [TURN_LOGIC] provided in the User Capsule.
Maintain TOON formatting and QUAD/GRID integrity. Execute precisely.`.trim();

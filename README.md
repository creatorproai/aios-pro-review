# AIOS Pro - External Review Request

**Date**: January 3, 2026  
**Status**: CRITICAL - Need External Review  
**Repository**: https://github.com/creatorproai/aios-pro-review  

---

## Executive Summary

We have been struggling for 2+ days with performance and quality issues in our LLM-based cognitive system. Despite multiple fix attempts, we are experiencing:

1. **20-30 second response times** (should be 3-5 seconds on Turn 2+)
2. **Degraded response quality** - LLM outputting internal thinking processes
3. **Hallucinations** - Model fabricating multiple user inputs in single responses
4. **Incoherent outputs** - Responses that don't address the actual user query

We need fresh eyes on this codebase to identify what we're missing.

---

## System Architecture

### Overview

AIOS Pro is a VS Code-based cognitive operating system that uses local LLMs (via Ollama) for intelligent conversation. The architecture uses:

- **Ollama** (port 11434) - Local LLM backend
- **llm-service** (port 3456) - TypeScript service wrapping Ollama API
- **Capsule-Compiler** (VS Code extension) - Orchestrates LLM calls
- **AIOS-Chat** (VS Code extension) - User-facing chat UI

### Data Flow

```
User Input
    ↓
AIOS-Chat (VS Code Extension)
    ↓
Capsule-Compiler (:11436)
    ↓ HTTP
llm-service (:3456)
    ↓ HTTP
Ollama (:11434)
    ↓
aios-pro-8k model (Mistral-based)
```

---

## Current Problems

### Problem 1: 20-30 Second Response Times

**Expected**: Turn 1 = 5-7s, Turn 2+ = 3-5s (KV cache hit)
**Actual**: Every turn takes 20-30 seconds

**Hypothesis**: KV cache is not working. The skeletal anchor (~50 tokens) is being re-processed on every turn instead of being cached.

**What we tried**:
1. Added `num_keep 64` to Modelfile (should lock first 64 tokens in KV cache)
2. Added `SYSTEM` directive to Modelfile (learned this only works for `/api/generate`, not `/api/chat`)
3. Environment variables: `OLLAMA_KEEP_ALIVE=-1`, `OLLAMA_KV_CACHE_TYPE=q8_0`
4. System message in API vs Modelfile (back and forth)

### Problem 2: LLM Outputting Internal Thinking

**Symptom**: Responses include sections like:
- "Let me think about this..."
- "TRACE: [internal processing notes]"
- Raw structured data that should be internal

**Hypothesis**: The role prompts or capsule structure is confusing the model about what to output.

### Problem 3: Hallucinated User Inputs

**Symptom**: Model responds as if the user sent multiple messages, fabricating conversation that didn't happen.

**Hypothesis**: The capsule structure (which includes recent turn history) may be confusing the model about what's new input vs. context.

### Problem 4: Incoherent Responses

**Symptom**: Responses don't address the actual user question, or are filled with nonsensical content.

**Hypothesis**: Something in our prompt structure or fusing of role+data is breaking the model's understanding.

---

## Key Files for Review

### 1. llm-service/src/services/ollama.ts

This is the core file that calls Ollama. Key aspects:

- **Skeletal Anchor**: Constant system message (~50 tokens) meant to be cached
- **Fused User Payload**: Combines role prompt + turn data into single user message
- **Architecture**: `system: SKELETAL_ANCHOR` + `user: role + capsule_data`

**Key question**: Is our message structure correct for Ollama's `/api/chat` endpoint?

### 2. llm-service/src/constants/skeletal-anchor.ts

The constant system message we send on every turn. Should be cached by `num_keep 64`.

### 3. capsule-compiler/prompts/

Role-specific prompts for different LLM roles:
- `llm1-curator.md` - Cognitive Curator
- `llm2-responder.md` - Insight Architect (streams to user)
- `llm3-encoder.md` - Memory Encoder

**Key question**: Are these prompts structured correctly? Are they causing the model to output internal thinking?

### 4. ollama/Modelfile-aios-pro-8k

Custom Ollama model configuration:
- `num_keep 64` - Lock first 64 tokens in KV cache
- `num_ctx 4096` - Context window
- `temperature 0.7`

**Key question**: Is `num_keep` working as expected with `/api/chat`?

### 5. aios-chat/src/turnHandler.ts

Handles the conversation flow in the VS Code extension.

### 6. capsule-compiler/src/services/capsuleService.ts

Assembles the "capsule" - the structured data sent to the LLM.

---

## Attempted Fixes (All Failed)

### Attempt 1: Modelfile SYSTEM Directive

**Theory**: Bake the anchor into the model itself using Modelfile's `SYSTEM` directive.

**What we did**:
```dockerfile
SYSTEM """# AIOS_PRO_SUBSTRATE_v1
[MODE: SEMANTIC_OS | PROVIDER: LOCAL]
..."""
```

**Result**: FAILED - `/api/chat` doesn't use Modelfile's `SYSTEM` directive. Only `/api/generate` does.

### Attempt 2: Remove System Message from API

**Theory**: If anchor is in Modelfile, don't send it via API.

**What we did**: Removed system message from `messages` array in `ollama.ts`.

**Result**: CATASTROPHIC FAILURE - Model had no context, output garbage.

### Attempt 3: Restore System Message + num_keep

**Theory**: Send system message via API, let `num_keep` cache it.

**What we did**: 
- System message back in API
- Removed `SYSTEM` from Modelfile
- Kept `num_keep 64`

**Result**: Still 20-30s response times, plus degraded quality.

---

## Environment Details

- **Machine**: M4 MacBook Air, 16GB RAM
- **Node.js**: v22.20.0
- **Ollama**: Latest
- **Base Model**: mistral:instruct
- **Custom Model**: aios-pro-8k

---

## What We Need Help With

1. **Why isn't KV caching working?**
   - Is `num_keep` effective with `/api/chat`?
   - Are we structuring messages correctly?

2. **Why is response quality degraded?**
   - Is the fused `role + capsule` format confusing the model?
   - Are the role prompts too complex?

3. **Is our architecture fundamentally flawed?**
   - Should we use `/api/generate` instead of `/api/chat`?
   - Is there a simpler approach?

---

## Quick Test

To test the llm-service directly:

```bash
# Start llm-service (requires Ollama running)
cd llm-service
npm install
npm run dev

# Test endpoint
curl -X POST http://localhost:3456/infer \
  -H "Content-Type: application/json" \
  -d '{
    "rolePrompt": "You are a helpful assistant.",
    "userMessage": "What is 2+2?"
  }'
```

---

## Contact

Please open issues on this repository or reach out directly.

Thank you for any help you can provide.

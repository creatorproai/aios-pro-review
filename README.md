# AIOS Pro Review — Sprint 1A Stable

**Branch**: sprint-1a  
**Date**: January 4, 2026  
**Status**: Stable baseline for token optimization work  

---

## Contents

This repository contains the core working files for AIOS Pro chat functionality:

### llm-service/
- `ollama.ts` — Ollama API client with rotating system prompts
- `skeletal-anchor.ts` — Skeletal anchor constant (retained for reference)
- `infer.ts` — Inference route handler
- `server.ts` — Express server

### capsule-compiler/
- `prompts/` — LLM system prompts (llm1-curator, llm2-responder, llm3-encoder, etc.)
- `*Service.ts` — Core services (capsule, prompt, llm, file, retry)
- `*.ts` — Request handlers (llm-process, llm-stream, turn, session, surface, health)

### aios-chat/
- `turnHandler.ts` — Turn processing logic
- `capsuleClient.ts` — HTTP client to capsule-compiler
- `chatPanel.ts` — Webview panel for chat UI

### ollama/
- `Modelfile-aios-pro-8k` — Custom Ollama model configuration

---

## Architecture

This is **Phase 1A** — working baseline with:
- **Rotating system prompts** (full role prompts as system messages)
- **8K context window** (aios-pro-8k model)
- **Extension A only** (no background Extensions B/C)

---

## Next Steps

Token optimization strategy TBD — preserving reasoning quality from rotating system prompts while reducing response latency.

---

*For external review and collaboration.*

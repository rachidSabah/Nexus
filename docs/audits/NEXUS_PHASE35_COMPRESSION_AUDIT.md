# NEXUS PHASE 35 — CONTEXT & PROMPT COMPRESSION AUDIT

## 1. Overview

Intelligent context optimization guarantees minimum token burn while rigorously protecting critical security, system directives, and structured output constraints.

---

## 2. Compression Engine Architecture

### 2.1 Multi-Layer Pipeline (`@anx/token-efficiency` & `@anx/core`)
1. **Exact Deduplication**: Hash-based message and content deduplication.
2. **System Prompt Dedup**: Shared system instructions deduplicated across turns.
3. **Stop-Word & Whitespace Optimization**: Redundant whitespace and non-semantic noise reduction.
4. **Tool Schema Compaction**: Stripping non-essential description verbosity while preserving type constraints.
5. **Tool Output Compaction**: Trimming repetitive stack traces and large command outputs.
6. **Conversation Summarization**: Rolling compaction of older history when exceeding thresholds.

### 2.2 Semantic Invariant Guarantees
The compression pipeline guarantees preservation of:
- System security instructions and guardrails.
- Authorization and policy boundaries.
- Required JSON schemas and tool definitions.
- Mission acceptance criteria.

---

## 3. Endpoints & Preview Capabilities

- **GET `/v1/context/compression`**: Returns enabled strategies, total tokens saved, and per-request savings.
- **POST `/v1/context/compression/preview`**: Provides pre-flight token compression analysis, showing original tokens, optimized tokens, compression ratio, semantic preservation score, and estimated cost reduction.

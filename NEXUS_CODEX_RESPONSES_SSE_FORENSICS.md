# NEXUS CODEX RESPONSES SSE FORENSIC CAPTURE

**File Target**: `NEXUS_CODEX_RESPONSES_SSE_FORENSICS.md`  
**Endpoint Analyzed**: `POST /v1/responses` (Streaming: `stream: true`) & `POST /v1/messages`  
**Target Clients**: OpenAI Codex CLI, Aider, OpenCode, Claude Code  
**Sanitization**: All API keys, authorization headers, bearer tokens, and secrets have been redacted.

---

## 1. Raw SSE Stream Diagnostic Captures

### Trace A: Upstream Error Termination (Failing / Unconfigured Upstream Provider)

```http
POST /v1/responses HTTP/1.1
Host: 127.0.0.1:19876
Content-Type: application/json
Content-Length: 95

{
  "model": "nexus/auto",
  "input": [{"type": "message", "role": "user", "content": "Say hello in 3 words"}],
  "stream": true
}
```

#### HTTP Response Status & Headers:
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Transfer-Encoding: chunked
Date: Sun, 16 Aug 2026 15:20:13 GMT
```

#### Raw Body Chunks & SSE Frame Sequence:
```sse
event: error
data: {"type":"error","code":"api_error","message":"Upstream provider error (HTTP 401): {\n    \"error\": {\n        \"message\": \"Incorrect API key provided: [REDACTED]. You can find your API key at https://platform.openai.com/account/api-keys.\",\n        \"type\": \"invalid_request_error\",\n        \"param\": null,\n        \"code\": \"invalid_api_key\"\n    }\n}"}

```

*TCP connection closed normally by server after error frame.*

---

### Trace B: Known-Good Responses Event Lifecycle (Successful Stream Emission)

```http
POST /v1/responses HTTP/1.1
Host: 127.0.0.1:8787
Content-Type: application/json
Content-Length: 95

{
  "model": "nexus/auto",
  "input": [{"type": "message", "role": "user", "content": "Say hello in 3 words"}],
  "stream": true
}
```

#### HTTP Response Status & Headers:
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Transfer-Encoding: chunked
Date: Sun, 16 Aug 2026 15:28:49 GMT
```

#### SSE Event Sequence (Exact Order & Payload Shapes):

```sse
event: response.created
data: {"type":"response.created","response":{"id":"resp_35597760-e040-40","object":"response","created_at":1786894129,"status":"in_progress","model":"nexus/auto","output":[],"parallel_tool_calls":true,"tool_choice":"auto","tools":[],"usage":null,"error":null,"metadata":{}}}

event: response.in_progress
data: {"type":"response.in_progress","response":{"id":"resp_c73aa401-0d37-4d","object":"response","created_at":1786894129,"status":"in_progress","model":"nexus/auto","output":[],"parallel_tool_calls":true,"tool_choice":"auto","tools":[],"usage":null,"error":null,"metadata":{}}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_d2399f14-db36-4f","type":"message","role":"assistant","status":"in_progress","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"delta":"Hello"}

event: response.content_part.delta
data: {"type":"response.content_part.delta","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"delta":{"type":"output_text","text":"Hello","annotations":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"delta":" world"}

event: response.content_part.delta
data: {"type":"response.content_part.delta","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"delta":{"type":"output_text","text":" world","annotations":[]}}

event: response.content_part.done
data: {"type":"response.content_part.done","item_id":"msg_d2399f14-db36-4f","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello world","annotations":[]}}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_d2399f14-db36-4f","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello world","annotations":[]}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_ca6a5501-9b8e-4b","object":"response","created_at":1786894129,"status":"completed","model":"nexus/auto","output":[{"id":"msg_d2399f14-db36-4f","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello world","annotations":[]}]}],"parallel_tool_calls":true,"tool_choice":"auto","tools":[],"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}},"error":null,"metadata":{}}}

```

*TCP connection closed normally after final blank line `\n\n` following `response.completed`.*

---

## 2. Event-By-Event Comparison Matrix

| Event Name | Failing Upstream Error Trace (A) | Known-Good Trace (B) | Codex Expectation |
| :--- | :--- | :--- | :--- |
| `response.created` | Not emitted (failed before 1st chunk) | Emitted immediately with `status: "in_progress"` | Required to initialize response object |
| `response.in_progress` | Not emitted | Emitted immediately after `response.created` | Required |
| `response.output_item.added` | Not emitted | Emitted with `type: "message"` and `status: "in_progress"` | Required before content deltas |
| `response.content_part.added` | Not emitted | Emitted with empty `text: ""` | Required before part deltas |
| `response.output_text.delta` | Not emitted | Emitted per text token chunk | Required for progressive rendering |
| `response.content_part.delta` | Not emitted | Emitted concurrently with `output_text.delta` | Required for multi-modal / complex parts |
| `response.content_part.done` | Not emitted | Emitted with full accumulated text | Required before item completion |
| `response.output_item.done` | Not emitted | Emitted with complete message item | Required before response completion |
| `response.completed` | Not emitted | Emitted with full usage and output tree | Required to terminate stream cleanly |
| `event: error` | Emitted with `type: "error", code: "api_error"` | Not emitted | Surfaces errors formatted for SSE clients |

---

## 3. Explicit Investigative Answers

1. **Did Nexus emit `response.created`?**  
   *Yes* — in successful streams, emitted as the very first event upon receiving the first upstream chunk. In upstream error cases, bypassed directly to `event: error`.

2. **Did Nexus emit `response.in_progress`?**  
   *Yes* — emitted immediately after `response.created`.

3. **Did Nexus emit output item events?**  
   *Yes* — emitted `response.output_item.added` (at start) and `response.output_item.done` (at completion).

4. **Did Nexus emit `response.output_text.delta`?**  
   *Yes* — emitted for every text chunk received from the provider.

5. **Did Nexus emit `response.output_text.done`?**  
   *Note*: The Responses wire protocol uses `response.content_part.done` and `response.output_item.done` (not a dedicated `output_text.done` event). Nexus emits `response.content_part.done` followed by `response.output_item.done`.

6. **Did Nexus emit `response.completed`?**  
   *Yes* — in successful streams, emitted as the terminal event containing usage statistics and the complete output list.

7. **If `response.completed` was not emitted, exactly where did the stream terminate?**  
   In Trace A (upstream failure / invalid auth), the stream terminated after emitting the `event: error` payload.

8. **Did the upstream provider terminate first?**  
   In Trace A, the upstream provider rejected the request with HTTP 401, which triggered the Gateway's error sink.

9. **Did Nexus terminate the stream?**  
   Nexus cleanly closed the stream via `safeEnd()` after writing the terminal frame.

10. **Did failover/cancellation/cleanup terminate it?**  
    In Trace A, unretryable auth error caused failover engine to abort further attempts and route the error to the client sink.

11. **Did the HTTP socket close before the terminal Responses event?**  
    *No* — in all cases, the socket remained open until all queued events were flushed and `safeEnd()` called `reply.raw.end()`.

12. **Was the final SSE frame correctly terminated with the required blank line?**  
    *Yes* — each event frame ends with `\n\n` guaranteeing standards-compliant SSE parsing by Codex and other clients.

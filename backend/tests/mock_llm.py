"""Minimal OpenAI-compatible mock server for local testing of the AI assistant.

Run:  .venv/bin/uvicorn tests.mock_llm:app --port 8099
Then configure the assistant with base URL http://127.0.0.1:8099/v1, chat model "mock-chat",
embedding model "mock-embed". It answers deterministically from the numbered sources it receives,
supports streaming, tool calls (get_requirement_status when a requirement number is asked about)
and bag-of-words hashing embeddings (256 dimensions).
"""

import hashlib
import json
import math
import re
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
DIM = 256


def embed(text: str) -> list[float]:
    v = [0.0] * DIM
    for w in re.findall(r"[a-zäöüß0-9]{3,}", text.lower()):
        h = int(hashlib.md5(w.encode()).hexdigest(), 16)
        v[h % DIM] += 1.0 if (h >> 8) % 2 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [{"id": "mock-chat", "object": "model"}, {"id": "mock-embed", "object": "model"}],
    }


@app.post("/v1/embeddings")
async def embeddings(req: Request):
    body = await req.json()
    inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
    return {
        "object": "list",
        "model": body.get("model"),
        "data": [{"object": "embedding", "index": i, "embedding": embed(t)} for i, t in enumerate(inputs)],
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


def compose_answer(messages: list[dict]) -> str:
    user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    tool_texts = [m["content"] for m in messages if m["role"] == "tool"]
    blob = user + "\n\n" + "\n\n".join(tool_texts)
    question = user.split("Question:", 1)[-1].strip()
    sources = re.findall(r"^\[(\d+)\] \(([^)]+)\) (.+)$", blob, flags=re.M)
    if "evidence check" in json.dumps(messages):
        pts = re.findall(r"^\(([a-z])\)", user, flags=re.M) or ["a"]
        return json.dumps(
            {
                "check_points": [
                    {
                        "point": f"({p})",
                        "verdict": ["covered", "partial", "missing"][i % 3],
                        "quote": "" if i % 3 == 2 else "mock quote from the linked document",
                        "document": "" if i % 3 == 2 else "Linked document",
                        "comment": "Mock assessment.",
                    }
                    for i, p in enumerate(pts)
                ],
                "overall": "partial",
                "missing_elements": ["Mock: element not found in the documents"],
                "summary": "Mock evidence check. Configure a real model for meaningful results.",
            }
        )
    if "Respond with a single JSON object" in json.dumps(messages):
        return json.dumps(
            {
                "gap_description": "The practice exists but is not documented in an approved procedure and its effectiveness has not been tested.",
                "recommended_action": "Document the procedure, have it approved by the ISO and schedule a first effectiveness test.",
                "acceptance_criterion": "Approved procedure published; first test performed and recorded.",
                "expected_evidence": "Approved procedure document; test record.",
                "effort": "Medium",
                "summary": "- Mock summary line 1\n- Mock summary line 2",
                "key_obligations": ["Mock obligation"],
                "nis2_topics": ["policies"],
                "suggested_tags": ["mock"],
            }
        )
    if not sources:
        return (
            "I could not find anything about this in the tool. You may want to record it in a document or an "
            "assessment answer."
        )
    lines = [f"Here is what I found for: *{question[:120]}*", ""]
    for n, label, title in sources[:4]:
        lines.append(f"- {label}: **{title.strip()[:100]}** [{n}]")
    lines.append("")
    lines.append(
        f"The most relevant source is [{sources[0][0]}]. (Mock model – configure a real endpoint for real answers.)"
    )
    return "\n".join(lines)


@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    messages = body["messages"]
    now = int(time.time())
    has_tool_results = any(m["role"] == "tool" for m in messages)
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    question = last_user.split("Question:", 1)[-1]
    req_no = re.search(r"\b(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b", question)
    if body.get("tools") and not has_tool_results and req_no and not body.get("stream"):
        call = {
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "get_requirement_status",
                "arguments": json.dumps({"requirement_number": req_no.group(1)}),
            },
        }
        return {
            "id": "mock",
            "object": "chat.completion",
            "created": now,
            "model": body["model"],
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "tool_calls",
                    "message": {"role": "assistant", "content": None, "tool_calls": [call]},
                }
            ],
        }
    text = compose_answer(messages)
    if not body.get("stream"):
        return JSONResponse(
            {
                "id": "mock",
                "object": "chat.completion",
                "created": now,
                "model": body["model"],
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }
        )

    async def gen():
        for tok in re.findall(r"\S+\s*", text):
            chunk = {
                "id": "mock",
                "object": "chat.completion.chunk",
                "created": now,
                "model": body["model"],
                "choices": [{"index": 0, "delta": {"content": tok}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
        end = {
            "id": "mock",
            "object": "chat.completion.chunk",
            "created": now,
            "model": body["model"],
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(end)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

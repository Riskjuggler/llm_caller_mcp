#!/usr/bin/env python3
"""UAT helper for exercising the MCP transport endpoints."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Iterable, Optional

HOST = os.getenv("LLM_CALLER_HOST", "127.0.0.1")
PORT = int(os.getenv("LLM_CALLER_PORT", "4037"))
ROOT_URL = f"http://{HOST}:{PORT}"
BASE_URL = f"{ROOT_URL}/mcp"
CLIENT_TOKEN = os.getenv("UAT_CLIENT_TOKEN", "secret-token")
DEFAULT_PROVIDER = os.getenv("UAT_PROVIDER", "lmstudio")

CHAT_MESSAGES = [
    {"role": "user", "content": "Hello MCP server!"},
    {"role": "assistant", "content": "(placeholder history)"},
    {"role": "user", "content": "Tell me a joke about rate limiting."},
]

STREAM_MESSAGES = [
    {"role": "user", "content": "Stream a short poem about telemetry."}
]

EMBED_INPUTS = ["Embed this prompt for testing"]


def http_request(
    method: str,
    path: str,
    payload: Optional[dict] = None,
    stream: bool = False,
    headers: Optional[dict] = None,
    base: str = "mcp",
) -> Iterable[str] | tuple[int, str]:
    if base == "root":
        url = f"{ROOT_URL}{path}"
    elif base == "absolute":
        url = path
    else:
        url = f"{BASE_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("x-llm-caller-token", CLIENT_TOKEN)
    req.add_header("Content-Type", "application/json")
    if headers:
        for key, value in headers.items():
            req.add_header(key, value)

    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        return err.code, body

    if stream:
        def line_iterator():
            for raw_line in resp:
                yield raw_line.decode("utf-8", errors="replace").rstrip()
        return line_iterator()

    status = resp.getcode()
    body = resp.read().decode("utf-8", errors="replace")
    return status, body


def run_chat() -> None:
    print("\n=== Chat ===")
    payload = {
        "requestId": "uat-chat-1",
        "callerTool": "uat-tool",
        "messages": CHAT_MESSAGES,
    }
    status, body = http_request("POST", "/chat", payload)
    print(f"Status: {status}")
    print("Body:")
    print(body)


def run_chat_stream() -> None:
    print("\n=== Chat Stream ===")
    payload = {
        "requestId": "uat-stream-1",
        "callerTool": "uat-tool",
        "messages": STREAM_MESSAGES,
    }
    stream = http_request("POST", "/chatStream", payload, stream=True)
    for line in stream:
        print(line)


def run_embed() -> None:
    print("\n=== Embed ===")
    payload = {
        "requestId": "uat-embed-1",
        "callerTool": "uat-tool",
        "inputs": EMBED_INPUTS,
    }
    status, body = http_request("POST", "/embed", payload)
    print(f"Status: {status}")
    print("Body:")
    print(body)


def run_rate_limit_demo() -> None:
    """Fire several chat requests quickly to demonstrate throttling."""
    print("\n=== Rate limit demo ===")
    for idx in range(3):
        payload = {
            "requestId": f"uat-rate-{idx}",
            "callerTool": "uat-tool",
            "messages": [{"role": "user", "content": f"Ping #{idx}"}],
        }
        status, body = http_request("POST", "/chat", payload)
        print(f"Call {idx + 1} status: {status}")
        print(body)
        # Sleep a bit to observe behavior across the configured window
        if idx == 0:
            time.sleep(0.2)

def run_models(provider: str) -> None:
    print("\n=== Models ===")
    status, body = http_request("GET", f"/models?provider={provider}", base="mcp")
    print(f"Status: {status}")
    print("Body:")
    print(body)


def run_health() -> None:
    print("\n=== Health ===")
    status, body = http_request("GET", "/health", base="root")
    print(f"Status: {status}")
    print("Body:")
    print(body)


def main() -> None:
    print(f"Using base URL: {BASE_URL}")
    print(f"Client token: {CLIENT_TOKEN}\n")
    run_chat()
    run_chat_stream()
    run_embed()
    run_models(DEFAULT_PROVIDER)
    run_health()
    run_rate_limit_demo()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)

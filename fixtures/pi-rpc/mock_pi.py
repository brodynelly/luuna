"""SYNTHETIC Pi 1.3.0 protocol fixture, never a model/provider substitute.

Only test code launches this program. Production defaults to the genuine Pi CLI.
"""
import json
import os
import sys
import time

if "--version" in sys.argv:
    print("1.3.0")
    sys.exit(0)

if "--stall-stdin" in sys.argv:
    time.sleep(60)


def send(value):
    print(json.dumps(value), flush=True)


for line in sys.stdin:
    command = json.loads(line)
    kind, request_id = command["type"], command["id"]
    if kind == "get_state":
        send({"type": "response", "id": request_id, "command": kind,
              "success": True, "data": {"isStreaming": False}})
    elif kind == "prompt":
        scenario = command.get("message", "success")
        if scenario == "malformed":
            print("not-json", flush=True)
            continue
        if scenario == "crash":
            sys.exit(23)
        if scenario == "wrong_id":
            request_id = "unrecognized-command"
        if scenario == "env_names":
            # Names only: proves alias mapping without ever echoing a value.
            send({"type": "fixture_env", "names": sorted(
                name for name in os.environ if name.endswith("_API_KEY"))})
            scenario = "success"
        if scenario == "rejected":
            send({"type": "response", "id": request_id, "command": kind,
                  "success": False, "error": "synthetic rejection"})
            continue
        send({"type": "response", "id": request_id, "command": kind,
              "success": True, "data": {"disposition": "started"}})
        send({"type": "agent_start"})
        malformed_completions = {
            "malformed_settled": {"type": "agent_settled"},
            "invalid_settled_aborted": {"type": "agent_settled", "aborted": "false"},
            "malformed_agent_end": {"type": "agent_end", "messages": []},
            "malformed_message_end": {"type": "message_end", "message": None},
        }
        if scenario in malformed_completions:
            send(malformed_completions[scenario])
            send({"type": "agent_settled", "aborted": False})
            continue
        if scenario == "slow":
            continue
        if scenario in ("provider_error", "retry_success"):
            message = {"role": "assistant", "stopReason": "error",
                       "errorMessage": "synthetic provider unavailable"}
            send({"type": "message_end", "message": message})
            send({"type": "agent_end", "messages": [message],
                  "willRetry": scenario == "retry_success"})
        if scenario != "provider_error":
            send({"type": "future_event", "payload": "unknown events survive"})
            send({"type": "message_update", "assistantMessageEvent":
                  {"type": "text_delta", "contentIndex": 0, "delta": "hello\u2028world"}})
            message = {"role": "assistant", "stopReason": "stop",
                       "content": [{"type": "text", "text": "hello\u2028world"}]}
            send({"type": "message_end", "message": message})
            send({"type": "agent_end", "messages": [message], "willRetry": False})
        if scenario != "end_without_settled":
            send({"type": "agent_settled", "aborted": False})
    elif kind == "abort":
        send({"type": "response", "id": request_id, "command": kind, "success": True})
        send({"type": "agent_settled", "aborted": True})

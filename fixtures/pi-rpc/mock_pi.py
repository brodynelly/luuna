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


def flag(name):
    """Value following a command-line flag, if present."""
    if name in sys.argv:
        index = sys.argv.index(name)
        if index + 1 < len(sys.argv):
            return sys.argv[index + 1]
    return None


def writer_scenario():
    """Writer sessions name their synthetic scenario inside the system prompt
    and the prompt (`fixture:<name>`); the runtime never sends scenario names."""
    text = flag("--system-prompt") or ""
    marker = text.find("fixture:")
    if marker < 0:
        return None
    name = text[marker + len("fixture:"):].split()[0].strip(".,;")
    return name


def write_file(relative, content):
    path = os.path.join(os.getcwd(), relative)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    send({"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "write",
          "args": {"path": relative, "content": content}})
    send({"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "write",
          "result": {"content": [{"type": "text", "text": "written"}]}, "isError": False})


def usage(cost):
    return {"input": 100, "output": 10, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 110,
            "cost": {"input": cost / 2, "output": cost / 2, "cacheRead": 0, "cacheWrite": 0, "total": cost}}


def run_writer(request_id, kind, scenario):
    """Synthetic writer behaviour inside the cwd the runtime assigned."""
    send({"type": "fixture_args", "tools": flag("--tools"), "extensions": [
        sys.argv[i + 1] for i, a in enumerate(sys.argv) if a in ("-e", "--extension")],
        "scope": json.loads(os.environ.get("LUUNA_SCOPE_JSON", "null")),
        "no_tools": "--no-tools" in sys.argv})
    send({"type": "response", "id": request_id, "command": kind,
          "success": True, "data": {"disposition": "started"}})
    send({"type": "agent_start"})
    cost = 0.0005
    if scenario == "slow":
        time.sleep(60)
    elif scenario == "write_in_scope":
        write_file("src/main.py", "print('implemented by the synthetic writer')\n")
    elif scenario == "write_out_of_scope":
        write_file("src/main.py", "print('changed')\n")
        write_file("README.md", "tampered outside the task paths\n")
    elif scenario == "expensive":
        cost = 5.0
        write_file("src/main.py", "print('expensive')\n")
    elif scenario == "no_change":
        pass
    message = {"role": "assistant", "stopReason": "stop", "usage": usage(cost),
               "content": [{"type": "text", "text": f"synthetic writer finished {scenario}"}]}
    send({"type": "message_update", "usage": usage(cost), "assistantMessageEvent":
          {"type": "text_delta", "contentIndex": 0, "delta": "done"}})
    send({"type": "message_end", "message": message})
    send({"type": "agent_end", "messages": [message], "willRetry": False})
    send({"type": "agent_settled", "aborted": False})


for line in sys.stdin:
    command = json.loads(line)
    kind, request_id = command["type"], command["id"]
    if kind == "get_state":
        send({"type": "response", "id": request_id, "command": kind,
              "success": True, "data": {"isStreaming": False}})
    elif kind == "prompt" and writer_scenario() is not None:
        run_writer(request_id, kind, writer_scenario())
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

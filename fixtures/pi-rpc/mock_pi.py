"""SYNTHETIC Pi 1.3.0 protocol fixture, never a model/provider substitute.

Only test code launches this program. Production defaults to the genuine Pi CLI.
"""
import json
import os
import re
import sys
import time

if "--version" in sys.argv:
    # `--require-isolated-version`: answer only when the probe runs with the
    # session's private agent directory, never the user's own Pi config.
    isolated = os.environ.get("PI_CODING_AGENT_DIR") and os.environ.get("HOME") == os.environ.get("PI_CODING_AGENT_DIR")
    print("1.3.0" if isolated or "--require-isolated-version" not in sys.argv else "unisolated")
    sys.exit(0)

if "--fail-startup" in sys.argv:
    # Pi reports startup failures (an unknown provider, a broken extension)
    # only on stderr before exiting; the token and URL credential are redacted.
    sys.stderr.write("Loading extensions\nproxy https://luuna:proxy-password@proxy.invalid:8080\n"
                     "Authorization: Bearer sk-synthetic0123456789abcdefghijklmnop\n"
                     'Error: Unknown provider "nosuchprovider". Use --list-models to see available providers/models.\n')
    sys.stderr.flush()
    sys.exit(1)

if "--stall-stdin" in sys.argv:
    time.sleep(60)


def send(value):
    print(json.dumps(value), flush=True)


def flag(name):
    """Value following a command-line flag, if present. As in Pi 1.3.0, a
    `--system-prompt` that names an existing file means that file's text."""
    if name in sys.argv:
        index = sys.argv.index(name)
        if index + 1 < len(sys.argv):
            value = sys.argv[index + 1]
            if name == "--system-prompt" and os.path.isfile(value):
                with open(value, encoding="utf-8") as handle:
                    return handle.read()
            return value
    return None


def bulky_text(size):
    """A tool result as large as Pi's own 50 KB read truncation allows."""
    return ("x" * 99 + "\n") * (size // 100)


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
    # OPEN_EXISTING also permits the hidden worktree gitfile on Windows.
    with open(path, "r+" if os.path.isfile(path) else "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.truncate()
    send({"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "write",
          "args": {"path": relative, "content": content}})
    send({"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "write",
          "result": {"content": [{"type": "text", "text": "written"}]}, "isError": False})


def usage(cost):
    return {"input": 100, "output": 10, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 110,
            "cost": {"input": cost / 2, "output": cost / 2, "cacheRead": 0, "cacheWrite": 0, "total": cost}}


def verify_component_context(resources, visible_text):
    """Assert only the smoke's explicit, approved resources reach a session."""
    assert len(resources["memory"]) == 1, "Unexpected memory attachment"
    memory = resources["memory"][0]
    assert memory["scope"] == "project"
    assert memory["content"] == "Prefer exact candidate checks."
    assert memory["provenance"] == "Synthetic m6 smoke fixture"
    assert resources["prompt"]["name"] == "writer-guidance"
    assert resources["prompt"]["version"] == 2
    assert resources["prompt"]["body"] == "## guidance\nUse the exact approved task scope and minimal edits.\n"
    assert "Private user fixture" not in visible_text, "Unselected private memory reached Pi"
    send({"type": "fixture_component_context", "selected_memory": True,
          "selected_prompt": True, "unselected_private_memory_absent": True})


def run_reviewer(request_id, kind, message):
    """Independent read-only fixture. This never calls run_writer, even when
    the ticket contains its original writer scenario marker."""
    payload = json.loads(message)
    markers = re.findall(r"fixture:([a-z_]+)", json.dumps(payload.get("requirements", {})))
    if "component_context" in markers:
        verify_component_context(payload["approved_component_resources"], message + (flag("--system-prompt") or ""))
    scenario = next((name for name in markers if name.startswith("review_")), "review_pass")
    if scenario == "review_malformed_once":
        # Malformed output for the candidate's first validation generation and
        # a valid pass for every later one, so a fresh generation after an
        # invalid review is exercised against one immutable ticket.
        scenario = "review_malformed" if payload.get("validation_generation", 1) == 1 else "review_pass"
    send({"type": "fixture_args", "tools": flag("--tools"), "extensions": [
        sys.argv[i + 1] for i, arg in enumerate(sys.argv) if arg in ("-e", "--extension")],
        "scope": json.loads(os.environ.get("LUUNA_SCOPE_JSON", "null")),
        "no_tools": "--no-tools" in sys.argv,
        "reviewer": True})
    send({"type": "response", "id": request_id, "command": kind,
          "success": True, "data": {"disposition": "started"}})
    send({"type": "agent_start"})
    if scenario == "review_extension_error":
        send({"type": "extension_error", "extensionPath": "luuna-scope-guard.js",
              "event": "tool_call", "error": "synthetic scope guard failure"})
    if scenario == "review_hold":
        time.sleep(60)
    if scenario == "review_crash":
        # Accepted model work that never reports its usage: the process exits
        # mid-turn, as a lost transport or a crashed Pi would.
        sys.exit(9)
    if scenario == "review_retry":
        # A transient provider error that Pi retries itself, in Pi 1.3.0's
        # order: the errored message, `agent_end` with `willRetry`, the retry.
        failed = {"role": "assistant", "stopReason": "error", "usage": usage(0.0001),
                  "errorMessage": "529 overloaded_error: Overloaded"}
        send({"type": "message_end", "message": failed})
        send({"type": "agent_end", "messages": [failed], "willRetry": True})
        send({"type": "auto_retry_start", "attempt": 1, "maxAttempts": 3, "delayMs": 0,
              "errorMessage": "529 overloaded_error: Overloaded"})
    if scenario == "review_stream":
        # A streamed answer: one cumulative-usage update per delta.
        for index in range(40):
            send({"type": "message_update", "usage": usage(0.0005 * (index + 1) / 40),
                  "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "."}})
    review = {"schema_version": "0.1", "id": "review-fixture",
              "candidate_hash": payload.get("candidate_hash"),
              "reviewer_session": payload.get("reviewer_session"),
              "findings": [], "verdict": "passed",
              "evidence": ["candidate diff inspected", "required check evidence inspected"]}
    if scenario == "review_blocking":
        review["verdict"] = "changes_required"
        review["findings"] = [{"severity": "blocking", "path": "src/main.py", "line": 1,
                               "explanation": "seeded issue", "evidence": ["observed seeded regression"]}]
    elif scenario == "review_stale":
        review["candidate_hash"] = "sha256:" + "0" * 64
    elif scenario == "review_mutation":
        # This fixture describes the rejection; the extension's real decision
        # logic is checked independently in scope-guard.test.mjs.
        send({"type": "tool_execution_end", "toolCallId": "review-write", "toolName": "write",
              "result": {"content": [{"type": "text", "text": "Luuna scope guard: write is not permitted"}]},
              "isError": True})
    elif scenario == "review_no_findings":
        # A non-passing verdict that names nothing to change: no verdict at all.
        review["verdict"] = "changes_required"
    elif scenario == "review_tools":
        # Tool use the runtime records by name and path only: the search
        # pattern and file contents below must never reach durable events.
        for call, tool, args in (("review-read", "read", {"path": "src/main.py"}),
                                 ("review-grep", "grep", {"pattern": "fixture-secret-pattern", "path": "src"})):
            send({"type": "tool_execution_start", "toolCallId": call, "toolName": tool, "args": args})
            send({"type": "tool_execution_end", "toolCallId": call, "toolName": tool,
                  "result": {"content": [{"type": "text", "text": "fixture-file-contents"}]}, "isError": False})
        send({"type": "tool_execution_start", "toolCallId": "review-escape", "toolName": "read",
              "args": {"path": "../outside.txt"}})
        send({"type": "tool_execution_end", "toolCallId": "review-escape", "toolName": "read",
              "result": {"content": [{"type": "text", "text": "Luuna scope guard: path is outside"}]},
              "isError": True})
    elif scenario == "review_report":
        # Reports what the runtime gave this reviewer, so tests can check the
        # reviewer's diff evidence without the prompt being persisted.
        diff = payload.get("diff", "")
        scope = json.loads(os.environ.get("LUUNA_SCOPE_JSON", "null")) or {}
        review["evidence"] = [
            "scope_root_is_cwd=" + json.dumps(
                os.path.normcase(scope.get("root", "")) == os.path.normcase(os.getcwd())),
            "diff_truncated=" + json.dumps(payload.get("diff_truncated")),
            "diff_notice=" + json.dumps(bool(payload.get("diff_notice"))),
            "binary_patch=" + json.dumps("GIT binary patch" in diff),
            "writer_change=" + json.dumps("+print('implemented by the synthetic writer')" in diff),
            "files=" + json.dumps(payload.get("diff_files")),
            "attention=" + json.dumps(payload.get("attention_paths")),
        ]
    text = "not a review JSON object" if scenario == "review_malformed" else json.dumps(review)
    output = {"role": "assistant", "stopReason": "stop", "usage": usage(0.0005),
              "content": [{"type": "text", "text": text}]}
    send({"type": "message_end", "message": output})
    send({"type": "agent_end", "messages": [output], "willRetry": False})
    if scenario == "review_retry":
        send({"type": "auto_retry_end", "success": True, "attempt": 2})
    send({"type": "agent_settled", "aborted": False})


def run_writer(request_id, kind, scenario, prompt):
    """Synthetic writer behaviour inside the cwd the runtime assigned."""
    if scenario == "component_context":
        system = flag("--system-prompt") or ""
        resources = json.loads(system.split("<<<APPROVED_COMPONENT_RESOURCES>>>\n", 1)[1].split("\n<<<END_APPROVED_COMPONENT_RESOURCES>>>", 1)[0])
        verify_component_context(resources, system + prompt)
    if scenario == "writer_crash_before_ack":
        # The prompt was sent and may have started provider work, but Pi exits
        # before acknowledging it.
        sys.exit(9)
    send({"type": "fixture_args", "tools": flag("--tools"), "extensions": [
        sys.argv[i + 1] for i, a in enumerate(sys.argv) if a in ("-e", "--extension")],
        "scope": json.loads(os.environ.get("LUUNA_SCOPE_JSON", "null")),
        "no_tools": "--no-tools" in sys.argv,
        "system_prompt_bytes": len((flag("--system-prompt") or "").encode("utf-8")),
        "system_prompt_from_file": "--system-prompt" in sys.argv
            and os.path.isfile(sys.argv[sys.argv.index("--system-prompt") + 1]),
        # M4: the dependency bindings a consumer task's writer received (paths
        # and commits of Luuna-owned worktrees, never credentials), and whether
        # the system prompt stated them.
        "dependency_env": {name: value for name, value in sorted(os.environ.items())
                           if name.startswith("LUUNA_DEPENDENCY_")},
        "dependencies_stated": "LUUNA_DEPENDENCY_" in (flag("--system-prompt") or "")})
    send({"type": "response", "id": request_id, "command": kind,
          "success": True, "data": {"disposition": "started"}})
    send({"type": "agent_start"})
    # `write_unpriced` stands for a model Pi has no price for: tokens, cost 0.
    cost = 0.0 if scenario == "write_unpriced" else 0.0005
    if scenario == "write_compaction":
        # Pi's threshold compaction is a separate summarization call whose
        # usage only `compaction_end` reports.
        send({"type": "compaction_start", "reason": "threshold"})
        send({"type": "compaction_end", "reason": "threshold", "aborted": False, "willRetry": False,
              "result": {"summary": "synthetic summary", "firstKeptEntryId": "entry-1",
                         "tokensBefore": 150000, "estimatedTokensAfter": 32000,
                         "usage": usage(0.25), "details": {}}})
    if scenario == "writer_crash":
        # Accepted model work that never reports its usage: the process exits
        # mid-turn, as a lost transport or a crashed Pi would.
        sys.exit(9)
    if scenario == "slow":
        time.sleep(60)
    elif scenario.startswith("write_hold_"):
        # M4 concurrency: hold for N seconds (`write_hold_3`), then write in
        # scope, so overlapping attempts of a task graph can be observed.
        time.sleep(float(scenario[len("write_hold_"):]))
        write_file("src/main.py", "print('implemented by the synthetic writer after a hold')\n")
    elif scenario == "write_until_released":
        # M4 restart: wait until the run's worktree directory
        # (`worktrees/<run>/`, two levels above this attempt's worktree) holds
        # a RELEASE file, so a task can be interrupted mid-graph and resumed.
        release = os.path.join(os.getcwd(), os.pardir, os.pardir, "RELEASE")
        for _ in range(4800):
            if os.path.exists(release):
                break
            time.sleep(0.025)
        write_file("src/main.py", "print('implemented by the synthetic writer after release')\n")
    elif scenario == "write_if_released":
        # M4 resume: changes nothing (the attempt fails as empty) until the
        # run's worktree directory holds a RELEASE file; a later attempt of
        # the same task then writes in scope.
        if os.path.exists(os.path.join(os.getcwd(), os.pardir, os.pardir, "RELEASE")):
            write_file("src/main.py", "print('implemented by the synthetic writer after release')\n")
    elif scenario == "write_rename_function":
        # M4 integration: an incompatible producer change that renames the
        # function its consumers import; the producer's own check still passes.
        write_file("src/shared_pkg/__init__.py", "def helper_v2():\n    return 'renamed'\n\ndef banner():\n    import api_pkg\n    return api_pkg.greet('shared')\n")
    elif scenario in ("write_in_scope", "component_context", "large_session", "write_unpriced", "write_compaction") or scenario.startswith("review_"):
        repairing = "Repair feedback:" in prompt or "Repair feedback:" in (flag("--system-prompt") or "")
        write_file("src/main.py", "print('revised by the synthetic repair writer')\n" if repairing else "print('implemented by the synthetic writer')\n")
    elif scenario in ("repair_in_scope", "repair_hold"):
        repairing = "Repair feedback:" in prompt or "Repair feedback:" in (flag("--system-prompt") or "")
        if scenario == "repair_hold" and repairing:
            time.sleep(60)
        # The synthetic repair writer only fixes what it can see: the runtime
        # must quote the failing check output, not just an exit code.
        repaired = repairing and "test result: FAILED" in prompt
        write_file("src/main.py", "print('repaired by the synthetic writer')\n" if repaired else "print('seeded regression')\n")
    elif scenario == "ci_repair":
        # A24: the first candidate passes its local checks and review; its
        # pull request then fails CI on GitHub. The synthetic repair writer
        # only fixes what the runtime quoted: the `ci_failure` evidence and
        # the failing check's name (never log content) must be in the prompt.
        repairing = "Repair feedback:" in prompt or "Repair feedback:" in (flag("--system-prompt") or "")
        repaired = repairing and "ci_failure" in prompt and "ci-unit" in prompt
        write_file("src/main.py", "print('repaired after the ci failure')\n" if repaired
                   else "print('repaired without ci evidence')\n" if repairing
                   else "print('implemented by the synthetic writer')\n")
    elif scenario == "extension_error":
        send({"type": "extension_error", "extensionPath": "luuna-scope-guard.js",
              "event": "tool_call", "error": "synthetic scope guard failure"})
        write_file("src/main.py", "print('must not become a candidate')\n")
    elif scenario == "write_secret":
        # M7 pre-push policy: an in-scope change that passes its check and the
        # synthetic review but carries a credential-shaped literal and a
        # credential store by name; publication must refuse it before any push.
        write_file("src/main.py", "print('implemented by the synthetic writer')\n")
        write_file("src/config.py", "GITHUB_TOKEN = 'ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0" + "'\n")
        write_file("src/.env", "DB_PASSWORD=Xk9f2mQ8vL3pR7wZq1\n")
    elif scenario == "write_out_of_scope":
        write_file("src/main.py", "print('changed')\n")
        write_file("README.md", "tampered outside the task paths\n")
    elif scenario == "expensive":
        cost = 5.0
        write_file("src/main.py", "print('expensive')\n")
    elif scenario == "no_change":
        pass
    elif scenario == "write_dotgit":
        # A writer with whole-repository scope repoints the worktree's gitfile
        # at the developer repository, as prompt-injected content could ask.
        with open(os.path.join(os.getcwd(), ".git"), encoding="utf-8") as handle:
            gitdir = handle.read().strip().split("gitdir: ", 1)[1]
        write_file(".git", "gitdir: " + os.path.dirname(os.path.dirname(gitdir)) + "\n")
        write_file("src/main.py", "print('redirected candidate')\n")
    elif scenario == "write_ignored":
        # An in-scope file the repository ignores: the code depends on it, but
        # `git add --all` would leave it out of the candidate.
        write_file("src/main.py", "import settings_local\n")
        write_file("src/settings.local", "TOKEN = 'synthetic'\n")
    elif scenario == "write_through_link":
        # The repository tracks src/out as a dangling link to a path outside
        # the worktree; writing it creates the link's target there.
        write_file("src/main.py", "print('changed')\n")
        write_file("src/out", "written through a tracked dangling link\n")
    elif scenario == "write_in_gitlink":
        # vendor/lib is an unpopulated submodule; Git never lists its contents.
        write_file("src/main.py", "print('changed')\n")
        write_file("vendor/lib/injected.py", "x = 1\n")
    message = {"role": "assistant", "stopReason": "stop", "usage": usage(cost),
               "content": [{"type": "text", "text": f"synthetic writer finished {scenario}"}]}
    send({"type": "message_update", "usage": usage(cost), "assistantMessageEvent":
          {"type": "text_delta", "contentIndex": 0, "delta": "done"}})
    send({"type": "message_end", "message": message})
    if scenario == "large_session":
        # A normal session that read 24 files: every record stays small, but
        # Pi's turn_end and agent_end repeat all tool results (over 1 MiB).
        reads = [{"role": "toolResult", "toolCallId": f"read-{i}", "toolName": "read", "isError": False,
                  "content": [{"type": "text", "text": bulky_text(46_000)}]} for i in range(24)]
        for read in reads:
            send({"type": "message_end", "message": read})
        send({"type": "turn_end", "message": message, "toolResults": reads})
        send({"type": "agent_end", "messages": [{"role": "user", "content": prompt}] + reads + [message],
              "willRetry": False})
    else:
        send({"type": "agent_end", "messages": [message], "willRetry": False})
    send({"type": "agent_settled", "aborted": False})


for line in sys.stdin:
    command = json.loads(line)
    kind, request_id = command["type"], command["id"]
    if kind == "get_state":
        send({"type": "response", "id": request_id, "command": kind,
              "success": True, "data": {"isStreaming": False}})
    elif kind == "prompt" and "luuna independent reviewer" in (flag("--system-prompt") or "").lower():
        run_reviewer(request_id, kind, command.get("message", "{}"))
    elif kind == "prompt" and writer_scenario() is not None:
        run_writer(request_id, kind, writer_scenario(), command.get("message", ""))
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
        if scenario in ("large_agent_end", "large_agent_end_error", "malformed_large_agent_end", "oversized_unknown"):
            # Records over 1 MiB: Pi's aggregate events repeat every message
            # of the run; an unknown kind of that size stays a protocol error.
            reads = [{"role": "toolResult", "toolName": "read", "isError": False,
                      "content": [{"type": "text", "text": bulky_text(50_000)}]} for _ in range(42)]
            last = {"role": "assistant", "stopReason": "stop", "usage": usage(0.0005),
                    "content": [{"type": "text", "text": "read everything"}]}
            if scenario == "large_agent_end_error":
                last = {"role": "assistant", "stopReason": "error", "content": [],
                        "errorMessage": "synthetic provider failure after large reads"}
            send({"type": "message_end", "message": last})
            if scenario == "oversized_unknown":
                send({"type": "future_event", "payload": bulky_text(2 * 1024 * 1024)})
            else:
                send({"type": "turn_end", "message": last, "toolResults": reads})
                send({"type": "agent_end", "messages": [{"role": "user", "content": "read"}] + reads + [last],
                      "willRetry": "false" if scenario == "malformed_large_agent_end" else False})
            send({"type": "agent_settled", "aborted": False})
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

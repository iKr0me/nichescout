#!/usr/bin/env python3
"""
Export the NicheScout conversation transcript to a readable text file.

Reads the raw Mel session log (JSONL) and emits a clean transcript with the
user's messages (attributed by name) and the assistant's replies, in order.

Usage:
    python3 scripts/export-transcript.py [output-path]
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SESSION = Path.home() / (
    ".local/share/mel/accounts/b2fb82b521bdbb4a/conversations/"
    "1789776083-I-have-an-idea-to-help-dropshipp.events.jsonl"
)
DEFAULT_OUT = Path("NICHSCOUT-CONVERSATION.txt")
USER_NAME = "Sebastian"


def load(path: Path) -> list[dict]:
    events = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def ts(ms) -> str:
    if not ms:
        return ""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def summarise_calls(calls) -> list[str]:
    """One short line per tool call, so the transcript shows what was done
    without dumping raw tool output."""
    out = []
    if not isinstance(calls, list):
        return out
    for c in calls:
        if not isinstance(c, dict):
            continue
        name = c.get("name", "tool")
        args = c.get("arguments")
        detail = ""
        if isinstance(args, str):
            try:
                a = json.loads(args)
            except json.JSONDecodeError:
                a = {}
            for key in ("path", "command", "pattern", "url", "query", "todos"):
                if key in a:
                    val = a[key]
                    if isinstance(val, list):
                        detail = f"({len(val)} items)"
                    else:
                        detail = str(val).replace("\n", " ")[:110]
                    break
        elif isinstance(args, dict):
            for key in ("path", "command", "pattern", "url", "query"):
                if key in args:
                    detail = str(args[key]).replace("\n", " ")[:110]
                    break
        out.append(f"{name} {detail}".strip())
    return out


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    if not SESSION.exists():
        print(f"ERROR: session log not found at {SESSION}", file=sys.stderr)
        return 1

    events = load(SESSION)
    turns = [e for e in events if e.get("ev") in ("user_message", "assistant_message")]

    if not turns:
        print("ERROR: no messages found in session log", file=sys.stderr)
        return 1

    lines: list[str] = []
    add = lines.append

    add("=" * 78)
    add("NICHSCOUT — FULL CONVERSATION TRANSCRIPT")
    add("=" * 78)
    add("")
    add(f"User:  {USER_NAME}")
    add("Agent: Mel")
    add(f"Export date: {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    add(f"Messages: {len(turns)} total")
    add("")
    add("Note: tool calls are listed by name and target only — raw tool output")
    add("(command results, file contents) is omitted to keep this readable.")
    add("")
    add("=" * 78)
    add("")

    turn_no = 0
    for e in turns:
        kind = e["ev"]
        stamp = ts(e.get("at"))
        text = (e.get("text") or "").strip()

        if kind == "user_message":
            turn_no += 1
            add("")
            add("─" * 78)
            add(f"[{turn_no}] {USER_NAME.upper()}" + (f"   ·   {stamp}" if stamp else ""))
            add("─" * 78)
            add("")
            add(text if text else "(no text)")
            add("")

        else:  # assistant_message
            calls = summarise_calls(e.get("calls"))
            if not text and not calls:
                continue
            add(f"── MEL" + (f"   ·   {stamp}" if stamp else ""))
            add("")
            if text:
                add(text)
                add("")
            if calls:
                add("  [tools used]")
                for c in calls:
                    add(f"    · {c}")
                add("")
            add("")

    add("=" * 78)
    add("END OF TRANSCRIPT")
    add("=" * 78)
    add("")

    out_path.write_text("\n".join(lines), encoding="utf-8")

    size_kb = out_path.stat().st_size / 1024
    print(f"Wrote {out_path}")
    print(f"  {len(turns)} messages, {len(lines)} lines, {size_kb:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

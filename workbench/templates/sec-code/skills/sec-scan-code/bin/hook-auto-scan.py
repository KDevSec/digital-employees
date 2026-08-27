#!/usr/bin/env python3
"""hook-auto-scan.py — Claude Code PostToolUse 钩子（hook-auto-scan.sh 的 Python 版）。

Write/Edit 操作后自动扫描变更文件：CRITICAL/HIGH 拦截并附理由，
MEDIUM/LOW 放行并附提醒，无发现直接放行。

输入:  stdin = Claude Code hook payload JSON（取 tool_input.file_path），
       或 $1 = 文件路径
输出:  stdout = JSON {"decision": "approve"|"block", "reason": "..."}
"""

import json
import os
import sys

# Windows 控制台 UTF-8 输出
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from _skill_util import setup_skill_path

SKILL_DIR = setup_skill_path()
if SKILL_DIR is None:
    print("ERROR: cannot locate sec-scan-code skill directory", file=sys.stderr)
    sys.exit(1)

_SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
_SEV_NAME = {0: "CRITICAL", 1: "HIGH", 2: "MEDIUM", 3: "LOW"}


def _get_file_path() -> str:
    """从 $1 或 stdin JSON 提取文件路径。"""
    if len(sys.argv) > 1 and sys.argv[1]:
        return sys.argv[1]
    try:
        data = json.load(sys.stdin)
        return str(data.get("tool_input", {}).get("file_path", ""))
    except Exception:
        return ""


def main() -> int:
    file_path = _get_file_path()
    if not file_path:
        print(json.dumps({"decision": "approve"}))
        return 0

    try:
        from secscancode.rules_loader import load_rules, detect_project_languages
        from secscancode.scanner import scan_file

        project_path = os.getcwd()
        languages = detect_project_languages(project_path)
        rules = load_rules(languages=languages)
        findings = scan_file(file_path, rules)
    except Exception:
        # 任何引擎异常都放行，避免 hook 阻塞正常工作流
        print(json.dumps({"decision": "approve"}))
        return 0

    if not findings:
        print(json.dumps({"decision": "approve"}))
        return 0

    worst = min(_SEV_ORDER.get(f.severity.upper(), 9) for f in findings)
    worst_sev = _SEV_NAME.get(worst, "LOW")
    count = len(findings)

    if worst_sev in ("CRITICAL", "HIGH"):
        print(json.dumps({
            "decision": "block",
            "reason": f"sec-scan-code found {count} {worst_sev} finding(s) in "
                      f"{file_path}. Please review and fix before proceeding.",
        }, ensure_ascii=False))
    else:
        print(json.dumps({
            "decision": "approve",
            "reason": f"sec-scan-code found {count} {worst_sev} finding(s) in "
                      f"{file_path}. Consider reviewing.",
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

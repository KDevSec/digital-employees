#!/usr/bin/env python3
"""
Hook: UserPromptSubmit
Injects OWASP Top 10:2025 security constitution brief into the conversation
when the user's prompt involves code generation.

stdin:  JSON from Claude Code (UserPromptSubmit event)
stdout: JSON {"decision":"approve","additionalContext":"..."} on exit 0
"""

import json
import os
import re
import sys

# Fix Windows encoding issue
sys.stdout.reconfigure(encoding='utf-8')


def find_skill_dir():
    """Find the sec-scan-code skill directory."""
    # Try common locations
    candidates = [
        # From script location (if installed in skills dir)
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."),
        # Global skills directory
        os.path.expanduser("~/.claude/skills/sec-scan-code"),
        # Environment variable
        os.environ.get("SEC_SCAN_CODE_DIR", ""),
    ]

    for candidate in candidates:
        if candidate and os.path.isfile(os.path.join(candidate, "bin", "hook-inject-constitution.py")):
            return os.path.abspath(candidate)

    return None


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        print(json.dumps({"decision": "approve"}))
        return 0

    prompt = ""
    if isinstance(data, dict):
        prompt = data.get("prompt", data.get("message", ""))
        if isinstance(prompt, list):
            prompt = " ".join(str(p) for p in prompt)

    code_keywords = (
        r"write|create|implement|add|build|develop|code|function|class|method|"
        r"module|endpoint|route|handler|service|api|app|script|program|"
        r"refactor|update|modify|change|fix|patch|generate|"
        r"写|编写|创建|实现|添加|新增|构建|搭建|开发|代码|函数|类|方法|"
        r"模块|接口|路由|服务|脚本|程序|重构|修改|更新|修复|补丁|生成"
    )

    if not re.search(code_keywords, prompt, re.IGNORECASE):
        print(json.dumps({"decision": "approve"}))
        return 0

    skill_dir = find_skill_dir()
    constitution = ""

    if skill_dir:
        sys.path.insert(0, skill_dir)
        try:
            from secscancode.rules_loader import (
                load_constitution_owasp_brief,
                load_constitution_project_brief,
                format_brief_for_injection,
            )

            owasp = load_constitution_owasp_brief()
            project = load_constitution_project_brief()
            owasp_text = format_brief_for_injection(owasp, "宪法文件1 (OWASP 必加载)")
            project_text = format_brief_for_injection(project, "宪法文件2 (项目常见漏洞)")
            constitution = "\n\n".join(filter(None, [owasp_text, project_text]))
        except Exception:
            constitution = ""

    if not constitution:
        print(json.dumps({"decision": "approve"}))
        return 0

    output = {
        "decision": "approve",
        "additionalContext": constitution
        + "\n\n"
        + "⚠ 以上为安全编码宪法规则，生成代码时必须遵守。违反这些规则的代码将产生安全漏洞。",
    }
    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

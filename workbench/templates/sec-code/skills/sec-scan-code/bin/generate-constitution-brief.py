#!/usr/bin/env python3
"""generate-constitution-brief.py — 生成宪法简报用于上下文注入
（generate-constitution-brief.sh 的 Python 版）。

用法:
  python bin/generate-constitution-brief.py

复用 rules_loader 的 load_constitution_owasp_brief() /
load_constitution_project_brief() / format_brief_for_injection()，
输出格式与原 shell 版一致（约 200 tokens）。
"""

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

from secscancode.rules_loader import (  # noqa: E402
    load_constitution_owasp_brief,
    load_constitution_project_brief,
    format_brief_for_injection,
)


def main(argv: list[str]) -> int:
    rules_dir = os.path.join(SKILL_DIR, "rules")

    print("# Security Constitution (Auto-Generated Brief)")
    print("")

    # 宪法文件 1（OWASP，必加载）
    owasp = load_constitution_owasp_brief()
    if owasp:
        print(format_brief_for_injection(owasp, "宪法文件1 (OWASP 必加载)"))
        print("")

    # 宪法文件 2（项目特定，可能尚未生成）
    project = load_constitution_project_brief()
    if project:
        print(format_brief_for_injection(project, "宪法文件2 (项目常见漏洞 - 最高优先级)"))
    else:
        print("## 宪法文件2 (项目常见漏洞)")
        print("(尚未生成 - 运行 /sec-scan-code --analyze 生成)")
    print("")

    print(f"详细规则按需读取: {rules_dir}/owasp/*.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

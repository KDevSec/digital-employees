#!/usr/bin/env python3
"""detect-changes.py — 检测 git 工作区中变更的源文件（detect-changes.sh 的 Python 版）。

用法:
  python bin/detect-changes.py [project_path] [--tracked-only]

输出契约（与 shell 版一致）:
  stdout: 每行一个相对路径（机器可读）
  stderr: NO_CHANGES + 提示，或 CHANGES_FOUND: N source file(s) changed
  退出码: 0 = 有改动，1 = 无改动或非 git 仓库
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

from secscancode.git_changes import detect_changes, GitError  # noqa: E402


def main(argv: list[str]) -> int:
    mode = "--tracked-only" if "--tracked-only" in argv else ""
    path = next((a for a in argv if not a.startswith("-")), ".")
    try:
        files = detect_changes(path, tracked_only=bool(mode))
    except GitError as e:
        print(f"ERROR: Not a usable git repository: {path} ({e})", file=sys.stderr)
        return 1

    if not files:
        print("NO_CHANGES", file=sys.stderr)
        print(f"No changed source files detected in: {path}", file=sys.stderr)
        print("", file=sys.stderr)
        print("Hints:", file=sys.stderr)
        print("  - New files are included by default; use --tracked-only to exclude",
              file=sys.stderr)
        print("  - Use --full mode for a complete project scan", file=sys.stderr)
        return 1

    for f in files:
        print(f)
    print("", file=sys.stderr)
    print(f"CHANGES_FOUND: {len(files)} source file(s) changed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

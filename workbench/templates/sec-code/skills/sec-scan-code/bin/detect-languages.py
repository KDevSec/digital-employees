#!/usr/bin/env python3
"""detect-languages.py — 检测项目语言（detect-languages.sh 的 Python 版）。

用法:
  python bin/detect-languages.py [project_path]

直接复用 rules_loader.detect_project_languages()（单一实现，排除 node_modules/
.venv 等依赖目录），输出格式与原 shell 版一致。

输出契约:
  stdout: "Detected languages: <lang1> <lang2> ..." + 每行 "  - <lang>"
          无语言时 "No languages detected"
  退出码: 0
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

from secscancode.rules_loader import detect_project_languages  # noqa: E402


def main(argv: list[str]) -> int:
    project_path = next((a for a in argv if not a.startswith("-")), ".")
    detected = detect_project_languages(project_path)

    if not detected:
        print("No languages detected")
        return 0

    print(f"Detected languages: {' '.join(detected)}")
    for lang in detected:
        print(f"  - {lang}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

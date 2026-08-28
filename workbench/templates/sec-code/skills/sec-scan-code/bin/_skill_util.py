#!/usr/bin/env python3
"""共享工具：解析 sec-scan-code skill 根目录并加入 sys.path。

bin/ 下的脚本通过 `from _skill_util import setup_skill_path` 引入，
避免每个脚本重复实现路径探测。探测候选（首个含 secscancode/ 包者胜出）：
  1. SEC_SCAN_CODE_DIR 环境变量（显式指定）
  2. 脚本所在目录 bin/ 的父目录（用 realpath 解析符号链接）
  3. ~/.claude/skills/sec-scan-code（Claude Code 全局安装位置）
"""

import os
import sys


def setup_skill_path() -> str | None:
    """返回 skill 根目录，并确保它位于 sys.path[0]；找不到返回 None。"""
    script_dir = os.path.dirname(os.path.realpath(__file__))  # bin/
    candidates = [
        os.environ.get("SEC_SCAN_CODE_DIR", ""),
        os.path.dirname(script_dir),              # bin/ 的父目录 = skill 根
        os.path.expanduser("~/.claude/skills/sec-scan-code"),
    ]
    for cand in candidates:
        if cand and os.path.isdir(os.path.join(cand, "secscancode")):
            if cand not in sys.path:
                sys.path.insert(0, cand)
            return cand
    return None


if __name__ == "__main__":
    print(setup_skill_path())

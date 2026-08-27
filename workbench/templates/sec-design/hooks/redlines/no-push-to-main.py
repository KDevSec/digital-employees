"""no-push-to-main 红线：禁止 git push 到 main/master（直接主干推送）。

规则候选值（T10 2026-08-27 定格）；devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 判定 → 命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
判定：tool_name=Bash 且 tool_input.command 匹配 `git push` 且目标含 main/master（含 origin HEAD:main 与 --force 变体）。
"""
import json
import re
import sys


def main() -> int:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0  # 非 JSON 不拦——交由 CC 协议本身处理

    tool_name = data.get('tool_name') or ''
    tool_input = data.get('tool_input') or {}
    if not isinstance(tool_input, dict):
        return 0
    command = tool_input.get('command') or ''
    if not isinstance(command, str):
        return 0
    if tool_name != 'Bash':
        return 0

    # 必须是 git push 且目标分支含 main/master
    push_re = re.compile(r'\bgit\s+push\b', re.IGNORECASE)
    if not push_re.search(command):
        return 0

    # 命中 main/master 分支引用（宽松：含 main/master 词即拒——push 到主干不论远程名）
    target_re = re.compile(r'\b(main|master)\b', re.IGNORECASE)
    if not target_re.search(command):
        return 0

    sys.stderr.write('拒因：禁止直接 push 到 main/master 主干（走 PR 流程）；命令=' + command.strip()[:200] + '\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())

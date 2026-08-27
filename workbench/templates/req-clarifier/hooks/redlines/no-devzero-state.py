"""no-devzero-state 红线：禁止员工改写工作台状态目录 .devzero/。

规则候选值（T10 2026-08-27 定格）；devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 判定 → 命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
判定：tool_name ∈ Write|Edit|MultiEdit|Bash 且 tool_input.file_path 或 command 含 `/.devzero/`（含 Windows `\.devzero\` 反斜杠形态）。
"""
import json
import re
import sys


def main() -> int:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0

    tool_name = data.get('tool_name') or ''
    tool_input = data.get('tool_input') or {}
    if not isinstance(tool_input, dict):
        return 0
    if tool_name not in ('Write', 'Edit', 'MultiEdit', 'Bash'):
        return 0

    file_path = tool_input.get('file_path') or ''
    command = tool_input.get('command') or ''
    if not isinstance(file_path, str):
        file_path = ''
    if not isinstance(command, str):
        command = ''

    # 拼一份统一搜（路径分隔双态：/ 与 \）
    blob = file_path + '\n' + command
    # 匹配 .devzero 路径段——前后是路径分隔或字符串起止
    devzero_re = re.compile(r'(?:^|[\\/])\.devzero(?:[\\/]|$)', re.IGNORECASE)
    if not devzero_re.search(blob):
        return 0

    sys.stderr.write('拒因：禁止改写工作台状态目录 .devzero/（运行层状态由工作台管理）\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())

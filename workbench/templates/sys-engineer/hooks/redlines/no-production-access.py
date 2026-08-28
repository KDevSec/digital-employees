"""no-production-access 红线：禁止访问生产环境特征。

规则候选值（T10 2026-08-27 定格）；devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 判定 → 命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
判定：tool_input.command 或 file_path 含 prod 特征（`prod-`、`production`、`:3306`、`:5432`——生产库常见端口）。
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

    tool_input = data.get('tool_input') or {}
    if not isinstance(tool_input, dict):
        return 0

    file_path = tool_input.get('file_path') or ''
    command = tool_input.get('command') or ''
    if not isinstance(file_path, str):
        file_path = ''
    if not isinstance(command, str):
        command = ''

    blob = file_path + '\n' + command
    # 生产特征：prod- 前缀（host 名常见）、production 字面、:3306（MySQL 生产端口）、:5432（PG 生产端口）
    prod_re = re.compile(
        r'(?:prod-|production|:3306|:5432)',
        re.IGNORECASE,
    )
    if not prod_re.search(blob):
        return 0

    sys.stderr.write('拒因：禁止访问生产环境（prod-/production/:3306/:5432 命中）\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())

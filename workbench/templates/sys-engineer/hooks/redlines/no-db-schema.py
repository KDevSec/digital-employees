"""no-db-schema 红线：禁止非 migration 路径的库结构变更。

规则候选值（T10 2026-08-27 定格）；devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 判定 → 命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
判定：tool_input.command 含 ALTER TABLE|DROP TABLE|CREATE TABLE|TRUNCATE 且 file_path 非 migration 文件（不含 `migration` 路径段）。
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

    # 库结构变更动词
    schema_re = re.compile(
        r'\b(?:ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE)\b',
        re.IGNORECASE,
    )
    if not schema_re.search(command):
        return 0

    # migration 路径豁免（路径含 migration 段）
    migration_re = re.compile(r'(?:^|[\\/])migrations?(?:[\\/]|$)', re.IGNORECASE)
    if migration_re.search(file_path):
        return 0

    sys.stderr.write('拒因：禁止非 migration 路径的库结构变更（ALTER/DROP/CREATE TABLE/TRUNCATE 走 migration 流程）\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())

"""no-external-request 红线：禁止外网请求（V0.1 空白名单=全拒外网）。

规则候选值（T10 2026-08-27 定格）；devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 判定 → 命中拒因 print 到 stderr + exit 2（block）；放行 exit 0。
判定：
  - tool_name=Bash 且 command 含 curl|wget|Invoke-WebRequest|Invoke-RestMethod → 拒
  - tool_name=WebFetch → 拒（V0.1 无白名单=全拒外网；后续白名单演进见 Q-T4 余项）
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

    if tool_name == 'WebFetch':
        sys.stderr.write('拒因：禁止外网请求（V0.1 空白名单=全拒外网；WebFetch 全拒）\n')
        return 2

    if tool_name == 'Bash':
        command = tool_input.get('command') or ''
        if not isinstance(command, str):
            return 0
        ext_re = re.compile(
            r'\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b',
            re.IGNORECASE,
        )
        if ext_re.search(command):
            sys.stderr.write('拒因：禁止外网请求（V0.1 空白名单=全拒外网；命令含 curl/wget/Invoke-WebRequest）\n')
            return 2

    return 0


if __name__ == '__main__':
    sys.exit(main())

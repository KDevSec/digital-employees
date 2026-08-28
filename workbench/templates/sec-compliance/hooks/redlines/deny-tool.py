"""deny-tool 通用拒因：工具已被禁用（matcher 已精确到工具名，命中即拒）。

devzero 生成。
协议：读 stdin JSON {tool_name, tool_input} → 命中即 print 到 stderr「工具已被禁用」+ exit 2（block）。
此脚本由 hooks 编译器在 tools.deny 非空时挂到对应工具名 matcher 上，因此任何调用都视为命中。
"""
import sys


def main() -> int:
    sys.stderr.write('拒因：工具已被禁用（matcher 已精确到工具名，命中即拒；解禁须改 manifest.tools.deny）\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())

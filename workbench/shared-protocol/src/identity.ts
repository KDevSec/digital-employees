// 员工 ID 拼装与解析（org 含 @ 场景取最后一个 @ 后段）

/**
 * 拼装 employeeId：${id}@${org}
 */
export function employeeId(id: string, org: string): string {
  return `${id}@${org}`
}

/**
 * 解析 org：取最后一个 @ 后段（org 含 @ 场景仍可正确分割）
 * 输入不含 @ 时返回原字符串（split('@') 在无分隔符时返回单元素数组）
 */
export function parseOrg(employeeId: string): string {
  const parts = employeeId.split('@')
  return parts[parts.length - 1] ?? ''
}

/**
 * 安装期错误一等公民（B-8；设计 §7）——所有失败路径的结构化形状。
 * 注：形状接口与异常类分离命名（interface/class 同名声明合并时 readonly 字段
 * 无法在构造函数赋值，TS2540）；`InstallError` 类实例即该形状，下游统一消费类。
 */
export interface InstallErrorShape {
  readonly code: string
  readonly message: string
  /** 失败阶段：parse | negotiate | plan | execute | rollback | report */
  readonly phase: string
  readonly recoverable: boolean
  readonly hint: string
}

export class InstallError extends Error implements InstallErrorShape {
  readonly code: string; readonly phase: string; readonly recoverable: boolean; readonly hint: string
  constructor(e: { code: string; message: string; phase: string; recoverable?: boolean; hint?: string }) {
    super(e.message)
    this.name = 'InstallError'
    this.code = e.code
    this.phase = e.phase
    this.recoverable = e.recoverable ?? true
    this.hint = e.hint ?? ''
  }
}

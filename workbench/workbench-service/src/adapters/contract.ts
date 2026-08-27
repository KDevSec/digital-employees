/** adapter 契约类型真源（设计 §4；Task 1 先立 BaseId/AnchorKind，Task 2 补全） */
export type BaseId = 'claude-code' | 'codebuddy' | 'qoder'
export type AnchorKind = 'config-domain' | 'project-file' | 'launcher-flag'

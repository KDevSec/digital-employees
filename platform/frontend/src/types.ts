export interface PackageItem {
  id: string
  version: string
  os: string
  arch: string
  file_name: string
  size_bytes: number
  sha256: string
  signature_status: string
  status: string
}

export interface RoleView {
  role_code: string
  scope_type: string
  domain_id?: string
  department_ids: string[]
}

export interface Me {
  principal: {
    id: string
    username: string
    display_name: string
    email?: string
    domain_id: string
    department_id?: string
    team_id?: string
  }
  roles: RoleView[]
  permissions: string[]
}

export interface Workbench {
  id: string
  display_name: string
  owner_principal_id: string
  domain_id: string
  department_id?: string
  reported_os: string
  reported_arch: string
  reported_version: string
  status: string
  credential_status: string
  connection_status: string
  created_at: string
  last_heartbeat_at?: string
}

export interface Enrollment {
  id: string
  owner_principal_id: string
  display_name: string
  workbench_version: string
  os: string
  arch: string
  status: string
  created_at: string
  review_reason?: string
}

export interface AuditEvent {
  id: string
  event_type: string
  category: string
  actor_id?: string
  target_type: string
  target_id?: string
  result: string
  summary: string
  occurred_at: string
  trace_id: string
}

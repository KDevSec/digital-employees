export interface PaginatedResponse<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

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
  published_at?: string
}

export interface RoleView {
  role_code: string
  scope_type: string
  domain_id?: string
  department_ids: string[]
  managed_orgs?: { id: string; name: string; org_type: string }[]
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
  kind?: 'workbench' | 'enrollment'
  enrollment_id?: string
  id: string
  display_name: string
  owner_principal_id: string
  owner_display_name: string
  org_path: string
  org_path_nodes?: Array<{ id: string; name: string; org_type: string }>
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
  review_reason?: string
}

export interface Enrollment {
  id: string
  owner_principal_id: string
  owner_display_name: string
  org_path: string
  org_path_nodes?: Array<{ id: string; name: string; org_type: string }>
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
  actor_type?: string
  actor_id?: string
  actor_display_name?: string
  actor_username?: string
  target_type: string
  target_id?: string
  target_display?: string
  result: string
  reason_code?: string
  summary: string
  occurred_at: string
  trace_id: string
}

export interface SystemLog {
  timestamp?: string
  level: string
  logger?: string
  trace_id?: string
  message: string
}

export interface ProblemFeedback {
  id: string
  title: string
  category: string
  description: string
  contact?: string | null
  priority: string
  status: string
  submitter_principal_id: string
  submitter_display_name?: string
  admin_reply?: string | null
  created_at: string
  updated_at: string
  resolved_at?: string | null
}

export interface FeedbackCreate {
  title: string
  category: string
  description: string
  priority: string
  contact?: string
}

export interface FixedAuthorization {
  id: string
  principal_id: string
  role_code: string
  scope_type: string
  domain_id?: string
  department_ids: string[]
  status: string
}

export interface ScopedAuthorization {
  id: string
  role_id: string
  role_name: string
  scope_org_id: string
  scope_org_name: string
  scope_include_descendants: boolean
  status: string
}

export interface PrincipalAuthorizations {
  fixed_assignments: FixedAuthorization[]
  scoped_grants: ScopedAuthorization[]
}

export interface ScopeOptions {
  domains: { id: string; name: string }[]
  org_nodes: { id: string; name: string; domain_id: string; parent_id: string | null; org_type: string }[]
  custom_roles: { id: string; name: string; code: string }[]
}

export interface PrincipalDetail {
  identity: {
    id: string
    username: string
    display_name: string
    email: string | null
    domain_id: string
    domain_name: string
    department_id: string | null
    team_id: string | null
    primary_org_id: string | null
    status: string
    synced_at: string | null
  }
  org_context: {
    domain: { id: string; name: string } | null
    department: { id: string; name: string } | null
    team: { id: string; name: string } | null
    primary_org: { id: string; name: string } | null
    primary_org_path: { id: string; name: string; org_type: string }[]
    collaborations: { org_id: string; name: string; membership_type: string }[]
  }
  authorizations: PrincipalAuthorizations
}

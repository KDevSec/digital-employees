from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class IamDomain(Base):
    __tablename__ = "iam_domain"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IamDepartment(Base):
    __tablename__ = "iam_department"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    domain_id: Mapped[str] = mapped_column(ForeignKey("iam_domain.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IamTeam(Base):
    __tablename__ = "iam_team"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    department_id: Mapped[str] = mapped_column(ForeignKey("iam_department.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IamOrgType(Base):
    __tablename__ = "iam_org_type"
    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    icon: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class IamOrgNode(Base):
    __tablename__ = "iam_org_node"
    __table_args__ = (UniqueConstraint("domain_id", "org_code", name="uq_org_node_domain_code"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    keycloak_group_id: Mapped[str] = mapped_column(String(64), unique=True)
    domain_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("iam_org_node.id"), index=True)
    org_code: Mapped[str] = mapped_column(String(100))
    org_type: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IamOrgClosure(Base):
    __tablename__ = "iam_org_closure"
    ancestor_id: Mapped[str] = mapped_column(ForeignKey("iam_org_node.id"), primary_key=True)
    descendant_id: Mapped[str] = mapped_column(ForeignKey("iam_org_node.id"), primary_key=True)
    depth: Mapped[int] = mapped_column(Integer)


class IamSyncOperation(Base):
    __tablename__ = "iam_sync_operation"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    operation_type: Mapped[str] = mapped_column(String(60), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IamPrincipal(Base):
    __tablename__ = "iam_principal"
    __table_args__ = (UniqueConstraint("issuer", "subject"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    issuer: Mapped[str] = mapped_column(String(500))
    subject: Mapped[str] = mapped_column(String(200))
    username: Mapped[str] = mapped_column(String(200), index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320))
    domain_id: Mapped[str] = mapped_column(ForeignKey("iam_domain.id"), index=True)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("iam_department.id"), index=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("iam_team.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    keycloak_user_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    primary_org_id: Mapped[str | None] = mapped_column(ForeignKey("iam_org_node.id"), index=True)
    authorization_version: Mapped[int] = mapped_column(Integer, default=1)


class IamPrincipalOrg(Base):
    __tablename__ = "iam_principal_org"
    __table_args__ = (
        Index(
            "uq_principal_active_primary_org",
            "principal_id",
            unique=True,
            sqlite_where=text("membership_type = 'PRIMARY' AND status = 'ACTIVE'"),
            postgresql_where=text("membership_type = 'PRIMARY' AND status = 'ACTIVE'"),
        ),
        Index(
            "uq_principal_active_org_membership",
            "principal_id",
            "org_id",
            unique=True,
            sqlite_where=text("status = 'ACTIVE'"),
            postgresql_where=text("status = 'ACTIVE'"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("iam_org_node.id"), index=True)
    membership_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PermissionDefinition(Base):
    __tablename__ = "permission_definition"
    code: Mapped[str] = mapped_column(String(100), primary_key=True)
    resource_type: Mapped[str] = mapped_column(String(60), index=True)
    action: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(500))
    risk_level: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    delegable: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class CustomRole(Base):
    __tablename__ = "custom_role"
    __table_args__ = (UniqueConstraint("domain_id", "code", name="uq_custom_role_domain_code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    domain_id: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class CustomRolePermission(Base):
    __tablename__ = "custom_role_permission"
    role_id: Mapped[str] = mapped_column(ForeignKey("custom_role.id"), primary_key=True)
    permission_code: Mapped[str] = mapped_column(ForeignKey("permission_definition.code"), primary_key=True)


class ScopedRoleAssignment(Base):
    __tablename__ = "scoped_role_assignment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    role_id: Mapped[str] = mapped_column(ForeignKey("custom_role.id"), index=True)
    subject_type: Mapped[str] = mapped_column(String(20), index=True)
    subject_id: Mapped[str] = mapped_column(String(64), index=True)
    subject_include_descendants: Mapped[bool] = mapped_column(Boolean, default=False)
    scope_org_id: Mapped[str] = mapped_column(ForeignKey("iam_org_node.id"), index=True)
    scope_include_descendants: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_by: Mapped[str | None] = mapped_column(String(36))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)


class RoleAssignment(Base):
    __tablename__ = "role_assignment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    role_code: Mapped[str] = mapped_column(String(40), index=True)
    scope_type: Mapped[str] = mapped_column(String(40))
    domain_id: Mapped[str | None] = mapped_column(ForeignKey("iam_domain.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_by: Mapped[str | None] = mapped_column(String(36))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    departments: Mapped[list["RoleAssignmentDepartment"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class RoleAssignmentDepartment(Base):
    __tablename__ = "role_assignment_department"
    role_assignment_id: Mapped[str] = mapped_column(ForeignKey("role_assignment.id"), primary_key=True)
    department_id: Mapped[str] = mapped_column(ForeignKey("iam_org_node.id"), primary_key=True)


class WorkbenchPackage(Base):
    __tablename__ = "workbench_package"
    __table_args__ = (Index("ix_package_triplet_status", "version", "os", "arch", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[str] = mapped_column(String(50))
    os: Mapped[str] = mapped_column(String(30))
    arch: Mapped[str] = mapped_column(String(30))
    file_name: Mapped[str] = mapped_column(String(255))
    artifact_key: Mapped[str] = mapped_column(String(255), unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    signature_status: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="DRAFT", index=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EnrollmentRequest(Base):
    __tablename__ = "enrollment_request"
    __table_args__ = (
        UniqueConstraint(
            "owner_principal_id",
            "installation_id",
            "public_key_thumbprint",
            name="uq_enrollment_identity",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    owner_primary_org_id: Mapped[str | None] = mapped_column(ForeignKey("iam_org_node.id"), nullable=True, index=True)
    domain_id_snapshot: Mapped[str] = mapped_column(String(64), index=True)
    department_id_snapshot: Mapped[str | None] = mapped_column(String(64), index=True)
    team_id_snapshot: Mapped[str | None] = mapped_column(String(64))
    installation_id: Mapped[str] = mapped_column(String(36))
    public_jwk: Mapped[dict[str, Any]] = mapped_column(JSON)
    public_key_thumbprint: Mapped[str] = mapped_column(String(100))
    display_name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str] = mapped_column(String(50))
    os: Mapped[str] = mapped_column(String(30))
    arch: Mapped[str] = mapped_column(String(30))
    hostname: Mapped[str | None] = mapped_column(String(255))
    mac_addresses: Mapped[list[str] | None] = mapped_column(JSON)
    public_ip: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="PENDING_REVIEW", index=True)
    reviewer_id: Mapped[str | None] = mapped_column(String(36))
    review_reason: Mapped[str | None] = mapped_column(String(500))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EnrollmentChallenge(Base):
    __tablename__ = "enrollment_challenge"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    enrollment_request_id: Mapped[str] = mapped_column(ForeignKey("enrollment_request.id"), index=True)
    nonce_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MachineCredential(Base):
    __tablename__ = "machine_credential"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workbench_instance_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    public_jwk: Mapped[dict[str, Any]] = mapped_column(JSON)
    public_key_thumbprint: Mapped[str] = mapped_column(String(100))
    algorithm: Mapped[str] = mapped_column(String(20), default="ES256")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkbenchInstance(Base):
    __tablename__ = "workbench_instance"
    __table_args__ = (UniqueConstraint("enrollment_request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    enrollment_request_id: Mapped[str] = mapped_column(ForeignKey("enrollment_request.id"))
    owner_principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    domain_id: Mapped[str] = mapped_column(String(64), index=True)
    department_id: Mapped[str | None] = mapped_column(String(64), index=True)
    team_id: Mapped[str | None] = mapped_column(String(64))
    installation_id: Mapped[str] = mapped_column(String(36))
    display_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    credential_id: Mapped[str] = mapped_column(String(36), unique=True)
    reported_version: Mapped[str] = mapped_column(String(50))
    reported_os: Mapped[str] = mapped_column(String(30))
    reported_arch: Mapped[str] = mapped_column(String(30))
    hostname: Mapped[str | None] = mapped_column(String(255))
    mac_addresses: Mapped[list[str] | None] = mapped_column(JSON)
    public_ip: Mapped[str | None] = mapped_column(String(64))
    first_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_heartbeat_event_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_by: Mapped[str | None] = mapped_column(String(36))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(500))


class UsedJti(Base):
    __tablename__ = "used_jti"
    jti: Mapped[str] = mapped_column(String(200), primary_key=True)
    purpose: Mapped[str] = mapped_column(String(40), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class AuditEvent(Base):
    __tablename__ = "audit_event"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    category: Mapped[str] = mapped_column(String(20), index=True)
    actor_type: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str | None] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(100), index=True)
    domain_id_snapshot: Mapped[str | None] = mapped_column(String(64), index=True)
    department_id_snapshot: Mapped[str | None] = mapped_column(String(64), index=True)
    result: Mapped[str] = mapped_column(String(20), index=True)
    reason_code: Mapped[str | None] = mapped_column(String(80))
    summary: Mapped[str] = mapped_column(String(500))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    trace_id: Mapped[str] = mapped_column(String(36), index=True)


class PlatformSetting(Base):
    __tablename__ = "platform_setting"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_by: Mapped[str] = mapped_column(String(36))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class BffSession(Base):
    __tablename__ = "bff_session"
    id_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    id_token: Mapped[str | None] = mapped_column(Text)
    sid: Mapped[str | None] = mapped_column(String(255), index=True)


class ProblemFeedback(Base):
    __tablename__ = "problem_feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20), index=True)
    description: Mapped[str] = mapped_column(Text)
    contact: Mapped[str | None] = mapped_column(String(200))
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", index=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)
    submitter_principal_id: Mapped[str] = mapped_column(ForeignKey("iam_principal.id"), index=True)
    domain_id: Mapped[str] = mapped_column(String(64), index=True)
    department_id: Mapped[str | None] = mapped_column(String(64))
    admin_reply: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

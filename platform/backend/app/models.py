from datetime import UTC, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
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
    department_id: Mapped[str] = mapped_column(ForeignKey("iam_department.id"), primary_key=True)


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

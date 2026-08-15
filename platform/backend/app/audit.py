from uuid import uuid4

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEvent


def record_audit(
    session: Session,
    request: Request,
    *,
    event_type: str,
    category: str,
    actor_type: str,
    actor_id: str | None,
    target_type: str,
    target_id: str | None,
    domain_id: str | None,
    department_id: str | None,
    result: str = "SUCCESS",
    reason_code: str | None = None,
    summary: str,
) -> None:
    session.add(
        AuditEvent(
            id=str(uuid4()),
            event_type=event_type,
            category=category,
            actor_type=actor_type,
            actor_id=actor_id,
            target_type=target_type,
            target_id=target_id,
            domain_id_snapshot=domain_id,
            department_id_snapshot=department_id,
            result=result,
            reason_code=reason_code,
            summary=summary,
            trace_id=request.state.trace_id,
        )
    )

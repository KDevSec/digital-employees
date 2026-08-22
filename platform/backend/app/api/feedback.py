import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.core import PaginatedResponse
from app.api.dependencies import (
    AuthenticatedPrincipal,
    get_current_principal,
    require_permission,
)
from app.audit import record_audit
from app.database import get_session
from app.domain.states import FeedbackStatus, transition_feedback
from app.errors import ApiError
from app.models import IamPrincipal, ProblemFeedback, utc_now

logger = logging.getLogger("platform.feedback")

router = APIRouter()

CATEGORIES = {"BUG", "SUGGESTION", "QUESTION", "OTHER"}
PRIORITIES = {"LOW", "MEDIUM", "HIGH"}


class FeedbackCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=20)
    description: str = Field(min_length=1, max_length=5000)
    priority: str = Field(default="MEDIUM", min_length=1, max_length=20)
    contact: str | None = Field(default=None, max_length=200)


class FeedbackUpdate(BaseModel):
    status: str | None = Field(default=None, min_length=1, max_length=20)
    category: str | None = Field(default=None, min_length=1, max_length=20)
    priority: str | None = Field(default=None, min_length=1, max_length=20)
    admin_reply: str | None = Field(default=None, max_length=5000)


def feedback_json(item: ProblemFeedback, submitter_display_name: str | None = None) -> dict:
    data = {
        "id": item.id,
        "title": item.title,
        "category": item.category,
        "description": item.description,
        "contact": item.contact,
        "priority": item.priority,
        "status": item.status,
        "submitter_principal_id": item.submitter_principal_id,
        "admin_reply": item.admin_reply,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "resolved_at": item.resolved_at,
    }
    if submitter_display_name is not None:
        data["submitter_display_name"] = submitter_display_name
    return data


@router.post("/api/v1/feedback", status_code=status.HTTP_201_CREATED)
async def create_feedback(
    request: Request,
    payload: FeedbackCreate,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    if payload.category not in CATEGORIES:
        raise ApiError(422, "FEEDBACK_CATEGORY_INVALID", "Invalid category")
    if payload.priority not in PRIORITIES:
        raise ApiError(422, "FEEDBACK_PRIORITY_INVALID", "Invalid priority")
    item = ProblemFeedback(
        id=str(uuid4()),
        title=payload.title,
        category=payload.category,
        description=payload.description,
        contact=payload.contact,
        priority=payload.priority,
        status=FeedbackStatus.OPEN,
        submitter_principal_id=identity.principal.id,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
    )
    session.add(item)
    record_audit(
        session,
        request,
        event_type="FEEDBACK_CREATED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="PROBLEM_FEEDBACK",
        target_id=item.id,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary=f"Submitted feedback: {payload.title[:120]}",
    )
    session.commit()
    logger.info(
        "feedback created",
        extra={
            "trace_id": request.state.trace_id,
            "actor_id": identity.principal.id,
            "feedback_id": item.id,
        },
    )
    return feedback_json(item)


@router.get("/api/v1/feedback/mine")
async def my_feedback(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    category: str | None = Query(default=None, max_length=20),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse:
    statement = select(ProblemFeedback).where(
        ProblemFeedback.submitter_principal_id == identity.principal.id
    )
    if status_filter:
        statement = statement.where(ProblemFeedback.status == status_filter)
    if category:
        statement = statement.where(ProblemFeedback.category == category)
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = session.scalars(
        statement.order_by(ProblemFeedback.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return PaginatedResponse(
        items=[feedback_json(row) for row in rows],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.get("/api/v1/feedback/{feedback_id}")
async def get_feedback(
    feedback_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    item = session.get(ProblemFeedback, feedback_id)
    if item is None:
        raise ApiError(404, "FEEDBACK_NOT_FOUND", "Feedback not found")
    if item.submitter_principal_id != identity.principal.id:
        require_permission(identity, "feedback.manage")
    return feedback_json(item)


@router.get("/api/v1/admin/feedback")
async def admin_list_feedback(
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    category: str | None = Query(default=None, max_length=20),
    priority: str | None = Query(default=None, max_length=20),
    q: str | None = Query(default=None, max_length=200),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse:
    require_permission(identity, "feedback.manage")
    statement = select(ProblemFeedback, IamPrincipal.display_name).outerjoin(
        IamPrincipal, ProblemFeedback.submitter_principal_id == IamPrincipal.id
    )
    if status_filter:
        statement = statement.where(ProblemFeedback.status == status_filter)
    if category:
        statement = statement.where(ProblemFeedback.category == category)
    if priority:
        statement = statement.where(ProblemFeedback.priority == priority)
    if q:
        like = f"%{q}%"
        statement = statement.where(
            or_(
                ProblemFeedback.title.ilike(like),
                ProblemFeedback.description.ilike(like),
            )
        )
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = session.execute(
        statement.order_by(ProblemFeedback.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return PaginatedResponse(
        items=[feedback_json(item, name) for item, name in rows],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.patch("/api/v1/admin/feedback/{feedback_id}")
async def update_feedback(
    feedback_id: str,
    request: Request,
    payload: FeedbackUpdate,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "feedback.manage")
    item = session.get(ProblemFeedback, feedback_id)
    if item is None:
        raise ApiError(404, "FEEDBACK_NOT_FOUND", "Feedback not found")
    if payload.status is not None and payload.status != item.status:
        try:
            new_status = transition_feedback(
                FeedbackStatus(item.status), FeedbackStatus(payload.status)
            )
        except ValueError as exc:
            raise ApiError(409, "FEEDBACK_STATE_INVALID", "Status transition is not allowed") from exc
        item.status = new_status
        if new_status is FeedbackStatus.RESOLVED:
            item.resolved_at = utc_now()
        else:
            item.resolved_at = None
    if payload.category is not None:
        if payload.category not in CATEGORIES:
            raise ApiError(422, "FEEDBACK_CATEGORY_INVALID", "Invalid category")
        item.category = payload.category
    if payload.priority is not None:
        if payload.priority not in PRIORITIES:
            raise ApiError(422, "FEEDBACK_PRIORITY_INVALID", "Invalid priority")
        item.priority = payload.priority
    if payload.admin_reply is not None:
        item.admin_reply = payload.admin_reply
    item.updated_at = utc_now()
    record_audit(
        session,
        request,
        event_type="FEEDBACK_UPDATED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="PROBLEM_FEEDBACK",
        target_id=item.id,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary=f"Updated feedback {item.id}: status={item.status}",
    )
    session.commit()
    logger.info(
        "feedback updated",
        extra={
            "trace_id": request.state.trace_id,
            "actor_id": identity.principal.id,
            "feedback_id": item.id,
            "status": item.status,
        },
    )
    return feedback_json(item)

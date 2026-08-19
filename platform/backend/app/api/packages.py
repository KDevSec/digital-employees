import hashlib
import logging
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.api.core import PaginatedResponse
from app.audit import record_audit
from app.database import get_session
from app.domain.states import PackageStatus, transition_package
from app.errors import ApiError
from app.models import WorkbenchPackage, utc_now

logger = logging.getLogger("platform.packages")


router = APIRouter()
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


def package_json(item: WorkbenchPackage) -> dict:
    return {
        "id": item.id,
        "version": item.version,
        "os": item.os,
        "arch": item.arch,
        "file_name": item.file_name,
        "size_bytes": item.size_bytes,
        "sha256": item.sha256,
        "signature_status": item.signature_status,
        "status": item.status,
        "created_at": item.created_at,
        "published_at": item.published_at,
    }


@router.get("/api/v1/public/workbench-packages")
async def public_packages(session: Session = Depends(get_session)) -> list[dict]:
    from sqlalchemy import func
    latest = (
        select(
            WorkbenchPackage.os,
            WorkbenchPackage.arch,
            func.max(WorkbenchPackage.published_at).label("max_published"),
        )
        .where(WorkbenchPackage.status == PackageStatus.PUBLISHED)
        .group_by(WorkbenchPackage.os, WorkbenchPackage.arch)
    ).subquery()
    rows = session.scalars(
        select(WorkbenchPackage)
        .join(latest, (WorkbenchPackage.os == latest.c.os) & (WorkbenchPackage.arch == latest.c.arch) & (WorkbenchPackage.published_at == latest.c.max_published))
        .where(WorkbenchPackage.status == PackageStatus.PUBLISHED)
        .order_by(WorkbenchPackage.os, WorkbenchPackage.arch)
    ).all()
    return [package_json(row) for row in rows]


@router.get("/api/v1/public/workbench-packages/{package_id}/download")
async def download_package(package_id: str, request: Request, session: Session = Depends(get_session)) -> Response:
    item = session.get(WorkbenchPackage, package_id)
    if item is None or item.status != PackageStatus.PUBLISHED:
        raise ApiError(404, "PACKAGE_NOT_FOUND", "Published package not found")
    path = request.app.state.settings.package_storage_path / item.artifact_key
    if not path.is_file():
        raise ApiError(404, "PACKAGE_NOT_FOUND", "Published package not found")
    return Response(
        content=path.read_bytes(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{item.file_name}"'},
    )


@router.get("/api/v1/public/workbench-packages/history")
async def public_packages_history(
    os: str | None = Query(default=None, max_length=30),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    from sqlalchemy import func
    base = select(WorkbenchPackage).where(WorkbenchPackage.status == PackageStatus.PUBLISHED)
    if os:
        base = base.where(WorkbenchPackage.os == os.lower())
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    rows = session.scalars(
        base.order_by(WorkbenchPackage.published_at.desc()).offset(offset).limit(limit)
    ).all()
    return PaginatedResponse(
        items=[package_json(row) for row in rows],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.get("/api/v1/admin/workbench-packages")
async def admin_packages(
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> PaginatedResponse:
    require_permission(identity, "package.manage")
    from sqlalchemy import func
    base = select(WorkbenchPackage)
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    rows = session.scalars(
        base.order_by(WorkbenchPackage.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return PaginatedResponse(
        items=[package_json(row) for row in rows],
        total=total or 0,
        offset=offset,
        limit=limit,
    )


@router.post("/api/v1/admin/workbench-packages", status_code=status.HTTP_201_CREATED)
async def upload_package(
    request: Request,
    version: str = Form(min_length=1, max_length=50),
    os: str = Form(min_length=1, max_length=30),
    arch: str = Form(min_length=1, max_length=30),
    signature_status: str = Form(pattern="^(VALID|INVALID|UNVERIFIED)$"),
    file: UploadFile = File(),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "package.manage")
    content = file.file.read(request.app.state.settings.max_package_bytes + 1)
    if not content or len(content) > request.app.state.settings.max_package_bytes:
        raise ApiError(413, "PACKAGE_SIZE_INVALID", "Package is empty or exceeds the configured limit")
    package_id = str(uuid4())
    safe_name = SAFE_NAME.sub("_", Path(file.filename or "package.bin").name)
    artifact_key = f"{package_id}-{safe_name}"
    storage_path = request.app.state.settings.package_storage_path / artifact_key
    storage_path.write_bytes(content)
    item = WorkbenchPackage(
        id=package_id,
        version=version,
        os=os.lower(),
        arch=arch.lower(),
        file_name=safe_name,
        artifact_key=artifact_key,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        signature_status=signature_status,
        status=PackageStatus.DRAFT,
        created_by=identity.principal.id,
    )
    session.add(item)
    record_audit(
        session,
        request,
        event_type="PACKAGE_UPLOADED",
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="WORKBENCH_PACKAGE",
        target_id=item.id,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary=f"Uploaded package {version} for {os}/{arch}",
    )
    session.commit()
    logger.info("package uploaded", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "package_id": item.id, "version": version})
    return package_json(item)


def change_package_status(
    package_id: str,
    target: PackageStatus,
    request: Request,
    identity: AuthenticatedPrincipal,
    session: Session,
) -> dict:
    require_permission(identity, "package.manage")
    item = session.get(WorkbenchPackage, package_id)
    if item is None:
        raise ApiError(404, "PACKAGE_NOT_FOUND", "Package not found")
    try:
        item.status = transition_package(PackageStatus(item.status), target)
    except ValueError as exc:
        raise ApiError(409, "PACKAGE_STATE_INVALID", "Package state transition is not allowed") from exc
    if target is PackageStatus.PUBLISHED:
        conflict = session.scalar(
            select(WorkbenchPackage).where(
                WorkbenchPackage.version == item.version,
                WorkbenchPackage.os == item.os,
                WorkbenchPackage.arch == item.arch,
                WorkbenchPackage.status == PackageStatus.PUBLISHED,
                WorkbenchPackage.id != item.id,
            )
        )
        if conflict:
            raise ApiError(409, "PACKAGE_ALREADY_PUBLISHED", "A package for this version and target is already published")
        item.published_at = utc_now()
    else:
        item.withdrawn_at = utc_now()
    event = "PACKAGE_PUBLISHED" if target is PackageStatus.PUBLISHED else "PACKAGE_WITHDRAWN"
    record_audit(
        session,
        request,
        event_type=event,
        category="OPERATION",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="WORKBENCH_PACKAGE",
        target_id=item.id,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary=f"Changed package status to {target}",
    )
    logger.info("package status changed", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "package_id": item.id, "status": str(target), "event_type": event})
    session.commit()
    return package_json(item)


@router.post("/api/v1/admin/workbench-packages/{package_id}/publish")
async def publish_package(
    package_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    return change_package_status(package_id, PackageStatus.PUBLISHED, request, identity, session)


@router.post("/api/v1/admin/workbench-packages/{package_id}/withdraw")
async def withdraw_package(
    package_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    return change_package_status(package_id, PackageStatus.WITHDRAWN, request, identity, session)

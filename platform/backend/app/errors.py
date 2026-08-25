import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


logger = logging.getLogger("platform.errors")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


def _trace_id(request: Request) -> str:
    return getattr(request.state, "trace_id", str(uuid4()))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        trace_id = _trace_id(request)
        request.state.error_code = exc.code
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "trace_id": trace_id,
                    **({"details": exc.details} if exc.details is not None else {}),
                }
            },
            headers={"X-Trace-Id": trace_id},
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        trace_id = _trace_id(request)
        logger.error("DB integrity error: %s", exc, extra={"trace_id": trace_id})
        request.state.error_code = "DB_INTEGRITY_ERROR"
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "DB_INTEGRITY_ERROR",
                    "message": "Database integrity constraint violated",
                    "trace_id": trace_id,
                }
            },
            headers={"X-Trace-Id": trace_id},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        trace_id = _trace_id(request)
        logger.error("Unexpected error: %s", exc, extra={"trace_id": trace_id})
        request.state.error_code = "INTERNAL_ERROR"
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Internal server error",
                    "trace_id": trace_id,
                }
            },
            headers={"X-Trace-Id": trace_id},
        )

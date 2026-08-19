from collections.abc import Iterator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


_engine = None
_session_factory = None


def configure_database(url: str) -> None:
    global _engine, _session_factory
    settings = get_settings()
    _engine = create_engine(
        url,
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )
    _session_factory = sessionmaker(_engine, expire_on_commit=False)


def get_session_factory(url: str | None = None):
    global _session_factory
    if _session_factory is None:
        configure_database(url or get_settings().database_url)
    return _session_factory


async def get_session() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session

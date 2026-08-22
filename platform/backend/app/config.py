from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLATFORM_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://platform:platform@postgres:5432/platform"
    package_storage_path: Path = Path("/var/lib/platform/packages")
    platform_base_url: str = "http://localhost:18000"
    workbench_base_url: str = "http://localhost:19820"
    oidc_issuer: str = "http://localhost:18080/realms/digital-employees"
    oidc_internal_issuer: str | None = None
    oidc_client_id: str = "platform-web"
    oidc_client_secret: str = "change-me-platform-client-secret"
    oidc_admin_url: str = "http://localhost:18080"
    oidc_realm: str = "digital-employees"
    iam_sync_client_id: str = "platform-iam-sync"
    iam_sync_client_secret: str = "change-me-iam-sync-secret"
    session_secret: str = Field(default="change-me-session-secret-32-characters", min_length=32)
    machine_signing_secret: str = Field(default="change-me-machine-signing-secret-32-chars", min_length=32)
    challenge_ttl_seconds: int = Field(default=300, ge=60, le=900)
    machine_token_ttl_seconds: int = Field(default=300, ge=60, le=300)
    heartbeat_offline_seconds: int = Field(default=90, ge=30, le=3600)
    directory_sync_ttl_seconds: int = Field(default=60, ge=30, le=3600)
    enrollment_ttl_hours: int = Field(default=24, ge=1, le=168)
    max_package_bytes: int = Field(default=100 * 1024 * 1024, ge=1)
    bootstrap_system_username: str = "system.admin"
    db_pool_size: int = Field(default=20, ge=5, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=50)
    log_level: str = Field(default="INFO", pattern="^(DEBUG|INFO|WARNING|ERROR)$")
    log_dir: Path = Path("/var/log/platform")
    log_max_mb: int = Field(default=10, ge=1, le=512)
    log_retention_days: int = Field(default=7, ge=1, le=90)
    log_compress: bool = True
    testing: bool = False

    @field_validator("platform_base_url", "workbench_base_url", "oidc_issuer")
    @classmethod
    def validate_public_url(cls, value: str) -> str:
        parsed = AnyHttpUrl(value)
        host = parsed.host or ""
        try:
            private_ip = ip_address(host).is_private
        except ValueError:
            private_ip = False
        if parsed.scheme != "https" and host not in {"localhost", "keycloak"} and not private_ip:
            raise ValueError("non-local URLs must use HTTPS")
        return value.rstrip("/")

    @property
    def oidc_discovery_issuer(self) -> str:
        return (self.oidc_internal_issuer or self.oidc_issuer).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()

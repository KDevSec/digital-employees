import pytest
from pydantic import ValidationError
from alembic.config import Config

from app.config import Settings


def test_private_vm_http_urls_are_allowed_for_local_acceptance() -> None:
    settings = Settings(
        platform_base_url="http://192.168.153.128:18000",
        workbench_base_url="http://192.168.153.128:19820",
        oidc_issuer="http://192.168.153.128:18080/realms/digital-employees",
    )

    assert settings.platform_base_url == "http://192.168.153.128:18000"


def test_public_non_https_url_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(platform_base_url="http://example.com:18000")


def test_percent_encoded_database_password_can_be_set_in_alembic_config() -> None:
    database_url = "postgresql+psycopg://platform:Horse~test%402026@postgres:5432/platform"
    config = Config()

    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

    assert config.get_main_option("sqlalchemy.url") == database_url

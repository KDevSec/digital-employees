"""Add terminal metadata columns (hostname, os version, ips, mac, public ip, install path).

Defensive: 0001_initial builds the schema via Base.metadata.create_all, so a
fresh database already has the columns from the model. This migration only adds
them when absent (existing databases migrated by an older revision).
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_terminal_metadata"
down_revision = "0002_add_bff_session_sid"
branch_labels = None
depends_on = None

METADATA_COLUMNS = [
    ("hostname", sa.String(length=255)),
    ("os_version", sa.String(length=120)),
    ("os_platform", sa.String(length=50)),
    ("internal_ips", sa.JSON()),
    ("mac_addresses", sa.JSON()),
    ("public_ip", sa.String(length=64)),
    ("install_path", sa.String(length=500)),
]

TABLES = ["enrollment_request", "workbench_instance"]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in TABLES:
        existing = {col["name"] for col in inspector.get_columns(table)}
        for name, column_type in METADATA_COLUMNS:
            if name not in existing:
                op.add_column(table, sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    for table in TABLES:
        for name, _ in METADATA_COLUMNS:
            op.drop_column(table, name)

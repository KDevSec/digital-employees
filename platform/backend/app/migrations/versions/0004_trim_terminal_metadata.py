"""Drop trimmed-away terminal metadata columns (os_version, os_platform, internal_ips, install_path).

024: terminal metadata is reduced to hostname + primary MAC + platform-observed IP.
Defensive: fresh databases are built via Base.metadata.create_all from the model, so
this migration only drops columns when they exist (databases migrated by 0003).
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_trim_terminal_metadata"
down_revision = "0003_terminal_metadata"
branch_labels = None
depends_on = None

DROP_COLUMNS = ["os_version", "os_platform", "internal_ips", "install_path"]
TABLES = ["enrollment_request", "workbench_instance"]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {table: {col["name"] for col in inspector.get_columns(table)} for table in inspector.get_table_names()}
    for table in TABLES:
        if table not in existing:
            continue
        for column in DROP_COLUMNS:
            if column in existing[table]:
                op.drop_column(table, column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {table: {col["name"] for col in inspector.get_columns(table)} for table in inspector.get_table_names()}
    re_add = [
        ("os_version", sa.String(length=120)),
        ("os_platform", sa.String(length=50)),
        ("internal_ips", sa.JSON()),
        ("install_path", sa.String(length=500)),
    ]
    for table in TABLES:
        if table not in existing:
            continue
        for name, column_type in re_add:
            if name not in existing[table]:
                op.add_column(table, sa.Column(name, column_type, nullable=True))

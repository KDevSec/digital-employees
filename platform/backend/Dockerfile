FROM python:3.11.6-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY backend/alembic.ini backend/entrypoint.sh ./
COPY VERSION ./VERSION
COPY backend/app ./app
RUN chmod 0755 entrypoint.sh && mkdir -p /var/lib/platform/packages
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]

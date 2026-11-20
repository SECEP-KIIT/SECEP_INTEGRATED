FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN groupadd --gid 10001 secep \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin secep

WORKDIR /app

# Install shared common package if present, then ingestion service
COPY shared/python/secep_common /app/shared/python/secep_common
COPY services/ingestion/pyproject.toml /app/services/ingestion/pyproject.toml
COPY services/ingestion/README.md /app/services/ingestion/README.md
COPY services/ingestion/ingestion /app/services/ingestion/ingestion

RUN pip install --upgrade pip \
    && pip install /app/services/ingestion

ENV PYTHONPATH=/app/shared/python:/app/services/ingestion

USER secep

EXPOSE 8004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8004/health', timeout=3)"

CMD ["python", "-m", "ingestion.main"]

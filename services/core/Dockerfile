FROM python:3.13-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index /wheels/* && rm -rf /wheels
COPY alembic.ini .
COPY migrations migrations
COPY sitrep sitrep
USER 10001:10001
CMD ["uvicorn", "sitrep.api:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/model-cache

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .

RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.11.0+cpu" \
    && pip install -r requirements.txt

COPY backend/app ./app
COPY backend/schema.sql .

RUN useradd --create-home appuser \
    && mkdir -p /app/data /app/model-cache \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
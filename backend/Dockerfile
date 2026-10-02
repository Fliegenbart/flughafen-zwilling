FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TWIN_DATA_DIR=/app/data

WORKDIR /app

ARG INSTALL_HIL_EXTRAS=false

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --upgrade pip && \
    if [ "$INSTALL_HIL_EXTRAS" = "true" ]; then \
      pip install ".[hil]"; \
    else \
      pip install .; \
    fi

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

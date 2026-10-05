FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENV TWIN_REFERENCE_DIR=/opt/airport-references
ENV TWIN_SCENARIO_LIBRARY_DIR=/opt/airport-seeds/scenarios
WORKDIR /app
COPY backend/pyproject.toml backend/README.md ./
COPY backend/requirements-demo.txt ./
RUN pip install --no-cache-dir -r requirements-demo.txt
COPY backend/app ./app
COPY scripts/instance_users.py scripts/pilot_backup.py ./scripts/
RUN pip install --no-cache-dir --no-deps .
COPY data/scenarios /opt/airport-seeds/scenarios
COPY data/model_packs /opt/airport-seeds/model_packs
COPY data/references /opt/airport-references
COPY deploy/demo/backend-entrypoint.sh /usr/local/bin/airport-entrypoint
RUN chmod +x /usr/local/bin/airport-entrypoint
ENTRYPOINT ["airport-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

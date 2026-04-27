FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install demo dependencies
COPY kernelmcp-demo/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install all 5 suite libs + kernelmcp from local source
COPY memorymcp/memorymcp/ /tmp/memorymcp/memorymcp/
COPY memorymcp/pyproject.toml /tmp/memorymcp/pyproject.toml
COPY memorymcp/README.md /tmp/memorymcp/README.md
RUN pip install --no-cache-dir --no-deps /tmp/memorymcp && rm -rf /tmp/memorymcp

COPY planningmcp/planningmcp/ /tmp/planningmcp/planningmcp/
COPY planningmcp/pyproject.toml /tmp/planningmcp/pyproject.toml
COPY planningmcp/README.md /tmp/planningmcp/README.md
RUN pip install --no-cache-dir --no-deps /tmp/planningmcp && rm -rf /tmp/planningmcp

COPY workspacemcp/workspacemcp/ /tmp/workspacemcp/workspacemcp/
COPY workspacemcp/pyproject.toml /tmp/workspacemcp/pyproject.toml
COPY workspacemcp/README.md /tmp/workspacemcp/README.md
RUN pip install --no-cache-dir --no-deps /tmp/workspacemcp && rm -rf /tmp/workspacemcp

COPY sandboxmcp/sandboxmcp/ /tmp/sandboxmcp/sandboxmcp/
COPY sandboxmcp/pyproject.toml /tmp/sandboxmcp/pyproject.toml
COPY sandboxmcp/README.md /tmp/sandboxmcp/README.md
RUN pip install --no-cache-dir --no-deps /tmp/sandboxmcp && rm -rf /tmp/sandboxmcp

COPY kernelmcp/kernelmcp/ /tmp/kernelmcp/kernelmcp/
COPY kernelmcp/pyproject.toml /tmp/kernelmcp/pyproject.toml
COPY kernelmcp/README.md /tmp/kernelmcp/README.md
RUN pip install --no-cache-dir --no-deps /tmp/kernelmcp && rm -rf /tmp/kernelmcp

# Copy the demo backend application
COPY kernelmcp-demo/backend/ /app/

# Data directory for persistent config
RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

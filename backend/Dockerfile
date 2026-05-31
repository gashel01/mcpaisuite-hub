FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (client only, for host_exec)
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker

WORKDIR /app

# ── Layer 1: pip dependencies (rarely changes → cached) ─────────────────
COPY kernelmcp-demo/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir beautifulsoup4 lxml playwright pypdf chromadb \
    && python -m playwright install chromium

# Install suite lib deps from pyproject.toml only (source code comes later)
COPY memorymcp/pyproject.toml memorymcp/README.md /tmp/memorymcp/
RUN mkdir -p /tmp/memorymcp/memorymcp && touch /tmp/memorymcp/memorymcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/memorymcp && rm -rf /tmp/memorymcp

COPY ltpmcp/pyproject.toml ltpmcp/README.md /tmp/ltpmcp/
RUN mkdir -p /tmp/ltpmcp/ltpmcp && touch /tmp/ltpmcp/ltpmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/ltpmcp && rm -rf /tmp/ltpmcp

COPY planningmcp/pyproject.toml planningmcp/README.md /tmp/planningmcp/
RUN mkdir -p /tmp/planningmcp/planningmcp && touch /tmp/planningmcp/planningmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/planningmcp && rm -rf /tmp/planningmcp

COPY workspacemcp/pyproject.toml workspacemcp/README.md /tmp/workspacemcp/
RUN mkdir -p /tmp/workspacemcp/workspacemcp && touch /tmp/workspacemcp/workspacemcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/workspacemcp && rm -rf /tmp/workspacemcp

COPY websearchmcp/pyproject.toml websearchmcp/README.md /tmp/websearchmcp/
RUN mkdir -p /tmp/websearchmcp/websearchmcp && touch /tmp/websearchmcp/websearchmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/websearchmcp && rm -rf /tmp/websearchmcp

COPY sandboxmcp/pyproject.toml sandboxmcp/README.md /tmp/sandboxmcp/
RUN mkdir -p /tmp/sandboxmcp/sandboxmcp && touch /tmp/sandboxmcp/sandboxmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/sandboxmcp && rm -rf /tmp/sandboxmcp \
    && pip install --no-cache-dir docker>=7.0

COPY schedulermcp/pyproject.toml schedulermcp/README.md /tmp/schedulermcp/
RUN mkdir -p /tmp/schedulermcp/schedulermcp && touch /tmp/schedulermcp/schedulermcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/schedulermcp && rm -rf /tmp/schedulermcp

COPY ragmcp/pyproject.toml ragmcp/README.md /tmp/ragmcp/
RUN mkdir -p /tmp/ragmcp/ragmcp && touch /tmp/ragmcp/ragmcp/__init__.py \
    && pip install --no-cache-dir "/tmp/ragmcp[fastembed,qdrant]" && rm -rf /tmp/ragmcp

COPY evalmcp/pyproject.toml evalmcp/README.md /tmp/evalmcp/
RUN mkdir -p /tmp/evalmcp/evalmcp && touch /tmp/evalmcp/evalmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/evalmcp && rm -rf /tmp/evalmcp

COPY kernelmcp/pyproject.toml kernelmcp/README.md /tmp/kernelmcp/
RUN mkdir -p /tmp/kernelmcp/kernelmcp && touch /tmp/kernelmcp/kernelmcp/__init__.py \
    && pip install --no-cache-dir --no-deps /tmp/kernelmcp && rm -rf /tmp/kernelmcp

# ── Layer 2: source code (changes often → fast rebuild) ──────────────────
# Just copy Python source into the already-installed site-packages
COPY memorymcp/memorymcp/ /usr/local/lib/python3.11/site-packages/memorymcp/
COPY ltpmcp/ltpmcp/ /usr/local/lib/python3.11/site-packages/ltpmcp/
COPY planningmcp/planningmcp/ /usr/local/lib/python3.11/site-packages/planningmcp/
COPY workspacemcp/workspacemcp/ /usr/local/lib/python3.11/site-packages/workspacemcp/
COPY websearchmcp/websearchmcp/ /usr/local/lib/python3.11/site-packages/websearchmcp/
COPY sandboxmcp/sandboxmcp/ /usr/local/lib/python3.11/site-packages/sandboxmcp/
COPY schedulermcp/schedulermcp/ /usr/local/lib/python3.11/site-packages/schedulermcp/
COPY ragmcp/ragmcp/ /usr/local/lib/python3.11/site-packages/ragmcp/
COPY evalmcp/evalmcp/ /usr/local/lib/python3.11/site-packages/evalmcp/
COPY kernelmcp/kernelmcp/ /usr/local/lib/python3.11/site-packages/kernelmcp/

# ── PyPI mode: override local source with published packages ─────────────
ARG PYPI_MODE=0
ARG PYPI_INDEX=https://pypi.org/simple/
RUN if [ "$PYPI_MODE" = "1" ]; then \
    pip install --no-cache-dir \
      --index-url "$PYPI_INDEX" \
      --extra-index-url https://pypi.org/simple/ \
      kernelmcp memorymcp planningmcp workspacemcp sandboxmcp \
      schedulermcp "ragmcp[fastembed,qdrant]" evalmcp ltpmcp websearchmcp; \
fi

# ── Layer 3: demo app (changes most often → always fast) ─────────────────
COPY kernelmcp-demo/backend/ /app/

RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

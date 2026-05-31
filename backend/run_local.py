"""Run the demo backend locally on port 9003 with local data directory."""
import os, sys

DATA = r"C:\Users\gaeli\Documents\Claude\Projects\kernelmcp-demo\data"
WORKSPACE = os.path.join(DATA, "workspace")

os.environ["KERNELMCP_DATA_DIR"] = DATA
os.environ["KERNELMCP_NAMESPACE"] = "demo"
os.environ["WORKSPACE_ROOT"] = WORKSPACE
os.environ["WORKSPACE_HOST_PATH"] = WORKSPACE

# Note: settings.json workspace_root should stay as /app/data/workspace for Docker.
# run_local.py uses WORKSPACE_ROOT env var instead (server.py reads env first, then settings.json).

import uvicorn
uvicorn.run("server:app", host="0.0.0.0", port=9003, reload=False)

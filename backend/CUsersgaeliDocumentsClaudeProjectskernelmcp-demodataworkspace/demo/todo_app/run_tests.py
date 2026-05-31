"""
Test runner — copies app files to /tmp and runs pytest there.
"""
import os, shutil, subprocess, sys

src = "/workspace/workspace/demo"
dst = "/tmp/todo_app"

# Locate actual workspace files via __file__ trick
# Files are in the same directory as this script
here = os.path.dirname(os.path.abspath(__file__))
print(f"Script dir: {here}")
print(f"Files: {os.listdir(here)}")

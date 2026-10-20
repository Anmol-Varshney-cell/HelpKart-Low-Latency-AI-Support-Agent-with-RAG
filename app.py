"""Repo-root entrypoint shim so Vercel's Python runtime finds the Flask app.

Vercel zero-config Python looks for app.py at the repository root; the real
application lives in python/app.py. This shim loads it and re-exports `app`.
"""

import importlib.util
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_pkg = os.path.join(_here, "python")
sys.path.insert(0, _pkg)

_spec = importlib.util.spec_from_file_location("helpkart_app", os.path.join(_pkg, "app.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

app = _mod.app

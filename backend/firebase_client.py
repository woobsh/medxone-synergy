"""Firebase Realtime Database client for MEDXONE SYNERGY.

Uses ONLY Firebase Realtime Database — product images are stored as base64
inside RTDB so Firebase Storage doesn't need to be enabled.
"""
from __future__ import annotations

import os
import logging
import threading
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger("medxone.firebase")

_firebase_app = None
_db_module = None  # firebase_admin.db
_init_error: Optional[str] = None
_lock = threading.Lock()


def _init() -> None:
    global _firebase_app, _db_module, _init_error

    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "").strip()
    database_url = os.environ.get("FIREBASE_DATABASE_URL", "").strip()

    if not cred_path or not os.path.isfile(cred_path):
        _init_error = (
            f"Firebase credentials file not found at '{cred_path}'. "
            "Place your service-account JSON there and restart the backend."
        )
        return
    if not database_url:
        _init_error = (
            "FIREBASE_DATABASE_URL env variable is empty. Set it to your "
            "Realtime Database URL (e.g. 'https://your-project-default-rtdb.firebaseio.com')."
        )
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, db as _db

        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            _firebase_app = firebase_admin.initialize_app(
                cred, {"databaseURL": database_url}
            )
        else:
            _firebase_app = firebase_admin.get_app()

        _db_module = _db
        _init_error = None
        logger.info("Firebase Realtime Database initialised. URL=%s", database_url)
    except Exception as exc:  # pragma: no cover - configuration error path
        _init_error = f"Firebase init failed: {exc}"
        logger.error(_init_error)


def _ensure_ready():
    if _db_module is None:
        with _lock:
            if _db_module is None:
                _init()
    if _init_error:
        raise HTTPException(status_code=503, detail=_init_error)


def is_ready() -> bool:
    if _db_module is None:
        with _lock:
            if _db_module is None:
                _init()
    return _init_error is None


def ref(path: str):
    """Get a RTDB reference at the given path (e.g. 'products' or 'products/xxx')."""
    _ensure_ready()
    return _db_module.reference("/" + path.strip("/"))


def init_at_startup() -> None:
    with _lock:
        _init()
    if _init_error:
        logger.warning("Firebase not ready at startup: %s", _init_error)

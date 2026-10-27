"""First-run setup state: the system needs setup while no user exists."""

import hashlib
import hmac

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import User

SETUP_LOCK_ID = 7310  # next to the singleton-loop ids in main.py
_done = False  # once a user exists this never flips back, so the check is free from then on


def setup_needed(db: Session) -> bool:
    global _done
    if _done:
        return False
    if db.scalar(select(User.id).limit(1)) is not None:
        _done = True
        return False
    return True


def setup_needed_now() -> bool:
    """For the request guard, which has no request session."""
    if _done:
        return False
    with SessionLocal() as db:
        return setup_needed(db)


def lock_setup(db: Session) -> None:
    """Serialize concurrent setups until the transaction ends; the loser re-checks and finds the admin."""
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SETUP_LOCK_ID})


def reset_setup_cache() -> None:
    global _done
    _done = False


def expected_setup_token() -> str:
    """NIS2_SETUP_TOKEN, else derived from the secret key so it is stable across restarts and workers."""
    s = get_settings()
    if s.setup_token:
        return s.setup_token
    return hmac.new(s.secret_key.encode(), b"nis2-setup-token-v1", hashlib.sha256).hexdigest()[:24]

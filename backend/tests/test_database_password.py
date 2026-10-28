"""The database password is passed on its own, so any character works (no URL escaping by the operator)."""

import re
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.config import Settings

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "deploy" / "docker-compose.yml").read_text()

AWKWARD = "a/b@c:d#e?f%g&h+i=j k\\l'm\"n"


@pytest.mark.parametrize("password", [AWKWARD, "Zm9v/YmFy+YmF6==", "plain"])
def test_password_with_url_characters_survives(password):
    s = Settings(
        _env_file=None, database_url="postgresql+psycopg://nis2@db:5432/nis2", database_password=password
    )
    url = make_url(s.database_url)
    assert url.password == password
    assert (url.username, url.host, url.port, url.database) == ("nis2", "db", 5432, "nis2")
    assert url.drivername == "postgresql+psycopg"


def test_url_without_separate_password_is_unchanged():
    raw = "postgresql+psycopg://nis2:secret@db:5432/nis2"
    assert Settings(_env_file=None, database_url=raw).database_url == raw


def test_compose_passes_the_password_separately():
    assert re.search(r"NIS2_DATABASE_URL: postgresql\+psycopg://nis2@db:5432/nis2\s*$", COMPOSE, re.MULTILINE)
    assert re.search(r"NIS2_DATABASE_PASSWORD: \$\{POSTGRES_PASSWORD", COMPOSE)
    assert "${POSTGRES_PASSWORD}@" not in COMPOSE

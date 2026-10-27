"""Test setup: a dedicated database (nis2_test) that is rebuilt and seeded (incl. demo data) once per session."""

import os

os.environ["NIS2_DATABASE_URL"] = os.environ.get(
    "NIS2_TEST_DATABASE_URL", "postgresql+psycopg://nis2@127.0.0.1:55432/nis2_test"
)
os.environ["NIS2_ENV"] = "test"
os.environ["NIS2_BOOTSTRAP_ADMIN_PASSWORD"] = "Admin-Password-2026!"
os.environ["NIS2_BOOTSTRAP_ADMIN_EMAIL"] = "admin@example.local"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, engine  # noqa: E402

PW = "Demo-Password-2026!"


@pytest.fixture(scope="session", autouse=True)
def _serialize_test_runs():
    """Parallel pytest runs would rebuild the same test database; queue them with a file lock."""
    import fcntl
    import tempfile
    from pathlib import Path

    lock = open(Path(tempfile.gettempdir()) / "nis2-pytest.lock", "w")  # noqa: SIM115
    fcntl.flock(lock, fcntl.LOCK_EX)
    yield
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()


@pytest.fixture(scope="session", autouse=True)
def database(_serialize_test_runs):
    import app.models  # noqa: F401

    # extensions are created by scripts/dev-db.sh (superuser); here we only rebuild the tables
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS documents, document_versions CASCADE"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.seed.seed import run

    run(demo=True)
    yield


@pytest.fixture(scope="session")
def app_():
    from app.main import app

    return app


class Client:
    def __init__(self, app, email: str, password: str = PW):
        self.c = TestClient(app)
        r = self.c.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        self.me = r.json()
        self.csrf = self.c.cookies.get("nis2_csrf")

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def _h(self, kw):
        kw.setdefault("headers", {})["X-CSRF-Token"] = self.csrf
        return kw

    def post(self, url, **kw):
        return self.c.post(url, **self._h(kw))

    def patch(self, url, **kw):
        return self.c.patch(url, **self._h(kw))

    def put(self, url, **kw):
        return self.c.put(url, **self._h(kw))

    def delete(self, url, **kw):
        return self.c.delete(url, **self._h(kw))


@pytest.fixture(scope="session")
def login(app_):
    cache = {}

    def _login(email: str, password: str = PW) -> Client:
        if email not in cache:
            cache[email] = Client(app_, email, password)
        return cache[email]

    return _login

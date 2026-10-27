import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware

from app.api import (
    admin,
    ai,
    assessments,
    auth,
    catalog,
    dashboard,
    documents,
    entities,
    findings,
    incidents,
    me,
    projects,
    regulations,
    setup,
    users,
    work,
)
from app.config import get_settings
from app.db import SessionLocal
from app.services.setup import setup_needed_now

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("nis2")
settings = get_settings()

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; "
    "frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


async def _singleton_loop(lock_id: int, coro_factory):
    """Run a periodic job in exactly one process (Postgres advisory lock), retrying leadership every minute."""
    while True:
        db = SessionLocal()
        try:
            got = db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": lock_id}).scalar()
            if got:
                try:
                    await coro_factory()
                finally:
                    db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": lock_id})
        except Exception as e:  # noqa: BLE001
            log.warning("background job %s: %s", lock_id, e)
        finally:
            db.close()
        await asyncio.sleep(60)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = []
    if settings.env != "test":
        from app.features.controls.jobs import daily_loop
        from app.services.ai import embedding_loop
        from app.services.notify import reminder_loop

        tasks = [
            asyncio.create_task(_singleton_loop(7301, reminder_loop)),
            asyncio.create_task(_singleton_loop(7302, embedding_loop)),
            asyncio.create_task(_singleton_loop(7303, daily_loop)),
        ]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(
    title=f"{settings.app_name} API",
    version="1.0.1",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    SessionMiddleware,  # only used to carry OIDC state/nonce/PKCE verifier during the login redirect
    secret_key=settings.secret_key,
    session_cookie="nis2_oidc",
    max_age=600,
    same_site="lax",
    https_only=settings.secure_cookies,
)


@app.middleware("http")
async def reject_nul_bytes(request: Request, call_next):
    """PostgreSQL text cannot contain NUL; reject such input early with 400 instead of failing deep inside."""
    if "%00" in request.url.query:
        return JSONResponse(status_code=400, content={"detail": "Invalid character in request"})
    if request.method in ("POST", "PUT", "PATCH") and request.headers.get("content-type", "").startswith(
        "application/json"
    ):
        body = await request.body()
        if b"\\u0000" in body or b"\x00" in body:
            return JSONResponse(status_code=400, content={"detail": "Invalid character in request"})
    return await call_next(request)


@app.middleware("http")
async def require_setup(request: Request, call_next):
    """Until the first-run setup created a user, only the setup endpoints and the health check answer."""
    path = request.scope["path"]  # what the router matches; request.url is built from the Host header
    if (
        path.startswith("/api/")
        and path != "/api/health"
        and path != "/api/setup"
        and not path.startswith("/api/setup/")
        and await run_in_threadpool(setup_needed_now)
    ):
        return JSONResponse(status_code=503, content={"detail": "setup required"})
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    h.setdefault("Content-Security-Policy", CSP)
    if settings.is_production:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "Invalid input", "errors": errors})


@app.exception_handler(IntegrityError)
async def integrity_handler(request: Request, exc: IntegrityError):
    log.info("integrity error on %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse(
        status_code=409,
        content={
            "detail": "The change conflicts with existing data or references an item that does not exist"
        },
    )


@app.exception_handler(DataError)
async def data_error_handler(request: Request, exc: DataError):
    log.info("data error on %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse(
        status_code=400, content={"detail": "A value is out of range or has an invalid format"}
    )


@app.exception_handler(OverflowError)
async def overflow_handler(request: Request, exc: OverflowError):
    return JSONResponse(status_code=400, content={"detail": "A date or number is out of the supported range"})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


for r in (
    auth,
    users,
    entities,
    catalog,
    assessments,
    findings,
    dashboard,
    projects,
    work,
    me,
    documents,
    regulations,
    incidents,
    ai,
    admin,
    setup,
):
    app.include_router(r.router, prefix="/api")


def _include_feature_routers() -> None:
    """Feature modules live in app/features/<name>/ with models.py, api.py (router) and optional hooks."""
    import importlib
    import pkgutil

    import app.features as features

    for mod in sorted(pkgutil.iter_modules(features.__path__), key=lambda m: m.name):
        pkg = f"app.features.{mod.name}"
        try:
            api_mod = importlib.import_module(f"{pkg}.api")
        except ModuleNotFoundError as e:
            if e.name != f"{pkg}.api":
                raise
            continue
        app.include_router(api_mod.router, prefix="/api")


_include_feature_routers()


@app.get("/api/health", include_in_schema=False)
def health():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    finally:
        db.close()


# --- single-page app (production build) -----------------------------------------------------------------

if settings.frontend_dist and Path(settings.frontend_dist).is_dir():
    dist = Path(settings.frontend_dist).resolve()
    index_html = dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist):
            headers = (
                {"Cache-Control": "public, max-age=31536000, immutable"}
                if "/assets/" in f"/{full_path}"
                else {}
            )
            return FileResponse(candidate, headers=headers)
        return FileResponse(index_html, headers={"Cache-Control": "no-cache"})

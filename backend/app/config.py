from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be set via environment variable (prefix NIS2_)."""

    model_config = SettingsConfigDict(env_prefix="NIS2_", env_file=".env", extra="ignore")

    env: str = "development"  # development | production | test
    app_name: str = "NIS2 Compass"
    base_url: str = "http://localhost:5173"  # public URL, used for OIDC redirects and links
    secret_key: str = Field(default="dev-insecure-secret-change-me-please-0123456789")

    database_url: str = "postgresql+psycopg://nis2@127.0.0.1:55432/nis2"
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    frontend_dist: Path | None = None  # serve the built SPA from here if set

    # Sessions
    session_cookie: str = "nis2_session"
    csrf_cookie: str = "nis2_csrf"
    session_idle_minutes: int = 8 * 60
    session_absolute_hours: int = 7 * 24
    cookie_secure: bool | None = None  # defaults to True in production

    # Local auth
    local_auth_enabled: bool = True
    password_min_length: int = 12
    login_max_attempts: int = 8
    login_lockout_minutes: int = 15
    bootstrap_admin_email: str = "admin@example.local"
    bootstrap_admin_password: str | None = None  # if unset, no admin is created; first-run setup does it

    # OIDC
    oidc_enabled: bool = False
    oidc_display_name: str = "Single Sign-On"
    oidc_issuer: str | None = None  # e.g. https://login.microsoftonline.com/<tenant>/v2.0
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_scopes: str = "openid email profile"
    oidc_groups_claim: str = "groups"
    # JSON mapping of IdP group -> role key, e.g. {"nis2-admins":"admin","nis2-isb":"security_officer"}
    oidc_role_mapping: dict[str, str] = Field(default_factory=dict)
    oidc_default_role: str | None = "viewer"
    oidc_auto_provision: bool = True
    # Treat the IdP's e-mail claim as verified even without email_verified=true (e.g. Entra ID, which omits the
    # claim). Only enable when the IdP guarantees e-mail ownership; used to link pre-provisioned local accounts.
    oidc_trust_email: bool = False

    # Uploads
    max_upload_mb: int = 50
    allowed_extensions: list[str] = Field(
        default_factory=lambda: [
            "pdf",
            "docx",
            "doc",
            "xlsx",
            "xls",
            "pptx",
            "ppt",
            "txt",
            "md",
            "csv",
            "json",
            "xml",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "odt",
            "ods",
            "odp",
            "rtf",
            "msg",
            "eml",
            "zip",
            "vsdx",
            "html",
        ]
    )

    # AI defaults (can be overridden in the admin UI; UI values win)
    ai_base_url: str | None = None
    ai_api_key: str | None = None
    ai_chat_model: str | None = None
    ai_embedding_model: str | None = None

    # SMTP (optional, for notification e-mails)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_starttls: bool = True

    @field_validator("oidc_role_mapping", mode="before")
    @classmethod
    def _parse_mapping(cls, v):
        if isinstance(v, str):
            import json

            return json.loads(v) if v.strip() else {}
        return v

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.is_production

    @property
    def session_cookie_name(self) -> str:
        return f"__Host-{self.session_cookie}" if self.secure_cookies else self.session_cookie

    @property
    def csrf_cookie_name(self) -> str:
        return f"__Host-{self.csrf_cookie}" if self.secure_cookies else self.csrf_cookie

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production and (s.secret_key.startswith("dev-insecure") or len(s.secret_key) < 32):
        raise RuntimeError(
            "NIS2_SECRET_KEY must be set to a random value of at least 32 characters in production"
        )
    s.upload_dir.mkdir(parents=True, exist_ok=True)
    return s

"""The deploy kit: deploy/docker-compose.yml plus a .env is all a server needs."""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "deploy" / "docker-compose.yml").read_text()


def _version() -> str:
    return tomllib.loads((ROOT / "backend" / "pyproject.toml").read_text())["project"]["version"]


def test_compose_defaults_to_the_published_image_of_this_version():
    match = re.search(r"^\s+image: \$\{APP_IMAGE:-([^}]+)\}$", COMPOSE, re.MULTILINE)
    assert match, "app service must use ${APP_IMAGE:-<image>}"
    assert match.group(1) == f"ghcr.io/techmhe/nis2-compass:{_version()}"


def test_compose_needs_no_source_checkout():
    assert not re.search(r"^\s+build:", COMPOSE, re.MULTILINE)
    assert "./Caddyfile" not in COMPOSE
    assert not (ROOT / "deploy" / "Caddyfile").exists()


def test_caddyfile_placeholders_are_left_to_caddy():
    # Inline config content is interpolated by Compose; Caddy's own {$VAR} placeholders must be escaped as
    # {$$VAR}, or Compose would substitute (and the EAB secrets from caddy.env would never reach Caddy).
    content = COMPOSE.split("\nconfigs:\n", 1)[1]
    assert "{$$DOMAIN}" in content
    assert "{$$ACME_EAB_HMAC}" in content
    assert "$" not in content.replace("$$", "")

"""File storage for uploaded documents. Files are stored under random names outside any web root."""

import hashlib
import mimetypes
import re
import secrets
from pathlib import Path

from app.config import get_settings

# content signatures for types we explicitly allow; used to reject spoofed extensions
_MAGIC = {
    "pdf": [b"%PDF"],
    "png": [b"\x89PNG"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "gif": [b"GIF8"],
    "webp": [b"RIFF"],
    "zip": [b"PK\x03\x04", b"PK\x05\x06"],
    "docx": [b"PK\x03\x04"],
    "xlsx": [b"PK\x03\x04"],
    "pptx": [b"PK\x03\x04"],
    "vsdx": [b"PK\x03\x04"],
    "odt": [b"PK\x03\x04"],
    "ods": [b"PK\x03\x04"],
    "odp": [b"PK\x03\x04"],
    "doc": [b"\xd0\xcf\x11\xe0"],
    "xls": [b"\xd0\xcf\x11\xe0"],
    "ppt": [b"\xd0\xcf\x11\xe0"],
    "msg": [b"\xd0\xcf\x11\xe0"],
}
_TEXT_TYPES = {"txt", "md", "csv", "json", "xml", "html", "eml", "rtf"}


class UploadRejected(ValueError):
    pass


def safe_filename(name: str) -> str:
    name = Path(name or "file").name
    name = re.sub(r"[^\w.\- ()äöüÄÖÜß]", "_", name).strip(" .") or "file"
    return name[:200]


def check_upload(filename: str, data: bytes) -> str:
    """Validate extension, size and content signature. Returns the normalised extension."""
    s = get_settings()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in s.allowed_extensions:
        raise UploadRejected(f"File type .{ext or '?'} is not allowed")
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise UploadRejected(f"File exceeds {s.max_upload_mb} MB")
    if not data:
        raise UploadRejected("File is empty")
    sigs = _MAGIC.get(ext)
    if sigs and not any(data.startswith(sig) for sig in sigs):
        raise UploadRejected("File content does not match its extension")
    if ext in _TEXT_TYPES and b"\x00" in data[:4096]:
        raise UploadRejected("Binary content in a text file type")
    return ext


def guess_mime(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def store(data: bytes) -> tuple[str, str]:
    """Persist bytes; returns (storage_key, sha256)."""
    key = secrets.token_hex(20)
    path = path_for(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key, hashlib.sha256(data).hexdigest()


def path_for(key: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{40}", key):
        raise ValueError("invalid storage key")
    return get_settings().upload_dir / key[:2] / key


def read(key: str) -> bytes:
    return path_for(key).read_bytes()


def delete(key: str) -> None:
    path_for(key).unlink(missing_ok=True)

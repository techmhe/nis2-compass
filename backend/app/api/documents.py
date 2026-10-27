import json
from datetime import date, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import (
    TARGETS,
    can_access_target,
    can_see_document,
    check_target,
    cleanup_target,
    get_or_404,
)
from app.config import get_settings
from app.core.deps import Principal, get_principal, require, require_global
from app.db import get_db
from app.models import (
    Document,
    DocumentAcknowledgement,
    DocumentLink,
    DocumentVersion,
    Folder,
    User,
)
from app.models.documents import CLASSIFICATIONS, DOC_STATUS, DOC_TYPES
from app.schemas.common import ORM, EntityBrief, Ok, UserBrief
from app.services import storage
from app.services.audit import apply_changes, audit
from app.services.extract import extract_text
from app.services.indexing import index_object, remove_object
from app.services.search import search

router = APIRouter(prefix="/documents", tags=["documents"])
INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}


class VersionOut(ORM):
    id: int
    version_no: int
    filename: str
    mime_type: str
    size: int
    sha256: str
    extraction_status: str
    page_count: int | None
    change_note: str | None
    uploaded_by: UserBrief | None
    uploaded_at: datetime


class DocumentOut(BaseModel):
    id: int
    title: str
    description: str | None
    doc_type: str
    status: str
    classification: str
    entity: EntityBrief | None
    folder_id: int | None
    owner: UserBrief | None
    tags: list[str]
    version_label: str | None
    approved_at: date | None
    approved_by: str | None
    next_review_date: date | None
    external_url: str | None
    current_version: VersionOut | None
    created_at: datetime
    updated_at: datetime
    review_overdue: bool
    link_count: int = 0
    snippet: str | None = None


def doc_out(
    d: Document, link_counts: dict[int, int] | None = None, snippet: str | None = None
) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        title=d.title,
        description=d.description,
        doc_type=d.doc_type,
        status=d.status,
        classification=d.classification,
        entity=EntityBrief.model_validate(d.entity) if d.entity else None,
        folder_id=d.folder_id,
        owner=UserBrief.model_validate(d.owner) if d.owner else None,
        tags=d.tags or [],
        version_label=d.version_label,
        approved_at=d.approved_at,
        approved_by=d.approved_by,
        next_review_date=d.next_review_date,
        external_url=d.external_url,
        current_version=VersionOut.model_validate(d.current_version) if d.current_version else None,
        created_at=d.created_at,
        updated_at=d.updated_at,
        review_overdue=bool(
            d.next_review_date and d.next_review_date < date.today() and d.status != "Retired"
        ),
        link_count=(link_counts or {}).get(d.id, 0),
        snippet=snippet,
    )


@router.get("/meta")
def meta(pr: Principal = Depends(require("documents.read"))):
    s = get_settings()
    return {
        "types": DOC_TYPES,
        "statuses": DOC_STATUS,
        "classifications": CLASSIFICATIONS,
        "max_upload_mb": s.max_upload_mb,
        "allowed_extensions": s.allowed_extensions,
    }


@router.get("", response_model=list[DocumentOut])
def list_documents(
    q: str | None = Query(default=None, max_length=300),
    doc_type: str | None = None,
    status: str | None = None,
    entity_id: int | None = None,
    folder_id: int | None = None,
    tag: str | None = None,
    pr: Principal = Depends(require("documents.read")),
    db: Session = Depends(get_db),
):
    snippets: dict[int, str] = {}
    stmt = select(Document).order_by(Document.title)
    if q and q.strip():
        hits = search(db, pr, q, types=["document"], limit=200)
        order = [h.source_id for h in hits]
        snippets = {h.source_id: h.snippet for h in hits}
        if not order:
            return []
        stmt = select(Document).where(Document.id.in_(order))
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if status:
        stmt = stmt.where(Document.status == status)
    if entity_id:
        stmt = stmt.where(Document.entity_id == entity_id)
    if folder_id:
        stmt = stmt.where(Document.folder_id == folder_id)
    docs = [d for d in db.scalars(stmt) if can_see_document(pr, d)]
    if tag:
        docs = [d for d in docs if tag in (d.tags or [])]
    if q and q.strip():
        pos = {i: n for n, i in enumerate(order)}
        docs.sort(key=lambda d: pos.get(d.id, 9999))
    counts = dict(
        db.execute(select(DocumentLink.document_id, func.count()).group_by(DocumentLink.document_id)).all()
    )
    return [doc_out(d, counts, snippets.get(d.id)) for d in docs]


@router.get("/tags")
def all_tags(pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)):
    tags: dict[str, int] = {}
    for d in db.scalars(select(Document)):
        if not can_see_document(pr, d):
            continue
        for x in d.tags or []:
            tags[x] = tags.get(x, 0) + 1
    return sorted(({"tag": k, "count": v} for k, v in tags.items()), key=lambda x: -x["count"])


def _read_upload(file: UploadFile) -> bytes:
    limit = get_settings().max_upload_mb * 1024 * 1024
    chunks, size = [], 0
    while True:
        chunk = file.file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"File exceeds {get_settings().max_upload_mb} MB")
        chunks.append(chunk)
    return b"".join(chunks)


def _store_version(
    db: Session, pr: Principal, doc: Document, filename: str, data: bytes, note: str | None
) -> DocumentVersion:
    fname = storage.safe_filename(filename)
    try:
        storage.check_upload(fname, data)
    except storage.UploadRejected as e:
        raise HTTPException(400, str(e)) from e
    key, sha = storage.store(data)
    text, pages, status = extract_text(fname, data)
    n = (
        db.scalar(select(func.max(DocumentVersion.version_no)).where(DocumentVersion.document_id == doc.id))
        or 0
    ) + 1
    v = DocumentVersion(
        document_id=doc.id,
        version_no=n,
        filename=fname,
        storage_key=key,
        mime_type=storage.guess_mime(fname),
        size=len(data),
        sha256=sha,
        extracted_text=text,
        extraction_status=status,
        page_count=pages,
        change_note=note,
        uploaded_by_id=pr.id,
    )
    db.add(v)
    db.flush()
    doc.current_version_id = v.id
    return v


@router.post("", response_model=DocumentOut)
def upload_document(
    file: UploadFile | None = File(default=None),
    metadata: str = Form(...),
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Create a document. `metadata` is a JSON object with title, doc_type, status, classification, entity_id,
    tags, description, next_review_date, version_label, owner_id, external_url and optional `link`
    ({target_type, target_id}) to link the new document immediately (e.g. as evidence for an answer)."""
    try:
        raw = json.loads(metadata)
        if not isinstance(raw, dict):
            raise ValueError("metadata must be a JSON object")
        m = DocumentMeta(**raw)
    except (ValueError, TypeError) as e:
        msg = (
            "; ".join(err["msg"] for err in e.errors())
            if hasattr(e, "errors")
            else "metadata must be a JSON object"
        )
        raise HTTPException(400, f"Invalid metadata: {msg}") from None
    pr.ensure("documents.upload", m.entity_id, write=True)
    _check_approval_fields(pr, m, None)
    _check_owner(db, m)
    if file is None and not m.external_url:
        raise HTTPException(400, "Upload a file or provide an external URL")
    link = m.link
    if link:
        try:
            link = {"target_type": str(link["target_type"]), "target_id": int(link["target_id"])}
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Invalid link") from None
        check_target(db, pr, link["target_type"], link["target_id"], write=True)
    data = _read_upload(file) if file else None
    d = Document(**m.model_dump(exclude={"link"}), created_by_id=pr.id)
    if not d.title and file:
        d.title = storage.safe_filename(file.filename or "Document").rsplit(".", 1)[0]
    if not d.owner_id:
        d.owner_id = pr.id
    db.add(d)
    db.flush()
    if file and data is not None:
        _store_version(db, pr, d, file.filename or "file", data, "Initial version")
    if link:
        db.add(
            DocumentLink(
                document_id=d.id,
                target_type=link["target_type"],
                target_id=int(link["target_id"]),
                created_by_id=pr.id,
            )
        )
    audit(db, pr, "create", "document", d.id, d.title, entity_id=d.entity_id)
    db.commit()
    index_object(db, "document", d.id)
    db.refresh(d)
    return doc_out(d)


class DocumentMeta(BaseModel):
    title: str = Field(default="", max_length=400)
    description: str | None = Field(default=None, max_length=10000)
    doc_type: str = "Other"
    status: str = "Draft"
    classification: str = "Internal"
    entity_id: int | None = None
    folder_id: int | None = None
    owner_id: int | None = None
    tags: list[str] = []
    version_label: str | None = Field(default=None, max_length=40)
    approved_at: date | None = None
    approved_by: str | None = Field(default=None, max_length=200)
    next_review_date: date | None = None
    external_url: str | None = Field(default=None, max_length=1000, pattern=r"^https?://")
    link: dict | None = None

    def model_post_init(self, _ctx) -> None:
        if self.doc_type not in DOC_TYPES:
            raise ValueError("invalid doc_type")
        if self.status not in DOC_STATUS:
            raise ValueError("invalid status")
        if self.classification not in CLASSIFICATIONS:
            raise ValueError("invalid classification")
        self.tags = sorted({t.strip()[:40] for t in self.tags if t and t.strip()})[:30]


def _check_owner(db: Session, m: "DocumentMeta") -> None:
    if m.owner_id is not None:
        u = db.get(User, m.owner_id)
        if not u or not u.is_active:
            raise HTTPException(422, "The owner must be an active user")


def _check_approval_fields(pr: Principal, m: "DocumentMeta", d: Document | None) -> None:
    """Only document managers may mark documents approved or record approvals. Setting a document to Approved
    records the approval date and approver automatically unless given (e.g. "Management board")."""
    approving = m.status == "Approved" and (d is None or d.status != "Approved")
    changing = approving or (
        (m.approved_at or m.approved_by)
        and (d is None or (m.approved_at, m.approved_by) != (d.approved_at, d.approved_by))
    )
    if changing and not pr.can_write("documents.manage", m.entity_id):
        raise HTTPException(403, "Only document managers can approve documents")
    if approving:
        m.approved_at = m.approved_at or date.today()
        m.approved_by = m.approved_by or pr.user.display_name[:200]


def _get_doc(db: Session, pr: Principal, doc_id: int) -> Document:
    d = get_or_404(db, Document, doc_id)
    if not can_see_document(pr, d):
        raise HTTPException(404, "Document not found")
    return d


def _can_edit_doc(pr: Principal, d: Document) -> bool:
    return pr.can_write("documents.manage", d.entity_id) or (
        (d.owner_id == pr.id or d.created_by_id == pr.id) and pr.can_read("documents.upload", d.entity_id)
    )


@router.get("/{doc_id}")
def get_document(
    doc_id: int, pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)
):
    d = _get_doc(db, pr, doc_id)
    versions = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == d.id)
        .order_by(DocumentVersion.version_no.desc())
    ).all()
    links = []
    for link in db.scalars(select(DocumentLink).where(DocumentLink.document_id == d.id)):
        model = TARGETS.get(link.target_type, (None,))[0]
        obj = db.get(model, link.target_id) if model else None
        if obj is not None and not can_access_target(db, pr, link.target_type, link.target_id):
            links.append(
                {
                    "id": link.id,
                    "target_type": link.target_type,
                    "target_id": None,
                    "label": "(no access)",
                    "url": None,
                    "note": None,
                }
            )
            continue
        label, url = _link_label(link.target_type, obj)
        links.append(
            {
                "id": link.id,
                "target_type": link.target_type,
                "target_id": link.target_id,
                "label": label,
                "url": url,
                "note": link.note,
            }
        )
    acks = db.execute(
        select(DocumentAcknowledgement, User)
        .join(User, User.id == DocumentAcknowledgement.user_id)
        .where(DocumentAcknowledgement.document_id == d.id)
    ).all()
    return {
        "document": doc_out(d),
        "versions": [VersionOut.model_validate(v) for v in versions],
        "links": links,
        "acknowledgements": [
            {
                "user": u.display_name,
                "user_id": u.id,
                "version_id": a.version_id,
                "acknowledged_at": a.acknowledged_at,
            }
            for a, u in acks
        ],
        "acknowledged_by_me": any(u.id == pr.id and a.version_id == d.current_version_id for a, u in acks),
        "can_edit": _can_edit_doc(pr, d),
    }


# Feature modules register label functions for their link targets: fn(obj) -> (label, url | None)
LINK_LABELERS: dict = {}


def register_link_label(target_type: str, fn) -> None:
    LINK_LABELERS[target_type] = fn


def _link_label(target_type: str, obj) -> tuple[str, str | None]:
    if obj is None:
        return "(deleted)", None
    if target_type in LINK_LABELERS:
        return LINK_LABELERS[target_type](obj)
    if target_type == "requirement":
        return f"Requirement {obj.number} {obj.section}", f"/catalog/{obj.id}"
    if target_type == "answer":
        return (
            f"{obj.assessment.entity.code} – {obj.requirement.number} {obj.requirement.section}",
            f"/assessments/{obj.assessment_id}?req={obj.requirement_id}",
        )
    if target_type == "action_item":
        return f"{obj.code} {obj.title[:80]}", f"/action-plan?item={obj.id}"
    if target_type == "work_package":
        return f"{obj.code} {obj.title[:80]}", f"/work-packages/{obj.id}"
    if target_type == "task":
        return f"{obj.key} {obj.title[:80]}", f"/tasks?task={obj.id}"
    if target_type == "provision":
        return f"{obj.regulation.short_title} {obj.ref}", f"/regulations/{obj.regulation_id}?p={obj.id}"
    if target_type == "incident":
        return f"{obj.code} {obj.title[:80]}", f"/incidents/{obj.id}"
    if target_type == "risk":
        return f"{obj.code} {obj.title[:80]}", f"/risks/{obj.id}"
    if target_type in ("activity", "gate", "raid"):
        return (
            f"{getattr(obj, 'code', '')} {getattr(obj, 'title', '') or getattr(obj, 'decision', '') or ''}"[
                :100
            ],
            None,
        )
    return target_type, None


@router.put("/{doc_id}", response_model=DocumentOut)
def update_document(
    doc_id: int,
    body: DocumentMeta,
    pr: Principal = Depends(require("documents.read")),
    db: Session = Depends(get_db),
):
    d = _get_doc(db, pr, doc_id)
    if not _can_edit_doc(pr, d):
        raise HTTPException(403, "No permission to edit this document")
    if body.entity_id != d.entity_id:
        pr.ensure("documents.upload", body.entity_id, write=True)
    _check_approval_fields(pr, body, d)
    _check_owner(db, body)
    data = body.model_dump(exclude={"link"})
    if not data["title"]:
        data["title"] = d.title
    if not data["owner_id"]:
        data["owner_id"] = d.owner_id
    diff = apply_changes(d, data)
    audit(db, pr, "update", "document", d.id, d.title, entity_id=d.entity_id, details=diff)
    db.commit()
    index_object(db, "document", d.id)
    return doc_out(d)


@router.post("/{doc_id}/versions", response_model=DocumentOut)
def upload_version(
    doc_id: int,
    file: UploadFile = File(...),
    change_note: str | None = Form(default=None),
    version_label: str | None = Form(default=None),
    pr: Principal = Depends(require("documents.upload")),
    db: Session = Depends(get_db),
):
    d = _get_doc(db, pr, doc_id)
    if not (_can_edit_doc(pr, d) or pr.can_write("documents.upload", d.entity_id)):
        raise HTTPException(403, "No permission to upload a new version of this document")
    data = _read_upload(file)
    v = _store_version(db, pr, d, file.filename or "file", data, (change_note or "")[:2000] or None)
    if d.status == "Approved":
        d.status = "In Review"  # a new version needs a new approval
    if version_label:
        d.version_label = version_label[:40]
    audit(
        db,
        pr,
        "new_version",
        "document",
        d.id,
        d.title,
        entity_id=d.entity_id,
        details={"version": v.version_no},
    )
    db.commit()
    index_object(db, "document", d.id)
    db.refresh(d)  # current_version relationship is stale after switching current_version_id
    return doc_out(d)


@router.get("/{doc_id}/versions/{version_id}/download")
def download(
    doc_id: int,
    version_id: int,
    inline: bool = False,
    pr: Principal = Depends(require("documents.read")),
    db: Session = Depends(get_db),
):
    d = _get_doc(db, pr, doc_id)
    v = get_or_404(db, DocumentVersion, version_id)
    if v.document_id != d.id:
        raise HTTPException(404, "Version not found")
    try:
        data = storage.read(v.storage_key)
    except FileNotFoundError as e:
        raise HTTPException(410, "File is missing from storage") from e
    disp = "inline" if inline and v.mime_type in INLINE_TYPES else "attachment"
    mime = v.mime_type if disp == "inline" else "application/octet-stream"
    audit(
        db,
        pr,
        "download",
        "document",
        d.id,
        d.title,
        entity_id=d.entity_id,
        details={"version": v.version_no},
    )
    db.commit()
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f"{disp}; filename*=UTF-8''{quote(v.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/{doc_id}/text")
def document_text(
    doc_id: int,
    version_id: int | None = None,
    pr: Principal = Depends(require("documents.read")),
    db: Session = Depends(get_db),
):
    d = _get_doc(db, pr, doc_id)
    v = db.get(DocumentVersion, version_id) if version_id else d.current_version
    if not v or v.document_id != d.id:
        raise HTTPException(404, "Version not found")
    return {"text": v.extracted_text, "status": v.extraction_status, "filename": v.filename}


@router.delete("/{doc_id}", response_model=Ok)
def delete_document(
    doc_id: int, pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)
):
    d = _get_doc(db, pr, doc_id)
    if not pr.can_write("documents.manage", d.entity_id) and not (
        d.created_by_id == pr.id and d.status == "Draft"
    ):
        raise HTTPException(403, "No permission to delete this document")
    keys = [
        v.storage_key for v in db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == d.id))
    ]
    audit(db, pr, "delete", "document", d.id, d.title, entity_id=d.entity_id)
    cleanup_target(db, "document", d.id)
    d.current_version_id = None
    db.flush()
    db.delete(d)
    db.commit()
    for k in keys:
        storage.delete(k)
    remove_object(db, "document", doc_id)
    return Ok()


class LinkIn(BaseModel):
    target_type: str
    target_id: int
    note: str | None = Field(default=None, max_length=400)


@router.post("/{doc_id}/links", response_model=Ok)
def add_link(
    doc_id: int,
    body: LinkIn,
    pr: Principal = Depends(require("documents.read")),
    db: Session = Depends(get_db),
):
    d = _get_doc(db, pr, doc_id)
    check_target(db, pr, body.target_type, body.target_id, write=True)
    if db.scalar(
        select(DocumentLink).where(
            DocumentLink.document_id == d.id,
            DocumentLink.target_type == body.target_type,
            DocumentLink.target_id == body.target_id,
        )
    ):
        return Ok()
    db.add(
        DocumentLink(
            document_id=d.id,
            target_type=body.target_type,
            target_id=body.target_id,
            note=body.note,
            created_by_id=pr.id,
        )
    )
    audit(
        db,
        pr,
        "link",
        "document",
        d.id,
        f"{d.title} -> {body.target_type} {body.target_id}",
        entity_id=d.entity_id,
    )
    db.commit()
    return Ok()


@router.delete("/links/{link_id}", response_model=Ok)
def remove_link(
    link_id: int, pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)
):
    link = get_or_404(db, DocumentLink, link_id)
    _get_doc(db, pr, link.document_id)
    check_target(db, pr, link.target_type, link.target_id, write=True)
    audit(db, pr, "unlink", "document", link.document_id, f"{link.target_type} {link.target_id}")
    db.delete(link)
    db.commit()
    return Ok()


@router.post("/{doc_id}/acknowledge", response_model=Ok)
def acknowledge(
    doc_id: int, pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)
):
    d = _get_doc(db, pr, doc_id)
    exists = db.scalar(
        select(DocumentAcknowledgement).where(
            DocumentAcknowledgement.document_id == d.id,
            DocumentAcknowledgement.user_id == pr.id,
            DocumentAcknowledgement.version_id == d.current_version_id,
        )
    )
    if not exists:
        db.add(DocumentAcknowledgement(document_id=d.id, version_id=d.current_version_id, user_id=pr.id))
        audit(db, pr, "acknowledge", "document", d.id, d.title, entity_id=d.entity_id)
        db.commit()
    return Ok()


# --- folders --------------------------------------------------------------------------------------------


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None
    sort_order: int = 0


@router.get("/folders/all")
def list_folders(pr: Principal = Depends(require("documents.read")), db: Session = Depends(get_db)):
    return [
        {"id": f.id, "name": f.name, "parent_id": f.parent_id, "sort_order": f.sort_order}
        for f in db.scalars(select(Folder).order_by(Folder.sort_order, Folder.name))
    ]


@router.post("/folders")
def create_folder(
    body: FolderIn, pr: Principal = Depends(require_global("documents.manage")), db: Session = Depends(get_db)
):
    f = Folder(**body.model_dump())
    db.add(f)
    db.commit()
    return {"id": f.id}


@router.delete("/folders/{folder_id}", response_model=Ok)
def delete_folder(
    folder_id: int, pr: Principal = Depends(require_global("documents.manage")), db: Session = Depends(get_db)
):
    f = get_or_404(db, Folder, folder_id)
    db.delete(f)
    db.commit()
    return Ok()

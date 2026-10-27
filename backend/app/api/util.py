from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.models import (
    ActionItem,
    Activity,
    Answer,
    Document,
    DocumentLink,
    Gate,
    Incident,
    Provision,
    RaidRecord,
    Requirement,
    Task,
    WorkPackage,
)


def get_or_404[T](db: Session, model: type[T], obj_id: int, what: str | None = None) -> T:
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what or model.__name__} not found")
    return obj


def next_code(db: Session, column, prefix: str, width: int = 3) -> str:
    """Next sequential code like AP-007 / WP-012 / T-45 based on the highest existing number."""
    codes = db.scalars(select(column).where(column.like(f"{prefix}%"))).all()
    nums = [int(c[len(prefix) :]) for c in codes if c[len(prefix) :].isdigit()]
    n = (max(nums) if nums else 0) + 1
    return f"{prefix}{n:0{width}d}" if width else f"{prefix}{n}"


# Generic target types for comments and document links: type -> (model, read perm, write perm)
def user_names(db: Session, ids) -> dict[int, str]:
    """Display names for a set of user ids (None and unknown ids are skipped)."""
    from app.models import User

    ids = {i for i in ids if i}
    return {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def entity_ref(e) -> dict | None:
    """Short entity reference used in API responses."""
    return {"id": e.id, "code": e.code, "name": e.name, "country": e.country} if e else None


TARGETS: dict[str, tuple[type, str, str]] = {
    "requirement": (Requirement, "catalog.read", "assessments.edit"),
    "answer": (Answer, "assessments.read", "assessments.edit"),
    "action_item": (ActionItem, "findings.read", "findings.manage"),
    "work_package": (WorkPackage, "workpackages.read", "workpackages.manage"),
    "task": (Task, "tasks.read", "tasks.manage"),
    "activity": (Activity, "projects.read", "projects.manage"),
    "gate": (Gate, "projects.read", "projects.manage"),
    "raid": (RaidRecord, "projects.read", "projects.manage"),
    "incident": (Incident, "incidents.read", "incidents.manage"),
    "provision": (Provision, "regulations.read", "regulations.manage"),
    "document": (Document, "documents.read", "documents.upload"),
}


def register_target(target_type: str, model, read_perm: str, write_perm: str) -> None:
    """Allow comments and document links on objects of a feature module."""
    TARGETS[target_type] = (model, read_perm, write_perm)


def target_entity_id(obj) -> int | None:
    if isinstance(obj, Answer):
        return obj.assessment.entity_id
    return getattr(obj, "entity_id", None)


def _entity_ids(obj) -> list[int] | None:
    """Objects shared by several entities (e.g. suppliers, training records) expose `entity_ids`."""
    ids = getattr(obj, "entity_ids", None)
    if ids is None or getattr(obj, "entity_id", None) is not None:
        return None
    return [int(i) for i in ids]


def _can(pr: Principal, perm: str, obj, write: bool) -> bool:
    ids = _entity_ids(obj)
    if ids:  # shared by several entities: read needs one of them, write needs all of them
        if write:
            return all(pr.can_write(perm, e) for e in ids)
        return any(pr.can_read(perm, e) for e in ids)
    ent = target_entity_id(obj)
    return pr.can_write(perm, ent) if write else pr.can_read(perm, ent)


def check_target(db: Session, pr: Principal, target_type: str, target_id: int, write: bool | str = False):
    """Load a comment/link target and check the caller may read it and, if requested, write to it.

    write=True        – modify the object or attach to it (evidence links, approvals): the write permission for
                        the object's entity; group-level objects need a group-wide grant.
    write="contribute" – comment on it: the write permission for the entity, or anywhere for group-level objects.
    """
    if target_type not in TARGETS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown target type")
    model, rperm, wperm = TARGETS[target_type]
    obj = get_or_404(db, model, target_id)
    ent = target_entity_id(obj)
    if target_type == "task":
        own = obj.assignee_id == pr.id or obj.reporter_id == pr.id
        if not (own or pr.can_read(rperm, ent)):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No access")
        if write is True and not (own or pr.can_write(wperm, ent)):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No write access")
        return obj
    if not _can(pr, rperm, obj, write=False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access")
    if target_type == "document" and not can_see_document(pr, obj):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if write == "contribute":
        if not _can(pr, wperm, obj, write=False):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No write access")
    elif write and not _can(pr, wperm, obj, write=True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No write access")
    return obj


def doc_links_for(db: Session, pr: Principal, target_type: str, target_id: int) -> list[dict]:
    rows = db.scalars(
        select(DocumentLink).where(
            DocumentLink.target_type == target_type, DocumentLink.target_id == target_id
        )
    ).all()
    out = []
    for link in rows:
        d = link.document
        if not can_see_document(pr, d):
            continue
        out.append(
            {
                "link_id": link.id,
                "document_id": d.id,
                "title": d.title,
                "doc_type": d.doc_type,
                "status": d.status,
                "version_label": d.version_label,
                "filename": d.current_version.filename if d.current_version else None,
                "note": link.note,
            }
        )
    return out


def can_see_document(pr: Principal, d: Document) -> bool:
    if not pr.can_read("documents.read", d.entity_id):
        return False
    if d.classification == "Restricted":
        return (
            pr.can_write("documents.manage", d.entity_id) or d.owner_id == pr.id or d.created_by_id == pr.id
        )
    return True


def can_access_target(db: Session, pr: Principal, target_type: str, target_id: int) -> bool:
    try:
        check_target(db, pr, target_type, target_id)
        return True
    except HTTPException:
        return False


def cleanup_target(db: Session, target_type: str, target_id: int) -> None:
    """Remove comments and document links that point to a deleted object."""
    from sqlalchemy import delete

    from app.models import Comment

    db.execute(delete(Comment).where(Comment.target_type == target_type, Comment.target_id == target_id))
    db.execute(
        delete(DocumentLink).where(
            DocumentLink.target_type == target_type, DocumentLink.target_id == target_id
        )
    )


def count(db: Session, stmt) -> int:
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

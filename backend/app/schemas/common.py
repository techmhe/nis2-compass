from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserBrief(ORM):
    id: int
    display_name: str
    email: str


class StakeholderBrief(ORM):
    id: int
    name: str
    kind: str
    user_id: int | None = None


class EntityBrief(ORM):
    id: int
    code: str
    name: str
    country: str | None = None


class RequirementBrief(ORM):
    id: int
    number: str
    section: str


class Ok(BaseModel):
    ok: bool = True


class IdOut(BaseModel):
    id: int


class CommentIn(BaseModel):
    body: str


class CommentOut(ORM):
    id: int
    target_type: str
    target_id: int
    body: str
    created_at: datetime
    edited_at: datetime | None = None
    author: UserBrief | None = None


class DocLinkOut(BaseModel):
    link_id: int
    document_id: int
    title: str
    doc_type: str
    status: str
    version_label: str | None = None
    filename: str | None = None
    note: str | None = None


__all__ = [
    "ORM",
    "UserBrief",
    "StakeholderBrief",
    "EntityBrief",
    "RequirementBrief",
    "Ok",
    "IdOut",
    "date",
    "datetime",
    "CommentIn",
    "CommentOut",
    "DocLinkOut",
]

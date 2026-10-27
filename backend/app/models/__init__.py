from app.models.ai import Conversation, Message
from app.models.assessment import ActionItem, Answer, AnswerRevision, Assessment, AssessmentRound, SavedView
from app.models.auth import ApiToken, LoginAttempt, Role, RoleAssignment, User, UserSession
from app.models.catalog import Chapter, ChapterTargetChange, Requirement
from app.models.common import AuditEvent, Comment, Notification, SearchChunk, Setting
from app.models.documents import Document, DocumentAcknowledgement, DocumentLink, DocumentVersion, Folder
from app.models.incidents import Incident
from app.models.org import Entity, Stakeholder
from app.models.project import (
    Activity,
    Gate,
    Phase,
    Project,
    RaciActivity,
    RaciCell,
    RaciColumn,
    RaidRecord,
    Task,
    WorkPackage,
    activity_dependencies,
    work_package_findings,
)
from app.models.regulations import Provision, Regulation, RequirementProvision


def _import_feature_models() -> None:
    """Register models of feature modules (app/features/<name>/models.py) with the metadata."""
    import importlib
    import pkgutil

    import app.features as features

    for mod in pkgutil.iter_modules(features.__path__):
        try:
            importlib.import_module(f"app.features.{mod.name}.models")
        except ModuleNotFoundError as e:
            if e.name != f"app.features.{mod.name}.models":
                raise


_import_feature_models()

__all__ = [
    "ActionItem",
    "Activity",
    "Answer",
    "AnswerRevision",
    "ApiToken",
    "Assessment",
    "AssessmentRound",
    "AuditEvent",
    "Chapter",
    "ChapterTargetChange",
    "Comment",
    "Conversation",
    "Document",
    "DocumentAcknowledgement",
    "DocumentLink",
    "DocumentVersion",
    "Entity",
    "Folder",
    "Gate",
    "Incident",
    "LoginAttempt",
    "Message",
    "Notification",
    "Phase",
    "Project",
    "Provision",
    "RaciActivity",
    "RaciCell",
    "RaciColumn",
    "RaidRecord",
    "Regulation",
    "Requirement",
    "RequirementProvision",
    "Role",
    "RoleAssignment",
    "SavedView",
    "SearchChunk",
    "Setting",
    "Stakeholder",
    "Task",
    "User",
    "UserSession",
    "WorkPackage",
    "activity_dependencies",
    "work_package_findings",
]

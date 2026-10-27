"""Governance API: legal-basis tagging, registrations and changes, obligation calendar, management body."""

from fastapi import APIRouter

from app.features.governance import hooks  # noqa: F401  (registers targets and search sources)
from app.features.governance.api_board import router as board_router
from app.features.governance.api_legal import router as legal_router
from app.features.governance.api_registry import router as registry_router

router = APIRouter(prefix="/governance", tags=["governance"])
router.include_router(legal_router)
router.include_router(registry_router)
router.include_router(board_router)

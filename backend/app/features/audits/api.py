"""Audits & reviews API: audit programme, audits, findings, effectiveness reviews and management reviews."""

from fastapi import APIRouter

from app.features.audits import hooks  # noqa: F401  (registers targets, search sources, approval adapter)
from app.features.audits.api_audits import router as audits_router
from app.features.audits.api_reviews import router as reviews_router

router = APIRouter(prefix="/audits", tags=["audits"])
router.include_router(audits_router)
router.include_router(reviews_router)

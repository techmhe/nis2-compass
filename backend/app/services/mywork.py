"""Extension point for the personal work view (/api/me/work).

Feature modules register a provider returning items in a common shape:
{"kind": str, "kind_label": str, "id": int, "code": str | None, "title": str, "entity_code": str | None,
 "due": date | None, "href": str, "status": str | None}
"""

from collections.abc import Callable

PROVIDERS: dict[str, Callable] = {}


def register_provider(key: str, fn: Callable) -> None:
    PROVIDERS[key] = fn


def collect(db, pr, stakeholder_ids: list[int]) -> list[dict]:
    items: list[dict] = []
    for key, fn in PROVIDERS.items():
        try:
            items += fn(db, pr, stakeholder_ids) or []
        except Exception:  # noqa: BLE001 - a broken provider must not break the personal view
            import logging

            logging.getLogger(__name__).exception("my-work provider %s failed", key)
    return items

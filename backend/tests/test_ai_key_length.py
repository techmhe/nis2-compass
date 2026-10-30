import os

BASE = {"enabled": False, "chat_model": "m", "base_url": "https://llm.example.org/v1"}


def _admin(login):
    return login("admin@example.local", os.environ["NIS2_BOOTSTRAP_ADMIN_PASSWORD"])


def test_long_api_key_is_accepted_and_stored(login):
    # IONOS AI Model Hub issues API keys of about 1750 characters.
    r = _admin(login).put("/api/ai/settings", json={**BASE, "api_key": "k" * 1747})
    assert r.status_code == 200, r.text
    assert r.json()["has_api_key"] is True


def test_absurdly_long_api_key_is_rejected(login):
    r = _admin(login).put("/api/ai/settings", json={**BASE, "api_key": "k" * 8193})
    assert r.status_code == 422

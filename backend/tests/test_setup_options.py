"""What the setup page needs before any session exists."""

from tests.test_seed_base import base_seed  # noqa: F401
from tests.test_setup import client, empty, seeded  # noqa: F401, F811


def test_setup_options_carry_authority_and_auth_facts(client):  # noqa: F811
    body = client.get("/api/setup/options").json()
    de = next(j for j in body["jurisdictions"] if j["code"] == "DE")
    assert de["competent_authority"] == "BSI" and de["csirt"] == "BSI"
    assert body["password_min_length"] >= 8
    assert isinstance(body["local_enabled"], bool)

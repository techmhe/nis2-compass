import pytest

TOUR = {"version": 1, "status": "started", "chapters_done": ["intro", "gap-1_a"]}


def test_tour_is_stored_and_returned(login):
    c = login("isb@demo.local")
    assert c.patch("/api/auth/me", json={"preferences": {"tour": TOUR}}).status_code == 200
    assert c.get("/api/auth/me").json()["preferences"]["tour"] == TOUR


@pytest.mark.parametrize(
    "tour",
    [
        {**TOUR, "status": "running"},
        {**TOUR, "version": 0},
        {**TOUR, "version": 1001},
        {**TOUR, "chapters_done": ["my chapter"]},
        {**TOUR, "chapters_done": [f"c{i}" for i in range(31)]},
        {**TOUR, "chapters_done": ["a" * 41]},
        {**TOUR, "x": 1},
        "done",
    ],
)
def test_invalid_tour_is_rejected(login, tour):
    c = login("isb@demo.local")
    assert c.patch("/api/auth/me", json={"preferences": {"tour": tour}}).status_code == 422


def test_email_notifications_alone_and_with_tour_and_tour_survives(login):
    c = login("isb@demo.local")
    assert c.patch("/api/auth/me", json={"preferences": {"email_notifications": False}}).status_code == 200
    both = {"email_notifications": True, "tour": TOUR}
    assert c.patch("/api/auth/me", json={"preferences": both}).status_code == 200
    assert c.patch("/api/auth/me", json={"preferences": {"email_notifications": False}}).status_code == 200
    prefs = c.get("/api/auth/me").json()["preferences"]
    assert prefs["tour"] == TOUR
    assert prefs["email_notifications"] is False


@pytest.mark.parametrize("version", ["1", True, 1.0])
def test_tour_version_must_be_an_integer(login, version):
    c = login("isb@demo.local")
    tour = {**TOUR, "version": version}
    assert c.patch("/api/auth/me", json={"preferences": {"tour": tour}}).status_code == 422
    stored = c.get("/api/auth/me").json()["preferences"].get("tour")
    assert stored is None or type(stored["version"]) is int

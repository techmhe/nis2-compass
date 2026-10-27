from app.services.regulations import parse_bsig_reference, parse_iso_reference


def test_bsig_reference_parser():
    assert parse_bsig_reference("§ 30 Abs. 2 Nr. 9 und 10 BSIG") == ["30.2.9", "30.2.10"]
    assert parse_bsig_reference("§ 30 Abs. 1 und Abs. 2 Nr. 1 BSIG") == ["30.1", "30.2.1"]
    assert parse_bsig_reference("§ 32 Abs. 1 Satz 1 Nr. 3 und 4 sowie Abs. 2 BSIG") == [
        "32.1.3",
        "32.1.4",
        "32.2",
    ]
    assert parse_bsig_reference("§ 38 Abs. 1 BSIG in Verbindung mit § 30 Abs. 1 Satz 3 BSIG") == [
        "38.1",
        "30.1",
    ]
    assert parse_bsig_reference("§ 30 Abs. 2 Nr. 3, 5 und 9 BSIG") == ["30.2.3", "30.2.5", "30.2.9"]


def test_iso_reference_parser():
    assert parse_iso_reference("5.2, A.5.1, A.5.36") == ["5.2", "A.5.1", "A.5.36"]

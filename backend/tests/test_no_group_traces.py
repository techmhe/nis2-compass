"""The repository must not carry traces of the owner's real group or person (codes, names, town, home paths).

The patterns themselves would be such a trace, so they live in a local file that is never published
(`.local/publish-patterns.txt`, also read by scripts/publish.sh). Without it, as in CI, these tests skip.
"""

import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PATTERNS_FILE = REPO / ".local" / "publish-patterns.txt"

# Paths that stay in the local repository only; scripts/publish.sh leaves them out of every snapshot.
LOCAL_ONLY = [
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/hooks",
    ".local",
    "docs/plans",
    "docs/specs",
    "docs/research",
    "scripts/publish.sh",
    "scripts/release-step.sh",
    "scripts/tests",
]
EXCLUDES = [f":!{p}" for p in LOCAL_ONLY]
GREP_FLAGS = {"word": "-nwE", "case": "-nE", "text": "-niE"}


def load_patterns() -> list[tuple[str, str]]:
    """(kind, regex) pairs from the local pattern file; empty when the file is absent."""
    if not PATTERNS_FILE.is_file():
        return []
    out = []
    for line in PATTERNS_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        kind, _, rx = line.partition(" ")
        if kind not in GREP_FLAGS or not rx.strip():
            raise ValueError(f"bad line in {PATTERNS_FILE}: {line}")
        out.append((kind, rx.strip()))
    return out


PATTERNS = load_patterns()
needs_patterns = pytest.mark.skipif(not PATTERNS, reason="the pattern file is local and not published")


def compiled() -> list[re.Pattern]:
    """The patterns as Python regexes with the same matching rules as the grep flags."""
    out = []
    for kind, rx in PATTERNS:
        if kind == "word":
            out.append(re.compile(rf"\b(?:{rx})\b"))
        elif kind == "case":
            out.append(re.compile(rx))
        else:
            out.append(re.compile(rx, re.I))
    return out


@needs_patterns
@pytest.mark.skipif(shutil.which("git") is None, reason="git is not available")
@pytest.mark.parametrize("kind,pattern", PATTERNS or [("text", "")])
def test_no_group_traces(kind, pattern):
    if not (REPO / ".git").exists():
        pytest.skip("not a git checkout")
    result = subprocess.run(
        ["git", "grep", GREP_FLAGS[kind], pattern, "--", ".", *EXCLUDES],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.stdout == "", result.stdout


@needs_patterns
def test_templates_carry_no_group_traces_in_any_part():
    """Chart caches, shared strings, defined names: every XML part of the shipped workbooks."""
    banned = compiled()
    files = [
        p for d in ("templates", "backend/app/seed/templates") for p in sorted((REPO / d).glob("*.xlsx"))
    ]
    assert len(files) == 4
    for path in files:
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith((".xml", ".rels")):
                    text = z.read(name).decode("utf-8", "replace")
                    for rx in banned:
                        assert not rx.search(text), (path.name, name, rx.pattern)

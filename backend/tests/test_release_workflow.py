"""The image job of the release workflow: exact tags always, floating tags only for the newest release."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github" / "workflows" / "verify.yml").read_text()
IMAGE_JOB = WORKFLOW.split("\n  image:\n", 1)[1].split("\n  attest:\n", 1)[0]
NEWEST_OUTPUT = r"\$\{\{ steps\.[a-z_]+\.outputs\.[a-z_]+ == 'true' \}\}"


def test_image_job_keeps_the_exact_tags_unconditional():
    assert re.search(r"^\s+type=semver,pattern=\{\{version\}\}$", IMAGE_JOB, re.MULTILINE)
    assert re.search(r"^\s+type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}$", IMAGE_JOB, re.MULTILINE)


def test_floating_tags_are_bound_to_their_own_outputs():
    major = rf"^\s+type=semver,pattern=\{{\{{major\}}\}},enable={NEWEST_OUTPUT}$"
    latest = rf"^\s+type=raw,value=latest,enable={NEWEST_OUTPUT}$"
    major_match = re.search(major, IMAGE_JOB, re.MULTILINE)
    latest_match = re.search(latest, IMAGE_JOB, re.MULTILINE)
    assert major_match and latest_match
    assert "outputs.newest_major ==" in major_match.group(0)
    assert "outputs.newest ==" in latest_match.group(0)


def test_newest_major_is_computed_within_the_refs_own_major():
    assert 'git tag -l "${major}.*"' in IMAGE_JOB or 'git tag -l "${MAJOR}.*"' in IMAGE_JOB
    assert "newest_major=" in IMAGE_JOB and "newest=" in IMAGE_JOB


def test_image_jobs_are_serialized_without_cancelling():
    block = re.search(r"^    concurrency:\n((?:      .*\n)+)", IMAGE_JOB + "\n", re.MULTILINE)
    assert block, "the image job needs a concurrency block"
    assert "group: image-release" in block.group(1)
    assert "cancel-in-progress: false" in block.group(1)


def test_newest_step_runs_before_meta_and_gets_the_ref_via_env():
    step = re.search(
        r"- id: (\w+)\n(?:(?!\n      - ).)*?env:\n\s+\w+: \$\{\{ github\.ref_name \}\}", IMAGE_JOB, re.DOTALL
    )
    assert step, "a step must compare the ref name against the highest release tag"
    assert IMAGE_JOB.index(f"id: {step.group(1)}") < IMAGE_JOB.index("id: meta")
    assert f"steps.{step.group(1)}.outputs" in IMAGE_JOB
    run_blocks = re.findall(r"run: \|\n((?:\s{10,}.*\n)+)", IMAGE_JOB)
    assert run_blocks and not any("${{" in block for block in run_blocks)


def test_checkout_fetches_the_tags():
    checkout = IMAGE_JOB.split("actions/checkout@", 1)[1].split("docker/setup-buildx-action", 1)[0]
    assert "fetch-depth: 0" in checkout or "fetch-tags: true" in checkout
    assert "persist-credentials: false" in checkout

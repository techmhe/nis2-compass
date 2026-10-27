"""Print the first-run setup token: python -m app.setup_token"""

from app.services.setup import expected_setup_token, setup_needed_now


def main() -> int:
    print(expected_setup_token() if setup_needed_now() else "setup already completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

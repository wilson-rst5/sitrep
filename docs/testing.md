# Testing

```sh
python -m pip install -r services/core/requirements.txt pytest ruff
ruff check --select E4,E7,E9,F services/core tests/unit
PYTHONPATH=services/core pytest tests/unit
npm --prefix apps/web ci
npm --prefix apps/web run build
```

For Playwright, start a fresh Compose project with its own volumes and set `SITREP_TEST_SETUP_TOKEN` from that project’s bootstrap token. Install `@playwright/test` and Chromium, then run `npx playwright test`. The smoke test creates the first account and verifies desktop kiosk controls and mobile sizing. Never run the bootstrap test against an existing installation.

See [validation](validation.md) for observed results.

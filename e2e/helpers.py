"""
Shared Playwright helpers for fælles. screenshot checks. SCAFFOLD-OWNED.

Run with the box's venv:
    ~/.venvs/playwright/bin/python e2e/b_core.py
Env:
    FAELLES_URL   app URL incl. base (default http://127.0.0.1:8498/photos/  = package A's dev container)
    FAELLES_PIN   default 1234
Screenshots land in e2e/out/<name>-<w>x<h>.png (gitignored).
"""
from __future__ import annotations

import os
import pathlib
from contextlib import contextmanager
from typing import Iterator

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

URL = os.environ.get("FAELLES_URL", "http://127.0.0.1:8498/photos/")
PIN = os.environ.get("FAELLES_PIN", "1234")
OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}
VIEWPORTS = {"mobile": MOBILE, "desktop": DESKTOP}


@contextmanager
def browser() -> Iterator[Browser]:
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


def new_context(b: Browser, viewport: dict, *, touch: bool | None = None) -> BrowserContext:
    mobile = viewport["width"] < 900 if touch is None else touch
    return b.new_context(
        viewport=viewport,
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
        locale="en-GB",
        timezone_id="Europe/Copenhagen",
    )


def login(ctx: BrowserContext, person: str | None = "edi") -> None:
    """Authenticate through the real API (sets the session cookie in ctx)."""
    r = ctx.request.post(URL + "api/session", data={"pin": PIN})
    assert r.ok, f"login failed: {r.status} {r.text()}"
    if person:
        r = ctx.request.put(URL + "api/session/person", data={"person": person})
        assert r.ok, f"set person failed: {r.status} {r.text()}"


def shot(page: Page, name: str) -> pathlib.Path:
    vp = page.viewport_size or {"width": 0, "height": 0}
    path = OUT / f"{name}-{vp['width']}x{vp['height']}.png"
    page.screenshot(path=str(path), full_page=False)
    return path


def assert_no_horizontal_scroll(page: Page) -> None:
    sw = page.evaluate("document.documentElement.scrollWidth")
    cw = page.evaluate("document.documentElement.clientWidth")
    assert sw <= cw + 1, f"horizontal scroll: scrollWidth {sw} > clientWidth {cw}"


def collect_console_errors(page: Page) -> list[str]:
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    return errors

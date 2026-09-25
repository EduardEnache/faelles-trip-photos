"""
visual + interaction verification for auth, library, viewer,
select and upload. Logs in with the real PIN, walks library -> viewer ->
select -> upload (a real small JPEG), screenshots every state at 390x844 and
1440x900 into e2e/out/.

Run with the box's venv:
    ~/.venvs/playwright/bin/python e2e/b_core.py
Env:
    FAELLES_URL   default http://127.0.0.1:8498/photos/  (package A's dev container)
    FAELLES_PIN   default 1234
"""
from __future__ import annotations

import base64
import pathlib
import sys
import time

from playwright.sync_api import Page, expect

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from helpers import (  # noqa: E402
    DESKTOP,
    MOBILE,
    PIN,
    URL,
    assert_no_horizontal_scroll,
    new_context,
    shot,
)

# A minimal, valid 1x1 red-pixel JPEG (real bytes, decodes fine).
_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA"
    "AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEB"
    "AQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX"
    "/9k="
)


def make_jpeg(path: pathlib.Path) -> pathlib.Path:
    path.write_bytes(base64.b64decode(_JPEG_B64))
    return path


def wait_idle(page: Page, ms: int = 300) -> None:
    page.wait_for_timeout(ms)


def main() -> None:
    from playwright.sync_api import sync_playwright

    fixture = make_jpeg(pathlib.Path("/tmp/faelles_e2e_test.jpg"))

    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            for name, viewport in (("mobile", MOBILE), ("desktop", DESKTOP)):
                print(f"== {name} {viewport} ==")
                ctx = new_context(b, viewport)
                errors: list[str] = []
                page = ctx.new_page()
                errors.extend([])
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(str(e)))

                wide = viewport["width"] >= 900

                # ── 01 PIN gate ──────────────────────────────────────────
                page.goto(URL, wait_until="networkidle")
                wait_idle(page, 400)
                expect(page.get_by_text("Velkommen.")).to_be_visible()
                shot(page, "b_pin")
                assert_no_horizontal_scroll(page)

                # wrong PIN -> shake + message
                for d in "0000":
                    page.get_by_role("button", name=d, exact=True).click()
                wait_idle(page, 400)
                expect(page.get_by_text("Not quite.", exact=False)).to_be_visible()
                shot(page, "b_pin_wrong")
                # let it clear back to empty, editable dots (650ms shake/clear timer)
                expect(page.get_by_role("status")).to_have_attribute("aria-label", "0 of 4 digits entered", timeout=3000)

                # correct PIN
                for d in PIN:
                    page.get_by_role("button", name=d, exact=True).click()
                    page.wait_for_timeout(60)
                page.wait_for_timeout(600)

                # ── 02 Who's this? ───────────────────────────────────────
                expect(page.get_by_text("Who’s this?")).to_be_visible(timeout=8000)
                shot(page, "b_who")
                page.locator("button", has_text="Chris").first.click()
                page.wait_for_load_state("networkidle")
                wait_idle(page, 300)

                # ── 03 Library ───────────────────────────────────────────
                expect(page.get_by_text("Denmark", exact=True)).to_be_visible()
                shot(page, "b_library")
                assert_no_horizontal_scroll(page)

                # ── 06/07 Upload ─────────────────────────────────────────
                page.get_by_role("button", name="Upload").first.click() if wide else page.get_by_label(
                    "Upload"
                ).click()
                wait_idle(page, 300)
                expect(page.get_by_text("Add to the album")).to_be_visible()
                shot(page, "b_upload_pick")

                page.set_input_files('input[type="file"]', str(fixture))
                wait_idle(page, 400)
                shot(page, "b_upload_progress")

                # wait for the row to finish (small file, dev backend, generous timeout)
                page.wait_for_selector("text=All done", timeout=20000)
                wait_idle(page, 200)
                shot(page, "b_upload_done")

                page.get_by_role("button", name="View in library").click()
                wait_idle(page, 500)
                assert "upload=1" not in page.url, "upload sheet did not close"
                shot(page, "b_library_with_item")

                # ── 05 Viewer ────────────────────────────────────────────
                tiles = page.locator('button[aria-label*="Photo"], button[aria-label*="Video"]')
                expect(tiles.first).to_be_visible(timeout=10000)
                tiles.first.click()
                wait_idle(page, 400)
                shot(page, "b_viewer")
                assert_no_horizontal_scroll(page)

                if wide:
                    # keyboard nav in viewer (desktop has a hardware keyboard)
                    page.keyboard.press("ArrowRight")
                    wait_idle(page, 250)
                    page.keyboard.press("ArrowLeft")
                    wait_idle(page, 250)

                # Escape closes the viewer
                page.keyboard.press("Escape")
                wait_idle(page, 300)
                assert "item=" not in page.url, f"Escape did not close the viewer: {page.url}"

                # back button closes overlays: reopen, then go back
                tiles.first.click()
                wait_idle(page, 300)
                assert "item=" in page.url
                page.go_back()
                wait_idle(page, 300)
                assert "item=" not in page.url, "Back button did not close the viewer"

                # ── 04 Select & download ─────────────────────────────────
                box = tiles.first.bounding_box()
                assert box
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.wait_for_timeout(600)  # > 480ms long-press threshold
                page.mouse.up()
                wait_idle(page, 300)
                expect(page.get_by_text("selected", exact=False).first).to_be_visible()
                shot(page, "b_select")
                assert_no_horizontal_scroll(page)

                # exit select mode
                cancel_btn = page.get_by_role("button", name="Cancel").first
                if cancel_btn.count():
                    cancel_btn.click()
                wait_idle(page, 200)

                # A 401 on a resource load is Chromium's own console noise for the
                # deliberate wrong-PIN attempt and the pre-auth SSE connection —
                # both expected here, not app bugs.
                real_errors = [e for e in errors if "401" not in e]
                print(f"{name}: console/page errors = {errors}")
                assert not real_errors, f"{name}: unexpected console/page errors: {real_errors}"

                ctx.close()
        finally:
            b.close()

    print("b_core.py: all checks passed.")


if __name__ == "__main__":
    main()

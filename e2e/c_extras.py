#!/usr/bin/env python3
"""
the frontend visual verification (PLAN.md §9 "the frontend" / §8 "Verify").

Captures the Memories tab, the memory player (playing + paused), the Places
tab, and a day-caption edit, at 390x844 and 1440x900, into e2e/shots/c_*.png.
Also asserts: no console errors, no horizontal scroll, touch targets >= 44px
in their smaller dimension (inline text links excepted).

Run with:  ~/.venvs/playwright/bin/python e2e/c_extras.py
Env:       FAELLES_URL (default http://127.0.0.1:8498/photos/), FAELLES_PIN
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from helpers import (  # noqa: E402
    URL,
    VIEWPORTS,
    assert_no_horizontal_scroll,
    browser,
    collect_console_errors,
    login,
    new_context,
)

OUT = pathlib.Path(__file__).parent / "shots"
OUT.mkdir(exist_ok=True)

FAILURES: list[str] = []


def note(msg: str) -> None:
    print(msg)


def fail(msg: str) -> None:
    print(f"  FAIL: {msg}")
    FAILURES.append(msg)


def shot(page, name: str) -> pathlib.Path:
    vp = page.viewport_size or {"width": 0, "height": 0}
    path = OUT / f"c_{name}-{vp['width']}x{vp['height']}.png"
    page.screenshot(path=str(path), full_page=False)
    note(f"  shot: {path.name}")
    return path


def check_no_console_errors(errors: list[str], label: str) -> None:
    if errors:
        fail(f"{label}: console errors: {errors}")


def check_touch_targets(page, label: str) -> None:
    """Interactive elements >= 44px in their smaller dimension (inline text links excepted)."""
    small = page.evaluate(
        """
        () => {
          const els = document.querySelectorAll('button, [role="button"], a[href]');
          const bad = [];
          for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue; // not rendered
            const isInlineLink = el.tagName === 'A' && getComputedStyle(el).display.includes('inline');
            if (isInlineLink) continue;
            const smaller = Math.min(r.width, r.height);
            if (smaller > 0 && smaller < 44) {
              bad.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) + ` (${Math.round(smaller)}px)`);
            }
          }
          return bad;
        }
        """
    )
    if small:
        fail(f"{label}: touch targets < 44px: {small}")


def run_viewport(pw_browser, name: str, viewport: dict) -> None:
    note(f"\n== {name} {viewport['width']}x{viewport['height']} ==")
    ctx = new_context(pw_browser, viewport)
    page = ctx.new_page()
    errors = collect_console_errors(page)
    login(ctx, person="edi")

    page.goto(URL)
    page.wait_for_load_state("networkidle")

    # ---- Memories tab ----
    page.get_by_role("button", name="Memories", exact=True).first.click()
    page.wait_for_timeout(400)
    assert_no_horizontal_scroll(page)
    shot(page, "memories-tab")
    check_touch_targets(page, f"{name}/memories-tab")

    # ---- Memory player: playing, then paused ----
    memory_cards = page.locator('section[aria-label="Memories"] button')
    opened = False
    if memory_cards.count() > 0:
        memory_cards.first.click()
        opened = True
    else:
        # No memory qualifies yet from the grid; try the featured card on Library.
        page.get_by_role("button", name="Library", exact=True).first.click()
        page.wait_for_timeout(300)
        featured = page.locator("main button").first
        if featured.count() > 0:
            featured.click()
            opened = True

    if opened:
        page.wait_for_timeout(600)
        if page.locator('div[role="dialog"][aria-label^="Memory"]').count() > 0:
            shot(page, "memory-player-playing")
            # Pause via the bottom-bar Play/Pause button.
            pause_btn = page.get_by_role("button", name=re.compile("^(Pause|Play)$"))
            if pause_btn.count() > 0:
                pause_btn.first.click()
                page.wait_for_timeout(200)
                shot(page, "memory-player-paused")
            else:
                fail(f"{name}: no play/pause button found in memory player")
            assert_no_horizontal_scroll(page)
            check_touch_targets(page, f"{name}/memory-player")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
        else:
            fail(f"{name}: memory player did not open (no qualifying memory in seed data?)")
    else:
        fail(f"{name}: no memory card to open (seed data may be too small for any memory)")

    # ---- Places tab ----
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Places", exact=True).first.click()
    page.wait_for_timeout(1500)  # map tile fetch + recolour
    assert_no_horizontal_scroll(page)
    shot(page, "places-tab")
    check_touch_targets(page, f"{name}/places-tab")

    # ---- Caption edit ----
    page.get_by_role("button", name="Library", exact=True).first.click()
    page.wait_for_timeout(300)
    caption_trigger = page.get_by_text("Add a line about this day").first
    if caption_trigger.count() == 0:
        caption_trigger = page.get_by_role("button", name=re.compile("^Day caption")).first
    if caption_trigger.count() == 0:
        fail(f"{name}: no day-caption control found on the library tab")
    else:
        caption_trigger.scroll_into_view_if_needed()
        caption_trigger.click()
        input_box = page.locator('input[aria-label="Day caption"]')
        input_box.fill("A quiet morning by the harbour")
        page.wait_for_timeout(150)
        shot(page, "caption-edit")
        page.keyboard.press("Escape")

    check_no_console_errors(errors, name)
    ctx.close()


def main() -> None:
    with browser() as b:
        for name, viewport in VIEWPORTS.items():
            run_viewport(b, name, viewport)

    if FAILURES:
        print(f"\n{len(FAILURES)} failure(s):")
        for f in FAILURES:
            print(f" - {f}")
        sys.exit(1)
    print("\nAll c_extras checks passed.")


if __name__ == "__main__":
    main()

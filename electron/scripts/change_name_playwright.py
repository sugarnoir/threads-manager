#!/usr/bin/env python3
"""
Instagram 名前変更スクリプト（Playwright 使用）
デスクトップ表示 + Cookie 注入でアカウントセンター経由で名前変更。
"""

import sys
import json
import argparse


DESKTOP = {
    "user_agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "viewport": {"width": 1280, "height": 900},
    "device_scale_factor": 2,
    "is_mobile": False,
    "has_touch": False,
}


def log(msg):
    print(f"[change_name_playwright.py] {msg}", file=sys.stderr)


def safe_screenshot(page, path):
    try:
        page.screenshot(path=path, timeout=5000)
    except Exception:
        log(f"screenshot failed: {path}")


def dismiss_modals(page):
    selectors = [
        'button:has-text("OK")',
        'button:has-text("後で")',
        ':text("後で")',
        'button:has-text("Not Now")',
        'button:has-text("Not now")',
        'button:has-text("あとで")',
        'button:has-text("Later")',
        '[aria-label="閉じる"]',
        '[aria-label="Close"]',
    ]
    for _ in range(5):
        dismissed = False
        for sel in selectors:
            try:
                btn = page.query_selector(sel)
                if btn and btn.is_visible():
                    btn.click(timeout=3000)
                    log(f"dismissed: {sel}")
                    dismissed = True
                    page.wait_for_timeout(1000)
                    break
            except Exception:
                pass
        if not dismissed:
            break


def wait_for_page(page, hint_selector='a', timeout=30000):
    """ページコンテンツが表示されるまで待つ"""
    try:
        page.wait_for_selector(hint_selector, timeout=timeout)
    except Exception:
        pass
    page.wait_for_timeout(2000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sessionid', required=True)
    parser.add_argument('--csrftoken', required=True)
    parser.add_argument('--ds_user_id', required=True)
    parser.add_argument('--new_name', required=True)
    parser.add_argument('--proxy', default=None)
    parser.add_argument('--mid', default=None)
    parser.add_argument('--ig_did', default=None)
    parser.add_argument('--rur', default=None)
    args = parser.parse_args()

    log(f"ds_user_id={args.ds_user_id} new_name={args.new_name}")
    log(f"proxy={args.proxy or 'None'}")

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            launch_opts = {"headless": True}
            if args.proxy:
                from urllib.parse import urlparse
                parsed = urlparse(args.proxy)
                proxy_conf = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
                if parsed.username:
                    proxy_conf["username"] = parsed.username
                if parsed.password:
                    proxy_conf["password"] = parsed.password
                launch_opts["proxy"] = proxy_conf

            browser = p.chromium.launch(**launch_opts)

            context = browser.new_context(
                user_agent=DESKTOP["user_agent"],
                viewport=DESKTOP["viewport"],
                device_scale_factor=DESKTOP["device_scale_factor"],
                is_mobile=DESKTOP["is_mobile"],
                has_touch=DESKTOP["has_touch"],
                locale="ja-JP",
            )

            # ── Cookie 注入 ──────────────────────────────────────────
            cookies = [
                {"name": "sessionid",  "value": args.sessionid,  "domain": ".instagram.com", "path": "/"},
                {"name": "csrftoken",  "value": args.csrftoken,  "domain": ".instagram.com", "path": "/"},
                {"name": "ds_user_id", "value": args.ds_user_id, "domain": ".instagram.com", "path": "/"},
            ]
            if args.mid:
                cookies.append({"name": "mid",    "value": args.mid,    "domain": ".instagram.com", "path": "/"})
            if args.ig_did:
                cookies.append({"name": "ig_did", "value": args.ig_did, "domain": ".instagram.com", "path": "/"})
            if args.rur:
                cookies.append({"name": "rur",    "value": args.rur,    "domain": ".instagram.com", "path": "/"})

            context.add_cookies(cookies)
            log("cookies injected")

            page = context.new_page()

            # ── Step 1: /accounts/edit/ に直接遷移（ホーム省略）──────
            log("step1: navigating to /accounts/edit/...")
            try:
                page.goto("https://www.instagram.com/accounts/edit/", wait_until="domcontentloaded", timeout=60000)
            except Exception as e:
                log(f"nav slow, continuing: {e}")
            wait_for_page(page, 'a')

            if "/accounts/login" in page.url:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "セッション切れ（ログインページにリダイレクト）"}))
                sys.exit(1)

            dismiss_modals(page)
            safe_screenshot(page, "/tmp/change_name_1_home.png")

            # ── Step 2: 「個人の情報」をクリック ─────────────────────
            log("step2: clicking personal info...")
            clicked = False
            for sel in [
                'a:has-text("個人の情報")',
                'a:has-text("個人情報")',
                'a:has-text("Personal info")',
                'a:has-text("プロフィールと個人の情報")',
                'a:has-text("アカウントセンター")',
                'a[href*="personal_info"]',
                'a[href*="accountscenter"]',
            ]:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.click()
                    log(f"clicked: {sel}")
                    clicked = True
                    break

            if not clicked:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "「個人の情報」が見つかりません"}))
                sys.exit(1)

            wait_for_page(page, 'a')

            # アカウントセンターに飛んだ場合、「プロフィールと個人の情報」をクリック
            for sel in [
                'a:has-text("プロフィールと個人の情報")',
                'a:has-text("Profile and personal info")',
                'a:has-text("個人の情報")',
                'a:has-text("Personal info")',
            ]:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.click()
                    log(f"clicked nested: {sel}")
                    wait_for_page(page, 'a:has-text("Instagram")')
                    break

            wait_for_page(page, 'a:has-text("Instagram")')
            safe_screenshot(page, "/tmp/change_name_2_edit.png")

            # ── Step 3: Instagram プロフィールをクリック ──────────────
            log("step3: clicking Instagram profile...")
            profile_link = None
            for sel in [
                'a[href*="/personal_info/profiles"]:has-text("Instagram")',
                'a:has-text("Instagram")',
                'a[href*="/profiles/"]',
            ]:
                els = page.query_selector_all(sel)
                for el in els:
                    if el.is_visible():
                        profile_link = el
                        log(f"found profile: {sel}")
                        break
                if profile_link:
                    break

            if not profile_link:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "Instagramプロフィールが見つかりません"}))
                sys.exit(1)

            profile_link.click()
            # 「名前」リンクが出るまで待つ
            wait_for_page(page, 'a:has-text("名前")')
            safe_screenshot(page, "/tmp/change_name_3_profile.png")

            # ── Step 4: 「名前」をクリック ────────────────────────────
            log("step4: clicking name link...")
            name_link = None
            for sel in [
                'a[href*="/name"]',
                'a:has-text("名前")',
                'a:has-text("Name")',
            ]:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    name_link = el
                    log(f"found name: {sel}")
                    break

            if not name_link:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "「名前」リンクが見つかりません"}))
                sys.exit(1)

            name_link.click()
            # 入力欄が出るまで待つ
            wait_for_page(page, 'input')
            safe_screenshot(page, "/tmp/change_name_4_name.png")

            # ── Step 5: 名前入力＆保存 ───────────────────────────────
            log("step5: filling name...")
            name_input = None
            for sel in [
                'input[aria-label="名前"]',
                'input[aria-label="Name"]',
                'input[aria-label="名"]',
                'input[aria-label="First name"]',
                'input[name="fullName"]',
                'input[name="name"]',
                'input[name="firstName"]',
            ]:
                el = page.query_selector(sel)
                if el:
                    name_input = el
                    log(f"found input: {sel}")
                    break

            if not name_input:
                inputs = page.query_selector_all('input[type="text"], input:not([type])')
                for inp in inputs:
                    if inp.is_visible() and inp.is_enabled():
                        name_input = inp
                        log("found input via fallback")
                        break

            if not name_input:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "名前入力欄が見つかりません"}))
                sys.exit(1)

            name_input.click()
            name_input.fill("")
            page.wait_for_timeout(300)
            name_input.fill(args.new_name)
            log(f"filled: {args.new_name}")
            page.wait_for_timeout(500)

            # 保存ボタン
            log("step5: clicking save...")
            save_btn = None
            for sel in [
                'button:has-text("完了")',
                'button:has-text("Done")',
                'div[role="button"]:has-text("完了")',
                'div[role="button"]:has-text("Done")',
                'button:has-text("変更を保存")',
                'button:has-text("Save Changes")',
                'button:has-text("保存")',
                'button:has-text("Save")',
                'button[type="submit"]',
            ]:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    save_btn = el
                    log(f"found save: {sel}")
                    break

            if not save_btn:
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": "保存ボタンが見つかりません"}))
                sys.exit(1)

            save_btn.click()
            log("clicked save")
            page.wait_for_timeout(3000)

            error_el = page.query_selector('[role="alert"]')
            if error_el:
                error_text = error_el.inner_text()
                log(f"alert: {error_text}")
                safe_screenshot(page, "/tmp/change_name_error.png")
                browser.close()
                print(json.dumps({"success": False, "error": error_text}))
                sys.exit(1)

            log("success")
            browser.close()
            print(json.dumps({"success": True, "newName": args.new_name}))

    except Exception as e:
        import traceback
        detail = traceback.format_exc()
        log(f"ERROR: {e}")
        log(detail)
        print(json.dumps({
            "success": False,
            "error": str(e),
            "detail": detail,
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()

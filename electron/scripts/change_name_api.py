#!/usr/bin/env python3
"""
Instagram 名前変更スクリプト（Web API 直接呼び出し）
ブラウザ不要。Cookie + CSRFToken で Instagram の Web API を叩く。
Playwright 版が遅いプロキシ付きアカウント向け。
"""

import sys
import json
import argparse
import requests


def log(msg):
    print(f"[change_name_api.py] {msg}", file=sys.stderr)


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
        sess = requests.Session()

        # プロキシ設定
        if args.proxy:
            sess.proxies = {
                "http": args.proxy,
                "https": args.proxy,
            }

        # Cookie 設定
        sess.cookies.set("sessionid", args.sessionid, domain=".instagram.com", path="/")
        sess.cookies.set("csrftoken", args.csrftoken, domain=".instagram.com", path="/")
        sess.cookies.set("ds_user_id", args.ds_user_id, domain=".instagram.com", path="/")
        if args.mid:
            sess.cookies.set("mid", args.mid, domain=".instagram.com", path="/")
        if args.ig_did:
            sess.cookies.set("ig_did", args.ig_did, domain=".instagram.com", path="/")
        if args.rur:
            sess.cookies.set("rur", args.rur, domain=".instagram.com", path="/")

        ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )

        # ── Step 1: 現在のプロフィール情報を取得 ─────────────────────
        log("fetching current profile...")
        headers = {
            "User-Agent": ua,
            "X-CSRFToken": args.csrftoken,
            "X-Requested-With": "XMLHttpRequest",
            "X-IG-App-ID": "936619743392459",
            "Referer": "https://www.instagram.com/accounts/edit/",
            "Origin": "https://www.instagram.com",
        }

        # 現在のプロフィールを取得
        r = sess.get(
            "https://www.instagram.com/api/v1/accounts/edit/web_form_data/",
            headers=headers,
            timeout=30,
        )
        log(f"form_data status={r.status_code}")

        if r.status_code == 401 or "login" in r.url:
            print(json.dumps({"success": False, "error": "セッション切れ (401)"}))
            sys.exit(1)

        form_data = {}
        if r.status_code == 200:
            try:
                data = r.json()
                if "form_data" in data:
                    form_data = data["form_data"]
                    log(f"current name: {form_data.get('first_name', '?')}")
                elif "data" in data and "form_data" in data["data"]:
                    form_data = data["data"]["form_data"]
                    log(f"current name: {form_data.get('first_name', '?')}")
            except Exception as e:
                log(f"parse form_data error: {e}")
                log(f"response: {r.text[:300]}")

        # ── Step 2: プロフィールを更新 ───────────────────────────────
        log(f"updating name to: {args.new_name}")

        # 既存のフォームデータを維持しつつ名前を変更
        edit_data = {
            "first_name": args.new_name,
            "email": form_data.get("email", ""),
            "username": form_data.get("username", ""),
            "phone_number": form_data.get("phone_number", ""),
            "biography": form_data.get("biography", ""),
            "external_url": form_data.get("external_url", ""),
            "chaining_enabled": form_data.get("chaining_enabled", "on"),
        }

        r2 = sess.post(
            "https://www.instagram.com/api/v1/web/accounts/edit/",
            headers=headers,
            data=edit_data,
            timeout=30,
        )
        log(f"edit status={r2.status_code}")
        log(f"edit response: {r2.text[:300]}")

        if r2.status_code == 200:
            try:
                result = r2.json()
                if result.get("status") == "ok" or result.get("user"):
                    new_name = args.new_name
                    if result.get("user", {}).get("full_name"):
                        new_name = result["user"]["full_name"]
                    log(f"success: {new_name}")
                    print(json.dumps({"success": True, "newName": new_name}))
                    sys.exit(0)
                else:
                    print(json.dumps({"success": False, "error": f"API returned: {r2.text[:200]}"}))
                    sys.exit(1)
            except json.JSONDecodeError:
                # status 200 だがJSONでない場合も成功扱い
                if "ok" in r2.text.lower():
                    print(json.dumps({"success": True, "newName": args.new_name}))
                    sys.exit(0)
                print(json.dumps({"success": False, "error": f"Unexpected response: {r2.text[:200]}"}))
                sys.exit(1)
        else:
            error_msg = f"HTTP {r2.status_code}"
            try:
                err_data = r2.json()
                if "message" in err_data:
                    error_msg = err_data["message"]
                elif "errors" in err_data:
                    error_msg = str(err_data["errors"])
            except Exception:
                error_msg = r2.text[:200]
            print(json.dumps({"success": False, "error": error_msg}))
            sys.exit(1)

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

#!/usr/bin/env python3
"""
Instagram 名前変更スクリプト（instagrapi 使用）
story_post.py と完全に同じセッション設定方式。
"""

import sys
import json
import argparse
import uuid

IG_APP_UA = (
    "Instagram 355.0.0.24.108 iPhone16,2 "
    "(iPhone 16 Pro Max; iOS 18_4; ja_JP; ja; "
    "scale=3.00; 1320x2868; 620931905)"
)


def log(msg):
    print(f"[change_name.py] {msg}", file=sys.stderr)


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

    ua = IG_APP_UA
    log(f"ds_user_id={args.ds_user_id} new_name={args.new_name}")
    log(f"proxy={args.proxy or 'None'}")
    log(f"UA={ua[:60]}...")

    try:
        from instagrapi import Client

        cl = Client()

        # ── story_post.py と完全に同じセッション設定 ──────────────────

        if args.proxy:
            cl.set_proxy(args.proxy)

        device_id = "android-" + args.ds_user_id[:16]
        settings = {
            "uuids": {
                "phone_id": str(uuid.uuid4()),
                "uuid": str(uuid.uuid4()),
                "client_session_id": str(uuid.uuid4()),
                "advertising_id": str(uuid.uuid4()),
                "android_device_id": device_id,
                "request_id": str(uuid.uuid4()),
                "tray_session_id": str(uuid.uuid4()),
            },
            "mid": args.mid or "",
            "ig_did": args.ig_did or str(uuid.uuid4()),
            "authorization_data": {
                "ds_user_id": args.ds_user_id,
                "sessionid": args.sessionid,
            },
            "cookies": {},
            "user_agent": ua,
        }
        cl.set_settings(settings)
        cl.set_user_agent(ua)

        # Cookie を直接セット
        cl.private.cookies.set("sessionid", args.sessionid, domain=".instagram.com", path="/")
        cl.private.cookies.set("csrftoken", args.csrftoken, domain=".instagram.com", path="/")
        cl.private.cookies.set("ds_user_id", args.ds_user_id, domain=".instagram.com", path="/")
        if args.mid:
            cl.private.cookies.set("mid", args.mid, domain=".instagram.com", path="/")
        if args.ig_did:
            cl.private.cookies.set("ig_did", args.ig_did, domain=".instagram.com", path="/")
        if args.rur:
            cl.private.cookies.set("rur", args.rur, domain=".instagram.com", path="/")

        cl.private.headers.update({
            "X-CSRFToken": args.csrftoken,
        })

        # login_by_sessionid をスキップ（useragent mismatch を回避）
        # user_id を手動設定
        try:
            cl.user_id = int(args.ds_user_id)
        except (AttributeError, TypeError):
            pass
        try:
            cl._user_id = args.ds_user_id
        except (AttributeError, TypeError):
            pass

        log("session ready (no login_by_sessionid)")

        # ── 名前変更 ────────────────────────────────────────────────

        log(f"calling account_edit(full_name={args.new_name})...")
        result = cl.account_edit(full_name=args.new_name)
        new_name = result.full_name if result and hasattr(result, 'full_name') else args.new_name
        log(f"success: {new_name}")
        print(json.dumps({"success": True, "newName": new_name}))

    except Exception as e:
        import traceback
        detail = traceback.format_exc()
        log(f"ERROR: {e}")
        log(detail)
        print(json.dumps({
            "success": False,
            "error": str(e),
            "detail": detail
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()

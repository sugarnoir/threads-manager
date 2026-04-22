#!/usr/bin/env python3
"""
Instagram ストーリー投稿スクリプト（instagrapi 使用）
login_by_sessionid は useragent mismatch になるためスキップし、
Cookie 直接注入 + photo_upload_to_story で投稿する。
"""

import sys
import json
import argparse
import os
import uuid

# Instagram モバイルアプリ UA
IG_APP_UA = (
    "Instagram 355.0.0.24.108 iPhone16,2 "
    "(iPhone 16 Pro Max; iOS 18_4; ja_JP; ja; "
    "scale=3.00; 1320x2868; 620931905)"
)


def log(msg):
    print(f"[story_post.py] {msg}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sessionid', required=True)
    parser.add_argument('--csrftoken', required=True)
    parser.add_argument('--ds_user_id', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--proxy', default=None)
    parser.add_argument('--link_url', default=None)
    parser.add_argument('--link_x', type=float, default=0.5)
    parser.add_argument('--link_y', type=float, default=0.5)
    parser.add_argument('--link_width', type=float, default=0.3)
    parser.add_argument('--link_height', type=float, default=0.1)
    parser.add_argument('--ua', default=None)
    parser.add_argument('--mid', default=None)
    parser.add_argument('--ig_did', default=None)
    parser.add_argument('--rur', default=None)
    args = parser.parse_args()

    ua = IG_APP_UA
    log(f"ds_user_id={args.ds_user_id} proxy={args.proxy or 'None'}")
    log(f"image={args.image}")
    log(f"UA={ua[:60]}...")

    try:
        from instagrapi import Client
        from instagrapi.types import StoryLink

        cl = Client()

        if args.proxy:
            cl.set_proxy(args.proxy)

        # set_settings でデバイス情報 + 認証データを設定
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
        # _user_id が必要な場合もある
        try:
            cl._user_id = args.ds_user_id
        except (AttributeError, TypeError):
            pass

        log(f"session ready (no login_by_sessionid)")

        # 画像確認
        if not os.path.exists(args.image):
            print(json.dumps({"success": False, "error": f"Image not found: {args.image}"}))
            sys.exit(1)

        # リンクスタンプ
        links = []
        if args.link_url:
            log(f"link: url={args.link_url} x={args.link_x} y={args.link_y} w={args.link_width} h={args.link_height}")
            links.append(StoryLink(
                webUri=args.link_url,
                x=args.link_x,
                y=args.link_y,
                width=args.link_width,
                height=args.link_height,
                rotation=0.0,
            ))

        # ストーリー投稿
        log("uploading story...")
        if links:
            media = cl.photo_upload_to_story(args.image, links=links)
        else:
            media = cl.photo_upload_to_story(args.image)

        media_id = str(media.id) if media and hasattr(media, 'id') else None
        log(f"success! media_id={media_id}")
        print(json.dumps({"success": True, "media_id": media_id}))

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

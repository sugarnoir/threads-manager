#!/usr/bin/env python3
"""
Instagram リール投稿スクリプト（instagrapi 使用）
story_post.py と同一の認証フロー + clip_upload() で投稿。
"""

import sys
import json
import argparse
import os
import uuid


IG_APP_UA = (
    "Instagram 355.0.0.24.108 iPhone16,2 "
    "(iPhone 16 Pro Max; iOS 18_4; ja_JP; ja; "
    "scale=3.00; 1320x2868; 620931905)"
)


def log(msg):
    print(f"[reel_post.py] {msg}", file=sys.stderr)


def resolve(val, fallback_fn, name):
    if val and val.strip():
        log(f"Using persisted {name}: {val}")
        return val.strip()
    fallback = fallback_fn()
    log(f"WARNING: {name} not provided, using random: {fallback}")
    return fallback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sessionid', required=True)
    parser.add_argument('--csrftoken', required=True)
    parser.add_argument('--ds_user_id', required=True)
    parser.add_argument('--video', required=True)
    parser.add_argument('--caption', default='')
    parser.add_argument('--thumbnail', default=None)
    parser.add_argument('--proxy', default=None)
    parser.add_argument('--ua', default=None)
    parser.add_argument('--mid', default=None)
    parser.add_argument('--ig_did', default=None)
    parser.add_argument('--rur', default=None)
    parser.add_argument('--device_id', default=None)
    parser.add_argument('--device_uuid', default=None)
    parser.add_argument('--phone_id', default=None)
    parser.add_argument('--adid', default=None)
    args = parser.parse_args()

    ua = args.ua if args.ua and args.ua.strip() else IG_APP_UA
    log(f"ds_user_id={args.ds_user_id} proxy={args.proxy or 'None'}")
    log(f"video={args.video}")
    log(f"caption={args.caption[:60]}...")
    log(f"UA={ua[:60]}...")

    try:
        from instagrapi import Client

        cl = Client()

        if args.proxy:
            cl.set_proxy(args.proxy)

        device_id = resolve(
            args.device_id,
            lambda: "android-" + args.ds_user_id[:16],
            "device_id"
        )
        device_uuid = resolve(
            args.device_uuid,
            lambda: str(uuid.uuid4()),
            "device_uuid"
        )
        phone_id_val = resolve(
            args.phone_id,
            lambda: str(uuid.uuid4()),
            "phone_id"
        )
        adid_val = resolve(
            args.adid,
            lambda: str(uuid.uuid4()),
            "adid"
        )

        settings = {
            "uuids": {
                "phone_id": phone_id_val,
                "uuid": device_uuid,
                "client_session_id": str(uuid.uuid4()),
                "advertising_id": adid_val,
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

        try:
            cl.user_id = int(args.ds_user_id)
        except (AttributeError, TypeError):
            pass
        try:
            cl._user_id = args.ds_user_id
        except (AttributeError, TypeError):
            pass

        log("session ready (no login_by_sessionid)")

        if not os.path.exists(args.video):
            print(json.dumps({"success": False, "error": f"Video not found: {args.video}"}))
            sys.exit(1)

        thumbnail = args.thumbnail
        if thumbnail and not os.path.exists(thumbnail):
            log(f"WARNING: thumbnail not found: {thumbnail}, using auto-generate")
            thumbnail = None

        log("uploading reel...")
        media = cl.clip_upload(
            path=args.video,
            caption=args.caption,
            thumbnail=thumbnail,
            configure_timeout=10,
        )

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

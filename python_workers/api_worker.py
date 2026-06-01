#!/usr/bin/env python3
"""
TLS フィンガープリント偽装 API ワーカー

Electron ↔ Python の IPC を stdin/stdout JSON lines で実現。
Phase 1A: ping/pong IPC
Phase 1B: tls-client による TLS fingerprint 偽装検証

起動: python3 python_workers/api_worker.py
終了: stdin EOF or shutdown コマンド
"""

import json
import os
import sys
import time


def main():
    send({"status": "ready", "pid": os.getpid()})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            send({"error": "invalid JSON"})
            continue

        action = request.get("action", "")
        response = handle_request(action, request)
        send(response)

        if action == "shutdown":
            break

    send({"status": "shutdown"})


def handle_request(action, request):
    """リクエストをディスパッチ"""

    if action == "ping":
        return {
            "pong": True,
            "timestamp": time.time(),
            "python_version": sys.version,
            "phase": "1B",
        }

    if action == "shutdown":
        return {"ok": True, "message": "shutting down"}

    if action == "tls_profiles":
        return {
            "profiles": [
                "chrome_120",
                "chrome_124",
                "safari_ios_16_0",
                "safari_ios_17_2_1",
                "firefox_117",
                "firefox_120",
                "okhttp4_android_13",
            ],
        }

    if action == "tls_check":
        return action_tls_check(request)

    if action == "tls_compare":
        return action_tls_compare(request)

    if action == "post_threads_text":
        return action_post_threads_text(request)

    return {"error": "unknown action: " + action}


def action_tls_check(req):
    """指定プロファイルで tls.peet.ws にアクセスし JA3/JA4 を取得"""
    try:
        import tls_client

        profile = req.get("profile", "safari_ios_16_0")
        proxy = req.get("proxy")

        session = tls_client.Session(
            client_identifier=profile,
            random_tls_extension_order=True,
        )

        if proxy:
            session.proxies = {"http": proxy, "https": proxy}

        t0 = time.time()
        resp = session.get("https://tls.peet.ws/api/all", timeout_seconds=15)
        elapsed_ms = int((time.time() - t0) * 1000)
        data = resp.json()

        tls_info = data.get("tls", {})
        http2_info = data.get("http2", {})

        return {
            "profile": profile,
            "ja3": tls_info.get("ja3", "")[:80],
            "ja3_hash": tls_info.get("ja3_hash", ""),
            "ja4": tls_info.get("ja4", ""),
            "akamai_hash": http2_info.get("akamai_fingerprint_hash", ""),
            "http_version": data.get("http_version", ""),
            "elapsed_ms": elapsed_ms,
        }
    except Exception as e:
        return {"error": str(e)[:300], "profile": req.get("profile", "?")}


def action_tls_compare(req):
    """複数プロファイルで JA3 を比較"""
    profiles = req.get("profiles") or [
        "safari_ios_16_0",
        "chrome_120",
        "firefox_117",
        "okhttp4_android_13",
        "chrome_117",
    ]
    proxy = req.get("proxy")
    results = []
    for p in profiles:
        r = action_tls_check({"profile": p, "proxy": proxy})
        results.append(r)
        time.sleep(0.5)  # rate limit 対策

    # ユニーク判定
    hashes = [r.get("ja3_hash", "") for r in results if r.get("ja3_hash")]
    unique = len(set(hashes))

    return {
        "results": results,
        "unique_ja3_count": unique,
        "total": len(results),
        "all_unique": unique == len(results),
    }


def action_post_threads_text(req):
    """tls-client 経由で Threads にテキスト投稿"""
    try:
        import tls_client
        import uuid
        import urllib.parse

        profile = req.get("tls_profile", "safari_ios_16_0")
        cookies = req.get("cookies", [])
        csrf_token = req.get("csrf_token", "")
        user_agent = req.get("user_agent", "")
        proxy = req.get("proxy")
        content = req.get("content", "")
        topic = req.get("topic")
        app_id = req.get("app_id", "238260118697367")

        if not content:
            return {"error": "content is empty"}
        if not csrf_token:
            return {"error": "csrf_token is required"}

        session = tls_client.Session(
            client_identifier=profile,
            random_tls_extension_order=True,
        )

        if proxy:
            session.proxies = {"http": proxy, "https": proxy}

        # Cookie 注入
        for c in cookies:
            session.cookies.set(
                c["name"],
                c["value"],
                domain=c.get("domain", ".threads.com"),
                path=c.get("path", "/"),
            )

        # リクエストボディ (TM の restPostTextViaNet と同一構造)
        self_id = str(uuid.uuid4())
        upload_id = str(int(time.time() * 1000))

        app_info = json.dumps({
            "community_flair_id": None,
            "entry_point": "main_tab_bar",
            "excluded_inline_media_ids": "[]",
            "fediverse_composer_enabled": True,
            "is_reply_approval_enabled": False,
            "is_spoiler_media": False,
            "link_attachment_url": None,
            "reply_control": 0,
            "reply_id": None,
            "self_thread_context_id": self_id,
            "snippet_attachment": None,
            "special_effects_enabled_str": None,
            "tag_header": {"display_text": topic} if topic else None,
            "text_with_entities": {"entities": [], "text": content},
        })

        body = urllib.parse.urlencode({
            "audience": "default",
            "barcelona_source_reply_id": "",
            "caption": content,
            "creator_geo_gating_info": json.dumps({"whitelist_country_codes": []}),
            "cross_share_info": "",
            "custom_accessibility_caption": "",
            "gen_ai_detection_method": "",
            "internal_features": "",
            "is_meta_only_post": "",
            "is_paid_partnership": "",
            "is_upload_type_override_allowed": "1",
            "music_params": "",
            "publish_mode": "text_post",
            "should_include_permalink": "true",
            "text_post_app_info": app_info,
            "upload_id": upload_id,
        })

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "x-csrftoken": csrf_token,
            "x-ig-app-id": app_id,
            "x-asbd-id": "129477",
            "Origin": "https://www.threads.com",
            "Referer": "https://www.threads.com/",
            "User-Agent": user_agent,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        }

        t0 = time.time()
        resp = session.post(
            "https://www.threads.com/api/v1/media/configure_text_only_post/",
            headers=headers,
            data=body,
            timeout_seconds=30,
        )
        elapsed_ms = int((time.time() - t0) * 1000)

        resp_body = resp.text[:1000]
        result = {
            "status": resp.status_code,
            "body": resp_body,
            "elapsed_ms": elapsed_ms,
            "profile": profile,
        }

        # 危険レスポンス警告
        lower = resp_body.lower()
        if "checkpoint" in lower or "challenge" in lower:
            result["warning"] = "checkpoint/challenge detected"
        if "feedback_required" in lower:
            result["warning"] = "feedback_required detected"

        try:
            result["parsed"] = resp.json()
        except Exception:
            pass

        return result

    except Exception as e:
        return {"error": str(e)[:500], "profile": req.get("tls_profile", "?")}


def send(obj):
    """1行 JSON を stdout に書き出す"""
    print(json.dumps(obj), flush=True)


if __name__ == "__main__":
    main()

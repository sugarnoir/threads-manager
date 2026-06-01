#!/usr/bin/env python3
"""
TLS フィンガープリント偽装 API ワーカー (Phase 1A: ping/pong のみ)

Electron ↔ Python の IPC を stdin/stdout JSON lines で実現。
1行 = 1 JSON メッセージ。native module 不要で確実。

Phase 1B で tls-client を組み込んで実通信を追加する。

起動: python3 python_workers/api_worker.py
終了: stdin EOF or shutdown コマンド
"""

import json
import os
import sys
import time


def main():
    # ready シグナル
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
            "phase": "1A",
        }

    if action == "shutdown":
        return {"ok": True, "message": "shutting down"}

    if action == "tls_profiles":
        # Phase 1B で実装: 利用可能な TLS プロファイル一覧
        return {
            "profiles": [
                "chrome_120",
                "chrome_124",
                "safari_ios_17_4_1",
                "firefox_120",
                "okhttp4_android_14",
            ],
            "note": "Phase 1A: profiles listed but not yet active",
        }

    return {"error": f"unknown action: {action}"}


def send(obj):
    """1行 JSON を stdout に書き出す"""
    print(json.dumps(obj), flush=True)


if __name__ == "__main__":
    main()

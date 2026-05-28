#!/usr/bin/env python3
"""
IAM-API 垢の生存チェック (instagrapi set_settings → account_info)
login() は絶対呼ばない。

使い方:
  python3 iam_alive_check.py <session_json> <proxy_url>

出力 (JSON):
  {"alive": true, "username": "xxx", "pk": "123"}
  {"alive": false, "error": "login_required"}
"""

import sys
import json

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"alive": False, "error": "usage: iam_alive_check.py <session_json> <proxy_url>"}))
        sys.exit(1)

    session_json = sys.argv[1]
    proxy_url = sys.argv[2]

    try:
        from instagrapi import Client
        session = json.loads(session_json)

        cl = Client()
        cl.set_proxy(proxy_url)
        cl.set_settings(session)

        info = cl.account_info()
        username = getattr(info, 'username', None) or getattr(info, 'full_name', '???')
        pk = getattr(info, 'pk', None) or ''

        print(json.dumps({"alive": True, "username": str(username), "pk": str(pk)}))
    except Exception as e:
        err = str(e)
        result = {"alive": False, "error": err[:500]}
        if "challenge" in err.lower() or "checkpoint" in err.lower():
            result["reason"] = "challenge"
        elif "login_required" in err.lower():
            result["reason"] = "login_required"
        elif "feedback" in err.lower():
            result["reason"] = "feedback_required"
        print(json.dumps(result))

if __name__ == "__main__":
    main()

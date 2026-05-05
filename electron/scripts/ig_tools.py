#!/usr/bin/env python3
"""
ig_tools — Instagram 操作の統合エントリポイント

PyInstaller でバイナリ化し、配布版TMにバンドルする。
配布先に Python/pip 不要で動作する。

使用方法:
  ig_tools story  --sessionid ... --image ...
  ig_tools reel   --sessionid ... --video ...
  ig_tools rename --sessionid ... --new_name ...

ビルド:
  pip install -r requirements.txt pyinstaller
  pyinstaller --onefile --name ig_tools ig_tools.py
"""

import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: ig_tools <command> [args...]", file=sys.stderr)
        print("Commands: story, reel, rename", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    # コマンド引数を除去して各サブモジュールに渡す
    sys.argv = [sys.argv[0]] + sys.argv[2:]

    if command == 'story':
        from story_post import main as story_main
        story_main()
    elif command == 'reel':
        from reel_post import main as reel_main
        reel_main()
    elif command == 'rename':
        from change_name_api import main as rename_main
        rename_main()
    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        print("Commands: story, reel, rename", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

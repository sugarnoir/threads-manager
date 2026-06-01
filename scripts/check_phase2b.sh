#!/bin/bash
DB="$HOME/Library/Application Support/threads-manager/threads-manager.db"

echo "========================================"
echo "  Phase 2B 状態確認"
echo "========================================"

echo ""
echo "-- use_tls_client 有効化垢 --"
sqlite3 "$DB" -header -column "
  SELECT id, username, tls_profile, use_tls_client, status
  FROM accounts WHERE use_tls_client = 1;
"

echo ""
echo "-- addisonwhite2353 詳細 --"
sqlite3 "$DB" -header -column "
  SELECT id, username, tls_profile, use_tls_client,
         use_threads_mobile_api, status
  FROM accounts WHERE username = 'addisonwhite2353';
"

echo ""
echo "-- 直近 24h の投稿 (account=1289) --"
sqlite3 "$DB" -header -column "
  SELECT id, status, substr(content,1,40) as content, posted_at
  FROM posts
  WHERE account_id = 1289
    AND created_at > datetime('now', '-1 day')
  ORDER BY created_at DESC LIMIT 10;
"

#!/bin/bash
DB="$HOME/Library/Application Support/threads-manager/threads-manager.db"

echo "========================================"
echo "  Phase 2A 完了確認"
echo "========================================"

echo ""
echo "-- カラム存在確認 --"
sqlite3 "$DB" "PRAGMA table_info(accounts);" | grep -E "tls_profile|use_tls_client"

echo ""
echo "-- プロファイル別件数 --"
sqlite3 "$DB" -header -column \
  "SELECT tls_profile, COUNT(*) as count FROM accounts GROUP BY tls_profile ORDER BY count DESC;"

echo ""
echo "-- use_tls_client 状況 --"
sqlite3 "$DB" -header -column \
  "SELECT use_tls_client, COUNT(*) as count FROM accounts GROUP BY use_tls_client;"

echo ""
echo "-- 未割当の垢 --"
CNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM accounts WHERE tls_profile IS NULL;")
echo "  tls_profile IS NULL: ${CNT} 垢"

echo ""
echo "-- 総垢数 --"
sqlite3 "$DB" "SELECT COUNT(*) || ' 垢' FROM accounts;"

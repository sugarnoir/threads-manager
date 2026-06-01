# Phase 2: TLS Client 移行ステータス

## チェックリスト

- [x] 2A: TLS プロファイル DB 基盤 + 全垢割当
- [x] 2B: Path 1 の Python tls-client ルート追加
- [ ] 2C: Cookie 双方向同期
- [ ] 2D: 画像投稿対応
- [ ] 2E: UA/TLS 整合性チェック
- [ ] 2F: テスト + 段階展開

## TLS プロファイル割当確認

```sql
-- プロファイル別の垢数
SELECT tls_profile, COUNT(*) as count FROM accounts GROUP BY tls_profile ORDER BY count DESC;

-- 未割当の垢
SELECT id, username, user_agent FROM accounts WHERE tls_profile IS NULL;

-- use_tls_client 状況
SELECT use_tls_client, COUNT(*) as count FROM accounts GROUP BY use_tls_client;
```

## フラグ運用

```sql
-- 1垢で tls-client 有効化
UPDATE accounts SET use_tls_client = 1 WHERE id = <ACCOUNT_ID>;

-- グループ有効化
UPDATE accounts SET use_tls_client = 1 WHERE group_name = 'test-group';

-- 全垢有効化
UPDATE accounts SET use_tls_client = 1;

-- ロールバック
UPDATE accounts SET use_tls_client = 0;

-- プロファイル手動変更
UPDATE accounts SET tls_profile = 'chrome_120' WHERE id = <ACCOUNT_ID>;
```

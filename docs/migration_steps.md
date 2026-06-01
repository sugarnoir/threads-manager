# Threads Mobile API Migration Steps

## フラグ運用

### 1垢だけ有効化 (テスト)
```sql
UPDATE accounts SET use_threads_mobile_api = 1 WHERE id = <ACCOUNT_ID>;
```

### 5垢有効化
```sql
UPDATE accounts SET use_threads_mobile_api = 1 WHERE id IN (1, 2, 3, 4, 5);
```

### グループ単位で有効化
```sql
UPDATE accounts SET use_threads_mobile_api = 1 WHERE group_name = 'test-group';
```

### 全垢有効化
```sql
UPDATE accounts SET use_threads_mobile_api = 1;
```

### ロールバック (全垢を従来に戻す)
```sql
UPDATE accounts SET use_threads_mobile_api = 0;
```

### 確認
```sql
SELECT id, username, use_threads_mobile_api FROM accounts WHERE use_threads_mobile_api = 1;
```

## 変更内容

| 項目 | use_threads_mobile_api = 0 (従来) | use_threads_mobile_api = 1 (新) |
|---|---|---|
| X-IG-App-ID | 238260118697367 (Web) | 3419628305025917 (Threads Android) |
| User-Agent | iPhone Safari / Instagram iOS | Barcelona Android/iOS |
| ホスト | i.instagram.com | i.instagram.com (同じ) |
| エンドポイント | /api/v1/media/configure_text_only_post/ | 同じ |
| Web Path (1/2/3) | 変更なし | 変更なし |

## テスト手順

1. 1垢で有効化: `UPDATE accounts SET use_threads_mobile_api = 1 WHERE id = X;`
2. TM 再起動
3. その垢でテキスト投稿を実行
4. ログで `[mobilePostText] appId=3419628305025917 barcelona=true` を確認
5. 投稿が成功したら段階的に拡大
6. 問題があれば `UPDATE accounts SET use_threads_mobile_api = 0 WHERE id = X;` でロールバック

# Threads Mobile API Migration Steps

## フラグの意味

`use_threads_mobile_api = 1` の垢は **Path 0 (i.instagram.com Mobile API) をスキップ**し、
直接 Path 1 (threads.com REST via WebContentsView) から投稿を開始する。

背景: Path 0 は 403 login_required を返すケースがあり、失敗→フォールバックの
リトライパターンが検知シグナルになり得るため。

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
| Path 0 (Mobile API) | 実行する | **スキップ** |
| Path 1 (REST via View) | Path 0 失敗時のフォールバック | **最初に実行** |
| Path 2/3 | 変更なし | 変更なし |

## テスト手順

1. 1垢で有効化: `UPDATE accounts SET use_threads_mobile_api = 1 WHERE id = X;`
2. TM 再起動
3. 自動投稿タブ → API(非公式) で投稿実行
4. ログで `[SKIP Path 0] account=X threadsMobileApi=true` を確認
5. Path 1 で投稿成功を確認
6. 問題があれば `UPDATE accounts SET use_threads_mobile_api = 0 WHERE id = X;` でロールバック

## Historical: 旧仕様 (v1)

当初は `use_threads_mobile_api = 1` で Path 0 の App ID を Threads Android (`3419628305025917`) +
Barcelona UA に切り替える仕様だったが、i.instagram.com が 403 login_required を返すため、
Path 0 スキップ方式に変更した (2026-06-01)。

Barcelona UA / Threads App ID のコードは `electron/config/threads-api.ts` に温存している。
将来 b.i.instagram.com 等の別ルートが確立したら再利用可能。

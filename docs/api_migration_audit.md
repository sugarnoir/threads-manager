# API Migration Audit: i.instagram.com → b.i.instagram.com

## Phase 1 調査結果

### 1. 現状の API 投稿コード一覧

#### 定数定義

| ファイル | 行 | 定数名 | 値 | 用途 |
|---|---|---|---|---|
| threads-web-api.ts | 66 | `THREADS_URL` | `https://www.threads.com` | Web API (Path 1/2/3) |
| threads-web-api.ts | 67 | `IG_APP_ID` | `238260118697367` | Web 用 App ID |
| threads-web-api.ts | 852 | `IG_MOBILE_URL` | `https://i.instagram.com` | **Mobile API (Path 0)** ← 修正対象 |
| threads-web-api.ts | 853 | `IG_MOBILE_APP_ID` | `238260118697367` | **Mobile App ID** ← 修正対象 |
| threads-engage-api.ts | 18 | `IG_APP_ID` | `936619743392459` | Instagram App ID (engage) |
| threads-engage-api.ts | 293-294 | `THREADS_URL_BASE`/`THREADS_APP_ID` | `threads.com`/`238260118697367` | Engage Web |

#### Mobile API エンドポイント (Path 0) — 修正対象

| 関数 | 行 | エンドポイント | 備考 |
|---|---|---|---|
| `mobilePostText` | 1154 | `i.instagram.com/api/v1/media/configure_text_only_post/` | テキスト投稿 |
| `mobilePostWithMedia` (upload) | 1219 | `threads.com/rupload_igphoto/fb_uploader_{id}` | 画像アップロード (threads.com経由) |
| `mobilePostWithMedia` (1枚) | 1277 | `threads.com/api/v1/media/configure_text_post_app_feed/` | 画像configure (threads.com経由) |
| `mobilePostWithMedia` (複数) | 1298 | `threads.com/api/v1/media/configure_text_post_app_sidecar/` | sidecar configure (threads.com経由) |

#### Mobile API ヘッダー (Path 0)

```
Cookie:       [instagram.com sessionid cookies]
X-CSRFToken:  [csrfToken]
X-IG-App-ID:  238260118697367  ← 修正対象
User-Agent:   [getUA(accountId)]  ← 修正対象
Content-Type: application/x-www-form-urlencoded
Origin:       https://www.instagram.com  ← 修正対象
Referer:      https://www.instagram.com/  ← 修正対象
```

#### Web API エンドポイント (Path 1/2/3) — 変更なし

| パス | エンドポイント | 備考 |
|---|---|---|
| Path 1 (WebContentsView) | `threads.com/api/v1/media/configure_text_only_post/` | same-origin fetch |
| Path 2 (net.request) | `threads.com/api/v1/media/configure_text_only_post/` | Electron net |
| Path 3 (GraphQL) | `threads.com/api/graphql` | doc_id mutation |

#### X-IG-App-ID 全使用箇所

| ファイル | 行 | 値 | コンテキスト |
|---|---|---|---|
| threads-web-api.ts | 336, 396, 502, 536, 704, 806 | `238260118697367` | Web API (IG_APP_ID) |
| threads-web-api.ts | 1158, 1192, 1228, 1324, 1488, 1920, 1985 | `238260118697367` | Mobile API (IG_MOBILE_APP_ID) |
| threads-web-api.ts | 973 | `936619743392459` | Instagram Direct |
| threads-engage-api.ts | 42, 98, 111, 124, 241 | `936619743392459` | Engage (IG) |
| threads-engage-api.ts | 336, 466 | `238260118697367` | Engage (Threads Web) |
| view-manager.ts | 142, 172 | `238260118697367` | WebView IG requests |
| view-manager.ts | 207 | `936619743392459` | WebView IG requests |
| view-manager.ts | 3112 | `238260118697367` | WebView REST API |

---

### 2. 参考実装の調査結果

#### junhoyeo/threads-api (TypeScript, 最大手OSSライブラリ)

| 項目 | 値 |
|---|---|
| BASE_API_URL | `https://i.instagram.com` |
| IG_APP_ID | **`3419628305025917`** (Threads Androidアプリ固有) |
| テキスト投稿 | `/api/v1/media/configure_text_only_post/` |
| 画像投稿 | `/api/v1/media/configure_text_post_app_feed/` |
| sidecar | `/api/v1/media/configure_text_post_app_sidecar/` |
| Bloks Version | `5f56efad68e1edec7801f630b5c122704ec5378adbee6609a448f105f34a9c73` |
| Signature Key | `9193488027538fd3450b83b7d05286d4ca9599a0f7eeed90d8c85925698a05dc` |

#### subzeroid/instagrapi (Python, Instagram Private API)

| 項目 | 値 |
|---|---|
| API_DOMAIN | `i.instagram.com` |
| app_version | `428.0.0.47.67` |
| Bloks Version | `7189b949425f9bf80ea8bd880cf5a3080b292d9b1c4b38a18d112f7c4b71e7a8` |
| UA Template | `Instagram {app_version} Android (...)` |
| text_feed_app | **存在しない** (media/ パスのまま) |

#### subzeroid/aiograpi (Python, async版)

| 項目 | 値 |
|---|---|
| API_DOMAIN | `i.instagram.com` |
| 構成 | instagrapi と同一 |

#### b.i.instagram.com について

- **どのOSSライブラリでも使用されていない**
- GitHub Code Search で `b.i.instagram.com configure_text` → 結果 0 件
- `b.i.instagram.com` は CDN/バックエンド用のサブドメインで、公開APIとしては未確認

---

### 3. 正しいエンドポイント構成 (調査結果に基づく)

#### App ID の違い

| ID | 用途 | 出典 |
|---|---|---|
| `238260118697367` | Threads **Web** (ブラウザ) | TM 現行、threads.com HTML |
| `3419628305025917` | Threads **Android アプリ** (Barcelona) | junhoyeo/threads-api |
| `936619743392459` | **Instagram** アプリ | TM 現行、instagrapi |

#### 推奨構成

```typescript
const THREADS_API = {
  mobile: {
    host: 'https://i.instagram.com',  // b.i ではなく i. が正解
    endpoints: {
      configure_text_only: '/api/v1/media/configure_text_only_post/',
      configure_text_with_image: '/api/v1/media/configure_text_post_app_feed/',
      configure_sidecar: '/api/v1/media/configure_text_post_app_sidecar/',
      rupload: '/rupload_igphoto/fb_uploader_{upload_id}',
    },
    app_id: '3419628305025917',  // Threads Android App ID ← 現行と異なる
    ua_template: 'Barcelona {version} Android (...)',
  },
  web: {
    host: 'https://www.threads.com',
    endpoints: {
      graphql: '/api/graphql',
      configure_text_only: '/api/v1/media/configure_text_only_post/',
    },
    app_id: '238260118697367',  // Web 用は維持
  },
};
```

---

### 4. 修正対象の特定

#### 確実に修正すべき箇所

| # | ファイル | 行 | 現行値 | 修正後 | 理由 |
|---|---|---|---|---|---|
| 1 | threads-web-api.ts | 853 | `IG_MOBILE_APP_ID = '238260118697367'` | `'3419628305025917'` | Threads Android アプリの正規 ID |
| 2 | threads-web-api.ts | 854-855 | `getIgMobileUA(): generateMobileUA()` | Barcelona UA | Threads 専用 UA |
| 3 | threads-web-api.ts | 1161-1162 | `Origin: instagram.com` / `Referer: instagram.com/` | 検討必要 | Mobile API は Origin 不要の可能性 |

#### 修正不要 (Path 1/2/3 は Web 経由で正常動作中)

- `IG_APP_ID = '238260118697367'` (threads-web-api.ts:67)
- Web API エンドポイント全般
- view-manager.ts の WebContentsView 内 fetch

#### b.i.instagram.com について

**結論: 使わない。**

根拠:
- 主要 OSS (instagrapi, aiograpi, junhoyeo/threads-api) は全て `i.instagram.com` を使用
- GitHub 全体で `b.i.instagram.com` + Threads 投稿の実装例が見つからない
- `b.` プレフィックスは CDN バックエンド用で、クライアント API としての安定性が未確認
- リスクとリターンが見合わない

---

### 5. 推奨アクション

#### Phase 2 で実装すべきこと

1. **App ID 切り替え**: `238260118697367` → `3419628305025917` (Mobile Path 0 のみ)
2. **UA 切り替え**: Barcelona Android UA に変更
3. **use_threads_mobile_api フラグ**: 垢単位でロールバック可能に
4. **エンドポイント URL は変更なし**: `i.instagram.com/api/v1/media/...` のまま

#### Phase 2 で実装しないこと

- `b.i.instagram.com` への切り替え (根拠不足)
- `text_feed_app/` パスへの変更 (OSS 実装に存在しない)
- Web API (Path 1/2/3) の変更

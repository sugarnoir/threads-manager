# Changelog

## v1.1.7 (2026-05-05)

### 配布版対応
- ストーリー投稿の Python 依存問題を解消
  - Python (instagrapi) を PyInstaller でアプリに内蔵化
  - ユーザーの Mac に Python インストール不要で動作
- リール投稿、名前変更も同様にバイナリ化
- ig_tools 統合バイナリ: story / reel / rename を1つのバイナリに統合

### 改善
- ストーリー投稿が完全に裏で動くように (headless 化)
- リンクスタンプの全画面/部分リンク経路を明確化
  - 全画面リンク: Playwright (高速、配布版OK)
  - 部分リンク: ig_tools バイナリ (座標精度OK)
- Playwright コンテキストプールのアイドル管理 (30分未使用で自動close)
- プール状態ログを60秒ごとに出力

### バグ修正
- 投稿停止問題の対策 (scheduleThread の setTimeout リーク修正)
- Promise.race で clearTimeout を確実に実行するよう修正
- bulk-import にプロキシ自動割り当て機能を追加

### CI/CD
- GitHub Actions に PyInstaller ビルドステップ追加 (Mac/Win)

## v1.1.6

- fix: プロキシ認証エラー(ERR_NO_SUPPORTED_PROXIES)を修正
  - setProxy の proxyRules から user:pass@ 形式のURL埋め込みを廃止
  - net.request の login イベントによる Basic 認証に統一
  - 影響箇所: checkIp / getSessionInfo / ensureAccountProxy
- fix: autopost の投稿が posts テーブルに記録されないバグを修正
  - executeAutopost() の stock / random / rewrite 全モードで createPost() + updatePostStatus() を追加
- fix: 設定画面のプロキシ管理セクションをトップに移動

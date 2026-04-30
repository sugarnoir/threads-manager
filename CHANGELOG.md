# Changelog

## v1.1.6

- fix: プロキシ認証エラー(ERR_NO_SUPPORTED_PROXIES)を修正
  - setProxy の proxyRules から user:pass@ 形式のURL埋め込みを廃止
  - net.request の login イベントによる Basic 認証に統一
  - 影響箇所: checkIp / getSessionInfo / ensureAccountProxy
- fix: autopost の投稿が posts テーブルに記録されないバグを修正
  - executeAutopost() の stock / random / rewrite 全モードで createPost() + updatePostStatus() を追加
- fix: 設定画面のプロキシ管理セクションをトップに移動

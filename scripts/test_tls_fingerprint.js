// DevTools Console 用: TLS フィンガープリント偽装テスト
// TM の DevTools (Cmd+Shift+I) → Console に貼り付けて Enter

(async () => {
  console.log('=== TLS Fingerprint Comparison Test ===');
  console.log('5 tls-client profiles + Electron Chromium を比較...');
  console.log('');

  // 1. Python tls-client 5プロファイル
  console.log('[1/2] Python tls-client プロファイル取得中...');
  const compare = await window.electronAPI.python.tlsCompare();
  if (compare.error) {
    console.error('❌ tls_compare failed:', compare.error);
    return;
  }

  // 2. Electron 自身の TLS
  console.log('[2/2] Electron Chromium TLS 取得中...');
  const electron = await window.electronAPI.electronTls.check();

  // 結果テーブル
  const rows = compare.results.map(r => ({
    profile: r.profile,
    ja3_hash: r.ja3_hash || 'ERROR',
    ja4: r.ja4 || '',
    ms: r.elapsed_ms || '?',
  }));
  rows.push({
    profile: '** electron_chromium **',
    ja3_hash: electron.ja3_hash || 'ERROR',
    ja4: electron.ja4 || '',
    ms: '-',
  });

  console.table(rows);

  // ユニーク判定
  const allHashes = rows.map(r => r.ja3_hash).filter(h => h && h !== 'ERROR');
  const unique = new Set(allHashes).size;
  const total = allHashes.length;

  console.log('');
  console.log(`JA3 ユニーク数: ${unique}/${total}`);
  console.log(unique === total ? '✅ 全プロファイルの JA3 が異なる — 偽装成功！' : '⚠️ 一部重複あり');
  console.log('=== Test Complete ===');
})();

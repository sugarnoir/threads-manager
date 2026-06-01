// DevTools Console 用: tls-client 経由 Threads 投稿テスト
// addisonwhite2353 (id=1289) でテスト

(async () => {
  console.log('=== tls-client 経由 Threads 投稿テスト ===');
  console.log('Account: addisonwhite2353 (id=1289)');
  console.log('Profile: safari_ios_16_0');
  console.log('');

  const r = await window.electronAPI.python.testPost(1289);
  console.log('結果:', JSON.stringify(r, null, 2));

  if (r.warning) {
    console.warn('⚠️ 警告:', r.warning);
  }

  if (r.status === 200) {
    const parsed = r.parsed || {};
    if (parsed.status === 'ok' || parsed.media_id || parsed.media) {
      console.log('✅ tls-client 投稿成功！');
    } else {
      console.log('⚠️ HTTP 200 だがレスポンスが想定外:', parsed.status || '?');
    }
  } else if (r.error) {
    console.log('❌ エラー:', r.error);
  } else {
    console.log('❌ HTTP', r.status, ':', (r.body || '').slice(0, 200));
  }

  console.log('');
  console.log('Profile:', r.profile, '/ Elapsed:', r.elapsed_ms, 'ms');
  console.log('=== Test Complete ===');
})();

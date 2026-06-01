// DevTools Console 用: Python ブリッジ動作テスト
// TM の DevTools (Cmd+Shift+I) → Console に貼り付けて Enter

(async () => {
  console.log('=== Python Bridge Test ===');

  // 1. ステータス確認
  const status = await window.electronAPI.python.status();
  console.log('Status:', JSON.stringify(status));
  if (!status.ready) {
    console.log('❌ Python ワーカー未起動');
    return;
  }
  console.log('✅ Python ワーカー起動中');

  // 2. Ping
  const ping = await window.electronAPI.python.ping();
  console.log('Ping:', JSON.stringify(ping, null, 2));
  console.log(ping.pong ? '✅ Ping/Pong 成功' : '❌ Ping 失敗');

  // 3. TLS プロファイル一覧
  const profiles = await window.electronAPI.python.tlsProfiles();
  console.log('TLS Profiles:', JSON.stringify(profiles, null, 2));

  console.log('=== Test Complete ===');
})();

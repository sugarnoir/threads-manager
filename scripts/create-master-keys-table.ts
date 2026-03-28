/**
 * Supabase に master_keys テーブルを作成するマイグレーションスクリプト
 * 実行: npx tsx scripts/create-master-keys-table.ts
 */

import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'

const SUPABASE_PROJECT_REF = 'pywvrkghavvwdqvefqbh'
const SUPABASE_API_URL = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`

const SQL = `
-- master_keys テーブル作成
CREATE TABLE IF NOT EXISTS master_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  memo        text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);

-- RLS 有効化
ALTER TABLE master_keys ENABLE ROW LEVEL SECURITY;

-- anon ロールに SELECT を許可（予約投稿タブの認証チェック用）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'master_keys' AND policyname = 'allow anon select'
  ) THEN
    CREATE POLICY "allow anon select"
      ON master_keys FOR SELECT TO anon USING (true);
  END IF;
END $$;
`

// SQLite から service_role キーを取得
function getServiceKey(): string | null {
  const dbPath = path.join(
    os.homedir(),
    'Library', 'Application Support', 'threads-manager', 'threads-manager.db'
  )
  try {
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'supabase_service_key'`).get() as { value: string } | undefined
    db.close()
    return row?.value?.trim() || null
  } catch (e) {
    console.error('SQLite read error:', e)
    return null
  }
}

async function run() {
  console.log('='.repeat(60))
  console.log('master_keys テーブル作成スクリプト')
  console.log('='.repeat(60))
  console.log()

  const serviceKey = getServiceKey()
  if (!serviceKey) {
    console.error('❌ supabase_service_key が未設定です。')
    console.error('   設定画面 → ライセンス管理 → Service Role Key を設定してください。')
    console.log()
    console.log('手動実行用 SQL:')
    console.log('-'.repeat(60))
    console.log(SQL)
    return
  }

  console.log('✓ Service Role Key 取得')
  console.log(`  実行先: ${SUPABASE_API_URL}`)
  console.log()

  try {
    const res = await fetch(SUPABASE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: SQL }),
    })

    const text = await res.text()

    if (res.ok) {
      console.log('✅ テーブル作成成功!')
      console.log(`   HTTP ${res.status}`)
      if (text) console.log('   Response:', text.slice(0, 200))
    } else {
      console.error(`❌ API エラー: HTTP ${res.status}`)
      console.error('   Response:', text.slice(0, 500))
      console.log()

      // Management API が service_role key を受け付けない場合の代替手順
      if (res.status === 401 || res.status === 403) {
        console.log('ℹ️  Management API には Personal Access Token が必要です。')
        console.log('   以下の SQL を Supabase ダッシュボードの SQL Editor で実行してください:')
        console.log('   https://supabase.com/dashboard/project/' + SUPABASE_PROJECT_REF + '/sql/new')
      }
      console.log()
      console.log('手動実行用 SQL:')
      console.log('-'.repeat(60))
      console.log(SQL)
    }
  } catch (e) {
    console.error('❌ fetch エラー:', e)
    console.log()
    console.log('手動実行用 SQL:')
    console.log('-'.repeat(60))
    console.log(SQL)
  }
}

run()

import { useState, useEffect } from 'react'
import { api, Account, PostTemplate } from '../lib/ipc'

interface Props {
  accounts: Account[]
}

type Scope = 'global' | number  // 'global' = 全共通, number = account_id

export function Templates({ accounts }: Props) {
  const [templates, setTemplates] = useState<PostTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<{ scope: Scope; title: string; content: string }>({
    scope: 'global', title: '', content: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    try {
      api.templates.list(undefined)
        .then((res) => { if (res.success) setTemplates(res.data) })
        .catch(() => {})
        .finally(() => setLoading(false))
    } catch { setLoading(false) }
  }, [])

  const openNew = () => {
    setEditingId(null)
    setForm({ scope: 'global', title: '', content: '' })
    setError(null)
    setShowForm(true)
  }

  const openEdit = (t: PostTemplate) => {
    setEditingId(t.id)
    setForm({
      scope:   t.account_id === null ? 'global' : t.account_id,
      title:   t.title,
      content: t.content,
    })
    setError(null)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError('タイトルと本文は必須です')
      return
    }
    setSaving(true)
    setError(null)
    const accountId = form.scope === 'global' ? null : (form.scope as number)
    try {
      if (editingId === null) {
        const res = await api.templates.create({
          title:      form.title.trim(),
          content:    form.content.trim(),
          account_id: accountId,
        })
        if (res.success) {
          setTemplates((prev) => [...prev, res.data])
          setShowForm(false)
        } else {
          setError(res.error ?? '保存に失敗しました')
        }
      } else {
        const res = await api.templates.update({
          id:      editingId,
          title:   form.title.trim(),
          content: form.content.trim(),
        })
        if (res.success) {
          setTemplates((prev) => prev.map((t) => t.id === editingId ? res.data : t))
          setShowForm(false)
        } else {
          setError(res.error ?? '保存に失敗しました')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('このテンプレートを削除しますか？')) return
    try {
      const res = await api.templates.delete(id)
      if (res.success) setTemplates((prev) => prev.filter((t) => t.id !== id))
    } catch { /* ignore */ }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 py-8 text-center">読み込み中...</div>
  }

  const globalTemplates  = templates.filter((t) => t.account_id === null)
  const accountTemplates = accounts.map((a) => ({
    account:   a,
    templates: templates.filter((t) => t.account_id === a.id),
  })).filter((g) => g.templates.length > 0)

  const TemplateCard = ({ t }: { t: PostTemplate }) => (
    <div className="border border-gray-200 rounded-xl p-4 bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
          <p className="text-xs text-gray-500 mt-1 line-clamp-3 whitespace-pre-wrap">{t.content}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => openEdit(t)}
            className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            編集
          </button>
          <button
            onClick={() => handleDelete(t.id)}
            className="px-2.5 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">投稿テンプレート</h2>
        <button
          onClick={openNew}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 新規作成
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId === null ? 'テンプレートを追加' : 'テンプレートを編集'}
          </h3>

          {/* Scope selector (新規作成時のみ) */}
          {editingId === null && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">対象</label>
              <select
                value={form.scope === 'global' ? 'global' : String(form.scope)}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  scope: e.target.value === 'global' ? 'global' : Number(e.target.value),
                }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="global">全アカウント共通</option>
                {accounts.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    @{a.username}{a.display_name ? ` (${a.display_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">タイトル</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="例: 告知テンプレ、自己紹介..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">本文</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="テンプレートの本文..."
              rows={5}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-right text-xs text-gray-400 mt-1">{form.content.length} 文字</p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {templates.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
          <span className="text-4xl">📝</span>
          <p className="text-sm">テンプレートがありません</p>
          <button onClick={openNew} className="text-sm text-blue-600 hover:underline mt-1">
            最初のテンプレートを作成する
          </button>
        </div>
      )}

      {/* Global templates */}
      {globalTemplates.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            全アカウント共通
          </p>
          <div className="space-y-2">
            {globalTemplates.map((t) => <TemplateCard key={t.id} t={t} />)}
          </div>
        </div>
      )}

      {/* Per-account templates */}
      {accountTemplates.map(({ account, templates: ts }) => (
        <div key={account.id}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            @{account.username}
            {account.display_name && (
              <span className="ml-1 normal-case text-gray-400 font-normal">({account.display_name})</span>
            )}
          </p>
          <div className="space-y-2">
            {ts.map((t) => <TemplateCard key={t.id} t={t} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

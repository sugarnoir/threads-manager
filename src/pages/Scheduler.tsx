import { useState, useEffect } from 'react'
import { api, Schedule, Account } from '../lib/ipc'
import { StatusBadge } from '../components/StatusBadge'

interface Props {
  accounts: Account[]
}

export function Scheduler({ accounts }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [form, setForm] = useState({
    account_id: '',
    content: '',
    scheduled_at: '',
  })
  const [saving, setSaving] = useState(false)

  const fetchSchedules = async () => {
    const data = await api.schedules.list()
    setSchedules(data)
  }

  useEffect(() => {
    fetchSchedules()
    const unsub = api.on('scheduler:executed', fetchSchedules)
    return unsub
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.account_id || !form.content || !form.scheduled_at) return
    setSaving(true)
    await api.schedules.create({
      account_id: Number(form.account_id),
      content: form.content,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
    })
    setForm({ account_id: '', content: '', scheduled_at: '' })
    await fetchSchedules()
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('スケジュールを削除しますか？')) return
    await api.schedules.delete(id)
    setSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  const getAccountName = (id: number) =>
    accounts.find((a) => a.id === id)?.username ?? `ID:${id}`

  return (
    <div className="h-full flex flex-col gap-6">
      <h2 className="text-lg font-bold text-gray-800">スケジュール投稿</h2>

      {/* 新規スケジュール作成フォーム */}
      <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">新しいスケジュール</p>
        <select
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
        >
          <option value="">アカウントを選択</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username}
            </option>
          ))}
        </select>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="投稿内容..."
          rows={3}
          className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            className="flex-1 border border-gray-200 rounded-lg p-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving || !form.account_id || !form.content || !form.scheduled_at}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? '保存中...' : '予約'}
          </button>
        </div>
      </form>

      {/* スケジュール一覧 */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {schedules.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-8">スケジュールがありません</p>
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    @{getAccountName(schedule.account_id)}
                  </span>
                  <StatusBadge status={schedule.status} />
                </div>
                <p className="text-sm text-gray-800 line-clamp-2">{schedule.content}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(schedule.scheduled_at).toLocaleString('ja-JP')}
                </p>
              </div>
              {schedule.status === 'pending' && (
                <button
                  onClick={() => handleDelete(schedule.id)}
                  className="text-xs text-red-400 hover:text-red-600 shrink-0"
                >
                  削除
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

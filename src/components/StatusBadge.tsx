interface Props {
  status: 'pending' | 'posted' | 'failed' | 'cancelled'
}

const config = {
  pending: { label: '待機中', cls: 'bg-yellow-100 text-yellow-700' },
  posted: { label: '投稿済', cls: 'bg-green-100 text-green-700' },
  failed: { label: '失敗', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'キャンセル', cls: 'bg-gray-100 text-gray-600' },
}

export function StatusBadge({ status }: Props) {
  const { label, cls } = config[status]
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

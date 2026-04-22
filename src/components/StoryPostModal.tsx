import { useState, useEffect } from 'react'
import { api } from '../lib/ipc'

interface Props {
  accountId: number
  onClose: () => void
}

type LinkPosition = 'top' | 'center' | 'bottom' | 'custom'
const POSITION_Y: Record<Exclude<LinkPosition, 'custom'>, number> = {
  top: 0.2, center: 0.5, bottom: 0.8,
}

interface StoryTemplate {
  id: number; name: string; image_path: string
  link_url: string | null; link_x: number; link_y: number
  link_width: number; link_height: number; created_at: string
}

type Tab = 'post' | 'templates'

export function StoryPostModal({ accountId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('post')

  // ── 投稿設定 ───────────────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<{ name: string; path: string } | null>(null)
  const [manualPath, setManualPath]     = useState('')
  const [inputMode, setInputMode]       = useState<'file' | 'path'>('file')
  const [linkUrl, setLinkUrl]           = useState('')
  const [linkPos, setLinkPos]           = useState<LinkPosition>('center')
  const [customY, setCustomY]           = useState(0.5)
  const [linkX, setLinkX]              = useState(0.5)
  const [linkWidth, setLinkWidth]      = useState(0.3)
  const [linkHeight, setLinkHeight]    = useState(0.1)
  const [fullScreenLink, setFullScreenLink] = useState(false)
  const [posting, setPosting]           = useState(false)
  const [result, setResult]             = useState<{ ok: boolean; msg: string } | null>(null)

  // ── テンプレート ───────────────────────────────────────────────
  const [templates, setTemplates] = useState<StoryTemplate[]>([])
  const [tmplName, setTmplName]   = useState('')
  const [tmplSaving, setTmplSaving] = useState(false)

  useEffect(() => { api.storyTemplates.list().then(setTemplates) }, [])

  const handleSelectFile = async () => {
    const file = await api.dialog.openFile()
    if (!file) return
    setSelectedFile({ name: file.name, path: file.path })
    setResult(null)
  }

  const getImagePath = (): string | null => {
    if (inputMode === 'file') return selectedFile?.path ?? null
    return manualPath.trim() || null
  }

  const getLinkY = (): number => linkPos === 'custom' ? customY : POSITION_Y[linkPos]

  const applyTemplate = (t: StoryTemplate) => {
    setManualPath(t.image_path)
    setInputMode('path')
    setLinkUrl(t.link_url ?? '')
    setLinkX(t.link_x)
    setCustomY(t.link_y)
    setLinkPos('custom')
    setLinkWidth(t.link_width)
    setLinkHeight(t.link_height)
    setFullScreenLink(t.link_width >= 0.99 && t.link_height >= 0.99)
    setTab('post')
    setResult(null)
  }

  const handleSaveTemplate = async () => {
    const name = tmplName.trim()
    const imgPath = getImagePath()
    if (!name) return
    if (!imgPath) { setResult({ ok: false, msg: 'テンプレート保存: 画像を指定してください' }); return }
    setTmplSaving(true)
    await api.storyTemplates.create({
      name,
      image_path: imgPath,
      link_url:    linkUrl.trim() || null,
      link_x:      fullScreenLink ? 0.5 : linkX,
      link_y:      fullScreenLink ? 0.5 : getLinkY(),
      link_width:  fullScreenLink ? 1.0 : linkWidth,
      link_height: fullScreenLink ? 1.0 : linkHeight,
    })
    setTmplName('')
    setTmplSaving(false)
    api.storyTemplates.list().then(setTemplates)
    setResult({ ok: true, msg: `テンプレート「${name}」を保存しました` })
  }

  const handleDeleteTemplate = async (id: number) => {
    await api.storyTemplates.delete(id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const handlePost = async () => {
    const imagePath = getImagePath()
    if (!imagePath) { setResult({ ok: false, msg: '画像を指定してください' }); return }
    setPosting(true); setResult(null)
    try {
      const linkSticker = linkUrl.trim() ? {
        url: linkUrl.trim(),
        x: fullScreenLink ? 0.5 : linkX,
        y: fullScreenLink ? 0.5 : getLinkY(),
        width: fullScreenLink ? 1.0 : linkWidth,
        height: fullScreenLink ? 1.0 : linkHeight,
      } : undefined
      const res = await api.accounts.postStory({ account_id: accountId, image_path: imagePath, link_sticker: linkSticker })
      setResult(res.success
        ? { ok: true, msg: `ストーリーを投稿しました${res.mediaId ? ` (ID: ${res.mediaId})` : ''}` }
        : { ok: false, msg: res.error ?? '投稿に失敗しました' })
    } catch (e) { setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }) }
    finally { setPosting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-[440px] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-bold text-sm">ストーリー投稿</h3>
            <p className="text-zinc-500 text-xs">instagrapi 経由</p>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-1 bg-zinc-800/60 p-0.5 rounded-lg mb-4">
          <button onClick={() => setTab('post')}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${tab === 'post' ? 'bg-pink-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            投稿
          </button>
          <button onClick={() => setTab('templates')}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${tab === 'templates' ? 'bg-pink-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            テンプレート ({templates.length})
          </button>
        </div>

        {tab === 'post' && (
          <div className="space-y-4">
            {/* 画像入力 */}
            <div>
              <div className="flex gap-1 bg-zinc-800/60 p-0.5 rounded-lg mb-2">
                <button onClick={() => setInputMode('file')}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${inputMode === 'file' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  ファイル選択
                </button>
                <button onClick={() => setInputMode('path')}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors ${inputMode === 'path' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  パス直接入力
                </button>
              </div>
              {inputMode === 'file' ? (
                <div>
                  <button onClick={handleSelectFile}
                    className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg border border-zinc-700 border-dashed transition-colors">
                    {selectedFile ? `✓ ${selectedFile.name}` : '画像を選択...'}
                  </button>
                  {selectedFile && <p className="text-zinc-600 text-[9px] mt-1 font-mono truncate">{selectedFile.path}</p>}
                </div>
              ) : (
                <input type="text" value={manualPath} onChange={e => setManualPath(e.target.value)}
                  placeholder="/Users/.../image.jpg"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono" />
              )}
            </div>

            {/* リンクスタンプ */}
            <div className="border-t border-zinc-800 pt-3 space-y-2">
              <label className="text-zinc-400 text-xs font-medium block">リンクスタンプ（任意）</label>
              <input type="text" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://example.com"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500" />

              {linkUrl.trim() && (
                <div className="space-y-3 bg-zinc-800/40 rounded-lg p-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={fullScreenLink} onChange={e => setFullScreenLink(e.target.checked)} className="accent-pink-500 w-3.5 h-3.5" />
                    <span className="text-zinc-200 text-xs font-medium">全面リンク</span>
                    <span className="text-zinc-500 text-[10px]">（ストーリー全体）</span>
                  </label>

                  {!fullScreenLink && (<>
                    <Slider label="縦位置 (Y)" value={customY} min={0} max={1} step={0.05}
                      onChange={v => { setCustomY(v); setLinkPos('custom') }}
                      presets={[
                        { label: '上', value: 0.2 }, { label: '中', value: 0.5 }, { label: '下', value: 0.8 },
                      ]} />
                    <Slider label="横位置 (X)" value={linkX} min={0} max={1} step={0.05} onChange={setLinkX} />
                    <Slider label="幅" value={linkWidth} min={0.1} max={1.0} step={0.05} onChange={setLinkWidth} />
                    <Slider label="高さ" value={linkHeight} min={0.05} max={1.0} step={0.05} onChange={setLinkHeight} />
                  </>)}

                  <div className="text-[9px] text-zinc-500 font-mono bg-zinc-900 rounded px-2 py-1.5">
                    {fullScreenLink ? 'x=0.50 y=0.50 w=1.00 h=1.00 (全面)' : `x=${linkX.toFixed(2)} y=${getLinkY().toFixed(2)} w=${linkWidth.toFixed(2)} h=${linkHeight.toFixed(2)}`}
                  </div>
                </div>
              )}
            </div>

            {/* テンプレ保存 */}
            <div className="flex gap-2">
              <input type="text" value={tmplName} onChange={e => setTmplName(e.target.value)} placeholder="テンプレート名..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500" />
              <button onClick={handleSaveTemplate} disabled={tmplSaving || !tmplName.trim() || !getImagePath()}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                {tmplSaving ? '...' : '💾 保存'}
              </button>
            </div>

            {/* 結果 */}
            {result && (
              <div className={`px-3 py-2 rounded-lg text-xs ${result.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                {result.msg}
              </div>
            )}

            {/* ボタン */}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors">閉じる</button>
              <button onClick={handlePost} disabled={posting || !getImagePath()}
                className="flex-1 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2">
                {posting ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />投稿中...</> : 'ストーリー投稿'}
              </button>
            </div>
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-2">
            {templates.length === 0 && <p className="text-zinc-600 text-xs text-center py-6">テンプレートがありません</p>}
            {templates.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2.5 bg-zinc-800 rounded-lg border border-zinc-700 group">
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-200 text-xs font-medium truncate">{t.name}</p>
                  <p className="text-zinc-500 text-[9px] font-mono truncate">{t.image_path}</p>
                  {t.link_url && <p className="text-blue-400 text-[9px] truncate">🔗 {t.link_url}</p>}
                </div>
                <button onClick={() => applyTemplate(t)}
                  className="px-2.5 py-1.5 bg-pink-600 hover:bg-pink-500 text-white text-[10px] font-semibold rounded transition-colors shrink-0">
                  使用
                </button>
                <button onClick={() => handleDeleteTemplate(t.id)}
                  className="w-6 h-6 flex items-center justify-center text-zinc-600 hover:text-red-400 text-xs rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Slider コンポーネント ─────────────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange, presets }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void
  presets?: { label: string; value: number }[]
}) {
  return (
    <div>
      <label className="text-zinc-500 text-[10px] block mb-1">{label}</label>
      {presets && (
        <div className="flex gap-1 mb-1">
          {presets.map(p => (
            <button key={p.label} onClick={() => onChange(p.value)}
              className={`px-2 py-0.5 text-[9px] rounded transition-colors ${Math.abs(value - p.value) < 0.01 ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-pink-500 h-1.5" />
        <span className="text-zinc-400 text-[10px] font-mono w-8 text-right">{value.toFixed(2)}</span>
      </div>
    </div>
  )
}

// src/components/artifact/ArtifactPanel.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The right-side sliding panel that shows an artifact in full.
//
// Layout:
//   ┌─────────────────────────────────┐
//   │ Header: title · type · toolbar  │  ← copy, download, close
//   ├─────────────────────────────────┤
//   │ Tab bar: Preview | Code         │
//   ├─────────────────────────────────┤
//   │                                 │
//   │   ArtifactPreviewView           │  ← iframe or markdown or svg
//   │   — or —                        │
//   │   ArtifactCodeView              │  ← source with line numbers
//   │                                 │
//   └─────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Copy, Check, Download, X, ExternalLink } from 'lucide-react'
import { Tooltip }              from '../ui'
import { ArtifactCodeView }     from './ArtifactCodeView'
import { ArtifactPreviewView }  from './ArtifactPreviewView'

const TABS = ['preview', 'code']

export function ArtifactPanel({ artifact, onClose }) {
  const [tab,    setTab]    = useState('preview')
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard?.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    const ext  = { react:'jsx', html:'html', code:'js', markdown:'md', svg:'svg' }[artifact.type] ?? 'txt'
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `${artifact.title.replace(/\s+/g,'-').toLowerCase()}.${ext}`
    })
    a.click()
    URL.revokeObjectURL(url)
  }

  const iconBtn = "w-7 h-7 flex items-center justify-center rounded-md " +
                  "text-[#8A7F72] hover:text-[#1A1410] hover:bg-[#EAE6DC] transition-colors"

  return (
    // White panel with slide-in animation
    <div className="flex flex-col h-full bg-white panel-enter">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-[52px]
                      border-b border-[#E8E3D9] bg-[#F9F7F3] flex-shrink-0">

        {/* Title + type */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[#1A1410] truncate leading-tight">
            {artifact.title}
          </div>
          <div className="text-[10.5px] text-[#8A7F72] capitalize leading-tight">
            {artifact.type}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5">
          <Tooltip text={copied ? 'Copied!' : 'Copy code'}>
            <button onClick={handleCopy} className={iconBtn}>
              {copied ? <Check size={14}/> : <Copy size={14}/>}
            </button>
          </Tooltip>
          <Tooltip text="Download">
            <button onClick={handleDownload} className={iconBtn}>
              <Download size={14}/>
            </button>
          </Tooltip>
          <div className="w-px h-4 bg-[#E8E3D9] mx-0.5" />
          <Tooltip text="Close">
            <button onClick={onClose} className={iconBtn}>
              <X size={14}/>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 px-4 border-b border-[#E8E3D9] bg-[#F9F7F3] flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2.5 text-[12px] font-medium capitalize
                        border-b-2 -mb-px transition-colors ${
                          t === tab
                            ? 'border-[#C96A42] text-[#C96A42]'
                            : 'border-transparent text-[#8A7F72] hover:text-[#1A1410]'
                        }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {tab === 'code'
          ? <ArtifactCodeView content={artifact.content} language={artifact.language}/>
          : <ArtifactPreviewView artifact={artifact}/>}
      </div>
    </div>
  )
}
// src/components/artifact/ArtifactPreviewCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Small clickable card shown below an assistant message that produced an artifact.
// Clicking it calls onOpen, which opens the full ArtifactPanel on the right.
// ─────────────────────────────────────────────────────────────────────────────
import { Code2, Globe, FileText, ImageIcon, File, ChevronRight } from 'lucide-react'

const TYPE_ICONS = {
  react: Code2, html: Globe, code: Code2, markdown: FileText, svg: ImageIcon,
}

export function ArtifactPreviewCard({ artifact, onOpen }) {
  const Icon = TYPE_ICONS[artifact.type] ?? File

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 pl-3 pr-2.5 py-2.5
                 bg-white border border-[#E8E3D9] rounded-xl
                 hover:border-[#D9D3C8] hover:bg-[#FAF8F4]
                 shadow-[0_1px_3px_rgba(0,0,0,0.05)]
                 hover:shadow-[0_2px_6px_rgba(0,0,0,0.07)]
                 transition-all duration-150 text-left w-full max-w-[320px] group"
    >
      {/* Icon tile */}
      <div className="w-9 h-9 rounded-lg bg-[#F5EDE8] border border-[#EDD9CE]
                      flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-[#C96A42]" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-[#1A1410] truncate leading-snug">
          {artifact.title}
        </div>
        <div className="text-[11px] text-[#8A7F72] capitalize mt-0.5">
          {artifact.type} · Click to open
        </div>
      </div>

      <ChevronRight size={14} className="text-[#C0B8AE] group-hover:text-[#8A7F72]
                                          group-hover:translate-x-0.5 transition-all flex-shrink-0" />
    </button>
  )
}
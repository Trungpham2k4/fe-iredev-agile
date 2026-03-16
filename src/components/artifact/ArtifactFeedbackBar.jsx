// src/components/artifact/ArtifactFeedbackBar.jsx
// =============================================================================
// Shown at the bottom of the ArtifactPanel when the backend is waiting for
// human feedback (awaitingFeedback === true).
//
// Renders two modes:
//   1. Default: "Accept" button + "Request changes" button
//   2. After clicking "Request changes": a textarea + "Send" button
//
// Props:
//   artifactId  {string}    ID of the artifact version awaiting feedback
//   chatId      {string}    Active chat ID
//   messageId   {string}    Message ID that owns this artifact
//   iteration   {number}    Which revision iteration we're on (shown in UI)
//   maxIter     {number}    Max iterations allowed
//   onAccept    {Function}  Called when user clicks Accept
//   onRevise    {Function}  Called with (comment) when user submits feedback
// =============================================================================
import { useState } from 'react'
import { Check, Pencil, Send, X } from 'lucide-react'

export function ArtifactFeedbackBar({
  artifactId,
  iteration,
  maxIter,
  onAccept,
  onRevise,
}) {
  // Whether the revision textarea is open
  const [revising, setRevising] = useState(false)
  // The user's revision comment
  const [comment,  setComment]  = useState('')

  function handleReviseSubmit() {
    if (!comment.trim()) return
    onRevise(comment.trim())
    setComment('')
    setRevising(false)
  }

  function handleKeyDown(e) {
    // Ctrl/Cmd + Enter submits; Escape cancels
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleReviseSubmit()
    if (e.key === 'Escape') { setRevising(false); setComment('') }
  }

  const revisionsLeft = maxIter - iteration

  return (
    <div className="border-t border-[#E8E3D9] bg-[#FAF7F3] flex-shrink-0">

      {/* ── Iteration indicator ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-1.5">
          {/* Pulsing dot — shows the backend is waiting */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full
                             rounded-full bg-[#C96A42] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#C96A42]" />
          </span>
          <span className="text-[12px] font-medium text-[#1A1410]">
            Awaiting your review
          </span>
        </div>
        <span className="text-[11px] text-[#B5ADA4]">
          v{iteration}
          {revisionsLeft > 0
            ? ` · ${revisionsLeft} revision${revisionsLeft !== 1 ? 's' : ''} left`
            : ' · last revision'}
        </span>
      </div>

      {/* ── Revision textarea (shown when "Request changes" is clicked) ── */}
      {revising ? (
        <div className="px-4 pb-3">
          <textarea
            autoFocus
            rows={3}
            placeholder="Describe what you'd like changed… (Ctrl+Enter to send)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 bg-white border border-[#E8E3D9] rounded-lg
                       text-[13px] text-[#1A1410] placeholder:text-[#B5ADA4]
                       focus:outline-none focus:ring-1 focus:ring-[#C96A42]/30
                       focus:border-[#C96A42]/50 resize-none transition-all"
          />
          <div className="flex gap-2 mt-2">
            {/* Cancel */}
            <button
              onClick={() => { setRevising(false); setComment('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                         text-[12px] text-[#8A7F72] hover:bg-[#EAE6DC]
                         transition-colors"
            >
              <X size={13} /> Cancel
            </button>
            {/* Send revision */}
            <button
              onClick={handleReviseSubmit}
              disabled={!comment.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                         text-[12px] font-medium
                         bg-[#C96A42] hover:bg-[#B85E38] text-white
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors ml-auto"
            >
              <Send size={13} /> Send feedback
            </button>
          </div>
        </div>
      ) : (
        /* ── Default: Accept + Request changes buttons ──────────────── */
        <div className="flex gap-2 px-4 pb-3">
          {/* Accept — green-toned confirm */}
          <button
            onClick={onAccept}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg
                       text-[13px] font-medium
                       bg-[#16A34A] hover:bg-[#15803D] text-white
                       transition-colors shadow-sm"
          >
            <Check size={14} /> Accept
          </button>

          {/* Request changes — outlined */}
          <button
            onClick={() => setRevising(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg
                       text-[13px] font-medium
                       border border-[#E8E3D9] text-[#3D3530]
                       hover:bg-[#EAE6DC] hover:border-[#D9D3C8]
                       transition-colors"
          >
            <Pencil size={13} /> Request changes
          </button>
        </div>
      )}
    </div>
  )
}
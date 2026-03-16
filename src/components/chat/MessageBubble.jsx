// src/components/chat/MessageBubble.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Renders a single chat message — handles both user and assistant roles.
//
// User messages:    plain text, right-aligned, warm-grey bubble
// Assistant messages: rich content (markdown, code blocks), left-aligned,
//                     optional artifact preview card below
// ─────────────────────────────────────────────────────────────────────────────
import { AssistantContent }    from './AssistantContent'
import { MessageActions }      from './MessageActions'
import { ArtifactPreviewCard } from '../artifact/ArtifactPreviewCard'

export function MessageBubble({ message, onOpenArtifact }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 msg-enter ${isUser ? 'justify-end' : 'justify-start'}`}>

      {/* Claude avatar — small terracotta circle */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[#C96A42] flex items-center
                        justify-center flex-shrink-0 mt-0.5 shadow-sm">
          <span className="text-white text-[10px] font-semibold">C</span>
        </div>
      )}

      <div className={`flex flex-col gap-2 ${
        isUser ? 'items-end max-w-[75%]' : 'items-start max-w-[85%]'
      }`}>

        {/* Message bubble */}
        <div className={`text-[14px] leading-[1.65] ${
          isUser
            // User: warm filled pill
            ? 'bg-[#EAE6DC] text-[#1A1410] px-4 py-2.5 rounded-[18px] rounded-br-[4px]'
            // Assistant: no background, left-aligned text
            : 'text-[#1A1410] px-0 py-0'
        }`}>
          {isUser
            ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <AssistantContent content={message.content} streaming={message.streaming} />
          }
        </div>

        {/* Artifact preview card under assistant message */}
        {!isUser && message.artifact && !message.streaming && (
          <ArtifactPreviewCard
            artifact={message.artifact}
            onOpen={() => onOpenArtifact(message.artifact)}
          />
        )}

        {/* Action row under finished assistant messages */}
        {!isUser && !message.streaming && message.content && (
          <MessageActions content={message.content} />
        )}
      </div>

      {/* User avatar — right side */}
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[#8A7F72] flex items-center
                        justify-center flex-shrink-0 mt-0.5">
          <span className="text-white text-[10px] font-semibold">U</span>
        </div>
      )}
    </div>
  )
}
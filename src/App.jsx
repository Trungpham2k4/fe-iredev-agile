// src/App.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Root component — wires all pieces together.
//
// Layout:
//   MainLayout
//   ├── Sidebar          (left, fixed width)
//   ├── Chat column      (centre, flex-1)
//   │   ├── ChatHeader
//   │   ├── HomeScreen   (when no messages)
//   │   │   OR
//   │   │   message list (when chat is active)
//   │   └── ChatInput
//   └── ArtifactPanel    (right, fixed width, shown only when open)
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useEffect }     from 'react'
import { useChat }               from './context/ChatContext'      // ← context, not hook
import { ProtectedRoute }        from './components/layout/ProtectedRoute'
import { MainLayout }            from './components/layout/MainLayout'
import { Sidebar }               from './components/sidebar/Sidebar'
import { ChatHeader }            from './components/chat/ChatHeader'
import { HomeScreen }            from './components/chat/HomeScreen'
import { MessageBubble }         from './components/chat/MessageBubble'
import { ChatInput }             from './components/chat/ChatInput'
import { ArtifactPanel }         from './components/artifact/ArtifactPanel'
import { LoadingSpinner }        from './components/ui/LoadingSpinner'
import { ErrorBanner }           from './components/ui/ErrorBanner'

// ── Inner layout — only renders when authenticated ────────────────────────────
function ChatLayout() {
  const {
    chats, messages, activeChatId,
    streaming, openArtifact,
    loadingChats, loadingMessages, error,
    setOpenArtifact, setError,
    newChat, selectChat, deleteChat, sendMessage, cancelStream
  } = useChat()

  // Scroll to bottom whenever messages update
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <MainLayout>

      {/* ── LEFT: Sidebar ──────────────────────────────────────────── */}
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        loading={loadingChats}
        onNew={newChat}
        onSelect={selectChat}
        onDelete={deleteChat}
      />

      {/* ── CENTRE: Chat column ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-[#F4F0E6]">

        <ChatHeader activeChatId={activeChatId} chats={chats} onNew={newChat} />

        {/* Non-fatal error banner */}
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {/* Scrollable message area */}
        <div className="flex-1 overflow-y-auto">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <LoadingSpinner size={22} className="text-[#C96A42]" />
            </div>
          ) : messages.length === 0 ? (
            <HomeScreen onSend={sendMessage} />
          ) : (
            <div className="max-w-[720px] mx-auto px-6 py-8 space-y-7">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onOpenArtifact={setOpenArtifact}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <ChatInput onSend={sendMessage} disabled={streaming} onCancel={cancelStream} />
      </div>

      {/* ── RIGHT: Artifact panel ──────────────────────────────────── */}
      {openArtifact && (
        <div className="w-[500px] flex-shrink-0 h-full border-l border-[#E8E3D9]">
          <ArtifactPanel
            artifact={openArtifact}
            onClose={() => setOpenArtifact(null)}
          />
        </div>
      )}

    </MainLayout>
  )
}

// ── App root — guarded by ProtectedRoute ──────────────────────────────────────
export default function App() {
  return (
    <ProtectedRoute>
      <ChatLayout />
    </ProtectedRoute>
  )
}

// import { useRef, useEffect } from 'react'
// import { useChat }           from './hooks/useChat'
// import { MainLayout }        from './components/layout/MainLayout'
// import { Sidebar }           from './components/sidebar/Sidebar'
// import { ChatHeader }        from './components/chat/ChatHeader'
// import { HomeScreen }        from './components/chat/HomeScreen'
// import { MessageBubble }     from './components/chat/MessageBubble'
// import { ChatInput }         from './components/chat/ChatInput'
// import { ArtifactPanel }     from './components/artifact/ArtifactPanel'
// import { LoadingSpinner }    from './components/ui/LoadingSpinner'
// import { ErrorBanner }       from './components/ui/ErrorBanner'

// export default function App() {
//   const {
//     chats, messages, activeChatId,
//     streaming, openArtifact,
//     loadingChats, loadingMessages, error,
//     setOpenArtifact, setError,
//     newChat, selectChat, deleteChat, sendMessage,
//   } = useChat()

//   // Auto-scroll to the latest message whenever messages change
//   const bottomRef = useRef(null)
//   useEffect(() => {
//     bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
//   }, [messages])

//   return (
//     <MainLayout>

//       {/* ── LEFT: Sidebar ─────────────────────────────────────────────── */}
//       <Sidebar
//         chats={chats}
//         activeChatId={activeChatId}
//         loading={loadingChats}
//         onNew={newChat}
//         onSelect={selectChat}
//         onDelete={deleteChat}
//       />

//       {/* ── CENTRE: Chat column ───────────────────────────────────────── */}
//       <div className="flex-1 flex flex-col min-w-0 h-full bg-[#F4F0E6]">

//         <ChatHeader activeChatId={activeChatId} chats={chats} onNew={newChat} />

//         {/* Non-fatal error banner (e.g. "Failed to send") */}
//         <ErrorBanner message={error} onDismiss={() => setError(null)} />

//         {/* Scrollable message area */}
//         <div className="flex-1 overflow-y-auto">
//           {loadingMessages ? (
//             // Skeleton while loading a chat's history
//             <div className="flex items-center justify-center h-full">
//               <LoadingSpinner size={22} className="text-[#C96A42]" />
//             </div>
//           ) : messages.length === 0 ? (
//             // Home/welcome screen when no messages are loaded
//             <HomeScreen onSend={sendMessage} />
//           ) : (
//             // Message list
//             <div className="max-w-[720px] mx-auto px-6 py-8 space-y-7">
//               {messages.map((msg) => (
//                 <MessageBubble
//                   key={msg.id}
//                   message={msg}
//                   onOpenArtifact={setOpenArtifact}
//                 />
//               ))}
//               {/* Invisible anchor — scrolled into view on new messages */}
//               <div ref={bottomRef} />
//             </div>
//           )}
//         </div>

//         <ChatInput onSend={sendMessage} disabled={streaming} />
//       </div>

//       {/* ── RIGHT: Artifact panel (slides in when open) ───────────────── */}
//       {openArtifact && (
//         <div className="w-[500px] flex-shrink-0 h-full border-l border-[#E8E3D9]">
//           <ArtifactPanel
//             artifact={openArtifact}
//             onClose={() => setOpenArtifact(null)}
//           />
//         </div>
//       )}

//     </MainLayout>
//   )
// }
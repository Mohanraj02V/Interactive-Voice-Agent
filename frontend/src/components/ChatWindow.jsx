/**
 * ChatWindow component.
 * Scrollable conversation area that auto-scrolls to newest messages.
 */
import { useEffect, useRef } from 'react';
import ChatMessage, { TypingIndicator } from './ChatMessage';

export default function ChatWindow({ messages, isProcessing }) {
  const bottomRef = useRef(null);
  const windowRef = useRef(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing]);

  const isEmpty = messages.length === 0 && !isProcessing;

  return (
    <main
      id="chat-window"
      className="chat-window"
      ref={windowRef}
      aria-label="Conversation"
      aria-live="polite"
    >
      {isEmpty ? (
        <div className="chat-empty" aria-label="No messages yet">
          <div className="chat-empty-icon" aria-hidden="true">🎙️</div>
          <h2>Hello! How can I help you?</h2>
          <p>Click the microphone button and speak to start a conversation.</p>
        </div>
      ) : (
        <>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {isProcessing && <TypingIndicator />}
          <div ref={bottomRef} aria-hidden="true" />
        </>
      )}
    </main>
  );
}

/**
 * ChatMessage component.
 * Renders a single conversation message bubble.
 */

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function ChatMessage({ message }) {
  const { role, content, timestamp, onReplay } = message;
  const isUser = role === 'user';

  return (
    <article
      className={`chat-message ${isUser ? 'user' : 'assistant'}`}
      aria-label={`${isUser ? 'You' : 'AI'}: ${content}`}
    >
      <div className="chat-message-role">
        {isUser ? 'You' : 'AI'}
      </div>
      <div className="chat-message-bubble">
        {content}
        {onReplay && (
          <button 
            className="btn-replay" 
            onClick={onReplay} 
            aria-label="Replay audio"
            title="Replay audio"
          >
            🔊 Play
          </button>
        )}
      </div>
      {timestamp && (
        <time className="chat-message-time" dateTime={timestamp}>
          {formatTime(timestamp)}
        </time>
      )}
    </article>
  );
}

/**
 * Typing indicator shown while the AI is processing.
 */
export function TypingIndicator() {
  return (
    <article className="chat-message assistant" aria-label="AI is thinking">
      <div className="chat-message-role">AI</div>
      <div className="chat-message-bubble typing" aria-hidden="true">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </article>
  );
}

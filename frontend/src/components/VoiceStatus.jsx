/**
 * VoiceStatus component.
 * Displays human-friendly text describing the current recording/AI state.
 */

const STATUS_CONFIG = {
  idle: {
    text: 'Start Voice Chat',
    className: 'idle',
  },
  recording: {
    text: 'Listening...',
    className: 'recording',
  },
  processing: {
    text: 'Thinking...',
    className: 'processing',
  },
  speaking: {
    text: 'AI Speaking...',
    className: 'speaking',
  },
  error: {
    text: 'Something went wrong',
    className: 'error',
  },
};

export default function VoiceStatus({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

  return (
    <div className="voice-status" aria-live="polite" aria-atomic="true">
      <span className={`voice-status-text ${config.className}`}>
        {config.text}
      </span>
    </div>
  );
}

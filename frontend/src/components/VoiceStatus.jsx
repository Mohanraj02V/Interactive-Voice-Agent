/**
 * VoiceStatus component.
 * Displays human-friendly text describing the current recording/AI state.
 */

const STATUS_CONFIG = {
  idle: {
    text: 'Click the microphone to speak',
    className: 'idle',
  },
  recording: {
    text: 'Listening...',
    className: 'recording',
  },
  processing: {
    text: 'Processing your question...',
    className: 'processing',
  },
  speaking: {
    text: 'AI is speaking...',
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

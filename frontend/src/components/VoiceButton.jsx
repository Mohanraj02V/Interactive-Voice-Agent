/**
 * VoiceButton component.
 * Large microphone button with state-based appearance and animation.
 * States: idle | recording | processing | speaking
 */
import Waveform from './Waveform';

const STATE_CONFIG = {
  idle: {
    icon: '🎤',
    label: 'Start voice recording',
    disabled: false,
  },
  recording: {
    icon: '🎙️',
    label: 'Stop recording',
    disabled: false,
  },
  processing: {
    icon: '🧠',
    label: 'Processing, please wait',
    disabled: true,
  },
  speaking: {
    icon: '🔊',
    label: 'AI is speaking',
    disabled: true,
  },
};

export default function VoiceButton({ state, onPress, audioLevel }) {
  const config = STATE_CONFIG[state] || STATE_CONFIG.idle;
  const isRecording = state === 'recording';

  return (
    <div className="voice-control-panel">
      {/* Waveform visualizer — visible during recording */}
      <Waveform isActive={isRecording} audioLevel={audioLevel} />

      {/* Microphone button */}
      <div className="mic-button-wrapper">
        {/* Ripple rings during recording */}
        {isRecording && (
          <>
            <div className="mic-ripple" />
            <div className="mic-ripple" />
          </>
        )}

        <button
          id="mic-button"
          className={`mic-button ${state}`}
          onClick={onPress}
          disabled={config.disabled}
          aria-label={config.label}
          aria-pressed={isRecording}
        >
          <span className="mic-button-icon" role="img" aria-hidden="true">
            {config.icon}
          </span>
        </button>
      </div>
    </div>
  );
}

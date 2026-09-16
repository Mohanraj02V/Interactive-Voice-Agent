/**
 * App.jsx — Main application component.
 * Manages all state and orchestrates the voice chat flow.
 *
 * Flow:
 *   User clicks mic → record → stop → POST /api/voice-chat
 *   → show transcript → show AI response → play audio → idle
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import VoiceButton from './components/VoiceButton';
import VoiceStatus from './components/VoiceStatus';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { checkHealth, getAudioUrl, sendVoiceChat } from './services/api';

// ── App state machine ────────────────────────────────────────
// idle | recording | processing | speaking | error
const APP_STATE = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
};

let msgCounter = 0;
function createMessage(role, content) {
  return { id: ++msgCounter, role, content, timestamp: new Date().toISOString() };
}

// ── Service Health Indicator ─────────────────────────────────
function ServiceDot({ available, label }) {
  const cls = available === null ? 'checking' : available ? 'available' : 'unavailable';
  return (
    <div className="service-indicator" title={`${label}: ${available === null ? 'checking' : available ? 'available' : 'unavailable'}`}>
      <span className={`service-dot ${cls}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// ── Error Banner ─────────────────────────────────────────────
function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner-icon" aria-hidden="true">⚠️</span>
      <span>{message}</span>
      <button
        className="error-banner-close"
        onClick={onClose}
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState(APP_STATE.IDLE);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState({ ollama: null, whisper: null, tts: null });

  const audioRef = useRef(null);
  const audioObjectUrlRef = useRef(null);

  const {
    isRecording,
    audioBlob,
    audioLevel,
    error: recorderError,
    startRecording,
    stopRecording,
    clearError: clearRecorderError,
    clearBlob,
  } = useVoiceRecorder();

  // ── Health check on mount ──────────────────────────────────
  useEffect(() => {
    async function fetchHealth() {
      try {
        const data = await checkHealth();
        setHealth({ ollama: data.ollama, whisper: data.whisper, tts: data.tts });
      } catch {
        setHealth({ ollama: false, whisper: false, tts: false });
      }
    }
    fetchHealth();
    // Recheck every 30s
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Sync recorder error → app error ───────────────────────
  useEffect(() => {
    if (recorderError) {
      setError(recorderError);
      clearRecorderError();
      setAppState(APP_STATE.IDLE);
    }
  }, [recorderError, clearRecorderError]);

  // ── Process audio blob when recording stops ────────────────
  useEffect(() => {
    if (!audioBlob) return;
    handleAudioBlob(audioBlob);
    clearBlob();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob]);

  // ── Handle the audio blob: POST to backend ─────────────────
  const handleAudioBlob = useCallback(async (blob) => {
    setAppState(APP_STATE.PROCESSING);
    setError(null);

    // Build conversation history (exclude audio_url, just role/content)
    const history = messages.map(({ role, content }) => ({ role, content }));

    try {
      const result = await sendVoiceChat(blob, history);

      if (!result.success) {
        const code = result.error?.code;
        const msg = result.error?.message || 'Something went wrong. Please try again.';

        // Surface transcript even on LLM failure
        if (result.transcript) {
          setMessages((prev) => [
            ...prev,
            createMessage('user', result.transcript),
          ]);
        }

        // TTS-only warning (response still succeeded)
        if (code === 'TTS_UNAVAILABLE') {
          // This is handled below with audio_url = null
        } else {
          setError(msg);
          setAppState(APP_STATE.IDLE);
          return;
        }
      }

      // Add user transcript to chat
      if (result.transcript) {
        setMessages((prev) => [...prev, createMessage('user', result.transcript)]);
      }

      // Add AI response to chat
      if (result.response) {
        setMessages((prev) => [...prev, createMessage('assistant', result.response)]);
      }

      // Show TTS warning if present but non-fatal
      if (result.error?.code === 'TTS_UNAVAILABLE') {
        setError(result.error.message);
      }

      // Play audio if available
      if (result.audio_url) {
        await playAudio(result.audio_url);
      } else {
        setAppState(APP_STATE.IDLE);
      }
    } catch (err) {
      let userMessage = 'Unable to connect to the AI server. Please check the backend is running.';
      if (err.response) {
        userMessage = err.response.data?.detail || 'Server error. Please try again.';
      } else if (err.message?.includes('Network Error')) {
        userMessage = 'Unable to connect to the AI server. Please check the backend is running.';
      }
      setError(userMessage);
      setAppState(APP_STATE.IDLE);
    }
  }, [messages]);

  // ── Play TTS audio ─────────────────────────────────────────
  const playAudio = useCallback(async (audioUrl) => {
    // Revoke previous object URL if any
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    const fullUrl = getAudioUrl(audioUrl);
    const audio = new Audio(fullUrl);
    audioRef.current = audio;

    setAppState(APP_STATE.SPEAKING);

    audio.onended = () => {
      setAppState(APP_STATE.IDLE);
      audioRef.current = null;
    };

    audio.onerror = () => {
      setError('Audio playback failed. The response is shown above.');
      setAppState(APP_STATE.IDLE);
      audioRef.current = null;
    };

    try {
      await audio.play();
    } catch (err) {
      // Autoplay may be blocked
      setError('Audio playback was blocked by the browser. Click play to hear the response.');
      setAppState(APP_STATE.IDLE);
    }
  }, []);

  // ── Stop speaking ──────────────────────────────────────────
  const handleStopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setAppState(APP_STATE.IDLE);
  }, []);

  // ── Mic button click ───────────────────────────────────────
  const handleMicPress = useCallback(async () => {
    if (appState === APP_STATE.SPEAKING) return; // Use stop speaking button
    if (appState === APP_STATE.PROCESSING) return; // Guard

    if (appState === APP_STATE.RECORDING) {
      stopRecording();
      // appState → PROCESSING is set after blob arrives
    } else {
      // Idle → start recording
      await startRecording();
      // Only update to RECORDING if no error (error effect above resets to IDLE)
      setAppState((prev) =>
        prev === APP_STATE.IDLE ? APP_STATE.RECORDING : prev
      );
    }
  }, [appState, startRecording, stopRecording]);

  // When recording stops and we get the blob, the useEffect above fires.
  // But if startRecording fails, appState resets via recorder error useEffect.

  // ── New chat ───────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    if (appState === APP_STATE.RECORDING) stopRecording();
    if (appState === APP_STATE.SPEAKING) handleStopSpeaking();
    setMessages([]);
    setError(null);
    setAppState(APP_STATE.IDLE);
  }, [appState, stopRecording, handleStopSpeaking]);

  // ── Cleanup audio on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    };
  }, []);

  const isProcessing = appState === APP_STATE.PROCESSING;

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo" aria-hidden="true">🤖</div>
          <h1 className="app-title">Interactive AI</h1>
        </div>
        <button
          id="new-chat-btn"
          className="btn-new-chat"
          onClick={handleNewChat}
          aria-label="Start a new conversation"
        >
          ＋ New Chat
        </button>
      </header>

      {/* ── Service Status Bar ── */}
      <nav className="service-status-bar" aria-label="Service status">
        <ServiceDot available={health.whisper} label="Speech" />
        <ServiceDot available={health.ollama} label="AI" />
        <ServiceDot available={health.tts} label="Voice" />
      </nav>

      {/* ── Error Banner ── */}
      <ErrorBanner message={error} onClose={() => setError(null)} />

      {/* ── Chat Window ── */}
      <ChatWindow messages={messages} isProcessing={isProcessing} />

      {/* ── Voice Controls ── */}
      <section className="voice-control-panel" aria-label="Voice controls">
        <VoiceButton
          state={appState}
          onPress={handleMicPress}
          audioLevel={audioLevel}
        />

        <VoiceStatus status={appState} />

        {/* Stop Speaking button */}
        {appState === APP_STATE.SPEAKING && (
          <button
            id="stop-speaking-btn"
            className="btn-stop"
            onClick={handleStopSpeaking}
            aria-label="Stop AI audio playback"
          >
            ⏹ Stop
          </button>
        )}
      </section>
    </div>
  );
}

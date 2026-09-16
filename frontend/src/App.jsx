/**
 * App.jsx — Main application component.
 * Manages all state and orchestrates the continuous voice chat flow.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import VoiceButton from './components/VoiceButton';
import VoiceStatus from './components/VoiceStatus';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { checkHealth, getAudioUrl, sendVoiceChat } from './services/api';

// ── App state machine ────────────────────────────────────────
const APP_STATE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
};

let msgCounter = 0;
function createMessage(role, content, audioUrl = null) {
  return { id: ++msgCounter, role, content, audioUrl, timestamp: new Date().toISOString() };
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
  const [health, setHealth] = useState({ ollama: null, whisper: null, tts: null, ollama_model_available: null });

  const audioRef = useRef(null);
  const audioObjectUrlRef = useRef(null);

  // Use a ref to break the circular dependency between useVoiceRecorder and handleUtteranceComplete
  const handleUtteranceCompleteRef = useRef(null);

  const {
    isListening,
    audioLevel,
    error: recorderError,
    startListening,
    resumeListening,
    pauseListening,
    stopListening,
    clearError: clearRecorderError,
  } = useVoiceRecorder({ onUtteranceComplete: (blob) => handleUtteranceCompleteRef.current?.(blob) });

  // ── Helper: Reset to listening state ───────────────────────
  const resetToListening = useCallback(() => {
    resumeListening();
    setAppState(APP_STATE.LISTENING);
  }, [resumeListening]);

  // ── Processing Watchdog ────────────────────────────────────
  useEffect(() => {
    let timeoutId;
    if (appState === APP_STATE.PROCESSING) {
      timeoutId = setTimeout(() => {
        console.warn('Watchdog: Processing state timed out after 45s. Resetting to listening.');
        setError('The server took too long to respond. Please try again.');
        resetToListening();
      }, 45000);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [appState, resetToListening]);

  // ── Play TTS audio ─────────────────────────────────────────
  const playAudio = useCallback(async (audioUrl) => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    const fullUrl = getAudioUrl(audioUrl);
    const audio = new Audio(fullUrl);
    audioRef.current = audio;

    setAppState(APP_STATE.SPEAKING);

    audio.onended = () => {
      audioRef.current = null;
      // Audio finished, return to listening automatically
      resetToListening();
    };

    audio.onerror = () => {
      setError('Audio playback failed. The response is shown above.');
      audioRef.current = null;
      resetToListening();
    };

    try {
      await audio.play();
    } catch (err) {
      setError('Audio playback was blocked by the browser. Click play to hear the response.');
      resetToListening();
    }
  }, [resetToListening]);

  // ── Handle the audio blob: POST to backend ─────────────────
  const handleUtteranceComplete = useCallback(async (blob) => {
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
          // Handled below
        } else {
          setError(msg);
          // Return to listening on failure (so they can try again without restarting the session)
          resetToListening();
          return;
        }
      }

      // Add user transcript to chat
      if (result.transcript) {
        setMessages((prev) => [...prev, createMessage('user', result.transcript)]);
      }

      // Add AI response to chat
      if (result.response) {
        setMessages((prev) => [...prev, createMessage('assistant', result.response, result.audio_url)]);
      }

      if (result.error?.code === 'TTS_UNAVAILABLE') {
        setError(result.error.message);
      }

      // Play audio if available, otherwise just resume listening
      if (result.audio_url) {
        await playAudio(result.audio_url);
      } else {
        resetToListening();
      }
    } catch (err) {
      let userMessage = 'Unable to connect to the AI server. Please check the backend is running.';
      if (err.response) {
        userMessage = err.response.data?.detail || 'Server error. Please try again.';
      } else if (err.message?.includes('Network Error')) {
        userMessage = 'Unable to connect to the AI server. Please check the backend is running.';
      }
      setError(userMessage);
      resetToListening();
    }
  }, [messages, resetToListening, playAudio]);

  // Keep the ref updated with the latest callback
  useEffect(() => {
    handleUtteranceCompleteRef.current = handleUtteranceComplete;
  }, [handleUtteranceComplete]);

  // ── Health check on mount ──────────────────────────────────
  useEffect(() => {
    async function fetchHealth() {
      try {
        const data = await checkHealth();
        setHealth({ 
          ollama: data.ollama, 
          whisper: data.whisper, 
          tts: data.tts,
          ollama_model_available: data.ollama_model_available
        });
      } catch {
        setHealth({ ollama: false, whisper: false, tts: false, ollama_model_available: false });
      }
    }
    fetchHealth();
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

  // ── Keep appState in sync with isListening from hook ───────
  useEffect(() => {
    // If hook says we're listening but app state is idle (just started)
    if (isListening && appState === APP_STATE.IDLE) {
      setAppState(APP_STATE.LISTENING);
    } 
    // If hook stopped listening and we were listening, it might be processing or actually stopped
    else if (!isListening && appState === APP_STATE.LISTENING) {
      // If we didn't transition to PROCESSING, it means it was stopped
      // But we let handleUtteranceComplete handle PROCESSING transition.
    }
  }, [isListening, appState]);

  // ── Stop active session entirely ───────────────────────────
  const handleStopSession = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    stopListening();
    setAppState(APP_STATE.IDLE);
  }, [stopListening]);

  // ── Stop speaking (just the audio) ─────────────────────────
  const handleStopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    // If session is still active, return to listening
    if (appState === APP_STATE.SPEAKING) {
      resetToListening();
    }
  }, [appState, resetToListening]);

  // ── Mic button click ───────────────────────────────────────
  const handleMicPress = useCallback(async () => {
    if (appState === APP_STATE.IDLE) {
      await startListening();
      // State transition to LISTENING is handled by useEffect on isListening
    }
    // If not idle, mic button acts as an indicator, not a control.
    // The user should use "Stop Voice Chat" to stop.
  }, [appState, startListening]);

  // ── New chat ───────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    handleStopSession();
    setMessages([]);
    setError(null);
  }, [handleStopSession]);

  // ── Replay audio ───────────────────────────────────────────
  const handleReplay = useCallback((audioUrl) => {
    if (!audioUrl) return;
    
    // If we're listening, pause VAD so we don't transcribe the AI
    if (appState === APP_STATE.LISTENING) {
      pauseListening();
    }
    
    playAudio(audioUrl);
  }, [appState, pauseListening, playAudio]);

  // ── Cleanup audio on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    };
  }, []);

  const isProcessing = appState === APP_STATE.PROCESSING;
  
  // Custom wrapper for messages to pass down replay handler
  const messagesWithReplay = messages.map(msg => ({
    ...msg,
    onReplay: msg.role === 'assistant' && msg.audioUrl ? () => handleReplay(msg.audioUrl) : undefined
  }));

  // Map appState back to the strings VoiceButton expects for UI (idle, recording, processing, speaking)
  const uiState = appState === APP_STATE.LISTENING ? 'recording' : appState;

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
        <ServiceDot available={health.ollama && health.ollama_model_available} label="AI" />
        <ServiceDot available={health.tts} label="Voice" />
      </nav>

      {/* ── Error Banner ── */}
      <ErrorBanner message={error} onClose={() => setError(null)} />

      {/* ── Chat Window ── */}
      <ChatWindow messages={messagesWithReplay} isProcessing={isProcessing} />

      {/* ── Voice Controls ── */}
      <section className="voice-control-panel" aria-label="Voice controls">
        <VoiceButton
          state={uiState}
          onPress={handleMicPress}
          audioLevel={audioLevel}
        />

        <VoiceStatus status={uiState} />

        {/* Stop Voice Session button */}
        {appState !== APP_STATE.IDLE && (
          <div className="stop-controls">
            {appState === APP_STATE.SPEAKING && (
               <button
                 className="btn-stop btn-stop-speaking"
                 onClick={handleStopSpeaking}
                 aria-label="Stop AI audio playback"
               >
                 ⏹ Stop Speaking
               </button>
            )}
            <button
              className="btn-stop btn-stop-session"
              onClick={handleStopSession}
              aria-label="Stop Voice Chat Session"
            >
              ⏹ Stop Voice Chat
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

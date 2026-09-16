/**
 * App.jsx — Main application component.
 * Manages all state and orchestrates the continuous voice chat flow.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import VoiceButton from './components/VoiceButton';
import VoiceStatus from './components/VoiceStatus';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { checkHealth, getAudioUrl, sendVoiceChatStream, sendVoiceChat } from './services/api';

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
  
  // Streaming audio playback queue
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const isStreamCompleteRef = useRef(true);
  const assistantMessageIdRef = useRef(null);

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

  // ── Play next audio from queue ──────────────────────────────
  const playNextAudio = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      if (isStreamCompleteRef.current) {
        resetToListening();
      }
      return;
    }

    isPlayingRef.current = true;
    setAppState(APP_STATE.SPEAKING);

    const nextAudio = audioQueueRef.current.shift();
    audioRef.current = nextAudio;

    nextAudio.onended = () => {
      if (nextAudio.src.startsWith('blob:')) URL.revokeObjectURL(nextAudio.src);
      audioRef.current = null;
      playNextAudio();
    };

    nextAudio.onerror = () => {
      if (nextAudio.src.startsWith('blob:')) URL.revokeObjectURL(nextAudio.src);
      setError('Audio playback failed mid-stream.');
      audioRef.current = null;
      playNextAudio();
    };

    try {
      if (nextAudio._parsed_time) {
        console.log(`[LATENCY] Audio chunk parsing to play delta: ${Date.now() - nextAudio._parsed_time}ms`);
      }
      await nextAudio.play();
    } catch (err) {
      setError('Audio playback was blocked by the browser.');
      playNextAudio();
    }
  }, [resetToListening]);

  // ── Handle the audio blob: POST to backend stream ──────────
  const handleUtteranceComplete = useCallback(async (blob) => {
    setAppState(APP_STATE.PROCESSING);
    setError(null);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isStreamCompleteRef.current = false;
    assistantMessageIdRef.current = null;

    // Build conversation history (exclude audio_url, just role/content)
    const history = messages.map(({ role, content }) => ({ role, content }));

    try {
      await sendVoiceChatStream(blob, history, (data) => {
        if (data.type === 'error') {
           setError(data.message || 'Stream error');
           isStreamCompleteRef.current = true;
           audioQueueRef.current = [];
           if (!isPlayingRef.current) resetToListening();
        } else if (data.type === 'transcript') {
           setMessages((prev) => [...prev, createMessage('user', data.text)]);
        } else if (data.type === 'audio_chunk') {
           const t_parsed = Date.now();
           // Preload audio
           let audio;
           if (data.audio_data) {
             const byteChars = atob(data.audio_data);
             const byteNumbers = new Array(byteChars.length);
             for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
             const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'audio/wav' });
             audio = new Audio(URL.createObjectURL(blob));
           } else {
             const fullUrl = getAudioUrl(data.audio_url);
             audio = new Audio(fullUrl);
           }
           audio._parsed_time = t_parsed;
           audio.load();
           audioQueueRef.current.push(audio);

           // Update text progressively
           setMessages((prev) => {
             const updated = [...prev];
             const last = updated[updated.length - 1];
             if (last && last.role === 'assistant' && last.id === assistantMessageIdRef.current) {
               last.content = last.content ? last.content + ' ' + data.text : data.text;
             } else {
               const newMsg = createMessage('assistant', data.text);
               assistantMessageIdRef.current = newMsg.id;
               updated.push(newMsg);
             }
             return updated;
           });

           if (!isPlayingRef.current) {
             playNextAudio();
           }
        } else if (data.type === 'done') {
           isStreamCompleteRef.current = true;
           setMessages((prev) => {
             const updated = [...prev];
             const last = updated[updated.length - 1];
             // Ensure the final response is complete and accurate
             if (last && last.role === 'assistant' && last.id === assistantMessageIdRef.current) {
               last.content = data.full_response || last.content;
             } else if (!assistantMessageIdRef.current) {
               // If no chunks ever arrived, but it's done
               updated.push(createMessage('assistant', data.full_response || ''));
             }
             return updated;
           });
           
           if (!isPlayingRef.current) {
             resetToListening();
           }
        }
      });
    } catch (err) {
      let userMessage = 'Unable to connect to the AI server. Please check the backend is running.';
      setError(userMessage);
      resetToListening();
    }
  }, [messages, resetToListening, playNextAudio]);

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
      if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    audioQueueRef.current = [];
    stopListening();
    setAppState(APP_STATE.IDLE);
  }, [stopListening]);

  // ── Stop speaking (just the audio) ─────────────────────────
  const handleStopSpeaking = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
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
    // Note: Replay is mostly disabled for streaming responses unless we modify backend to return a full compiled wav
    // If a legacy message has audioUrl, play it.
    if (!audioUrl) return;
    
    // If we're listening, pause VAD so we don't transcribe the AI
    if (appState === APP_STATE.LISTENING) {
      pauseListening();
    }
    
    const fullUrl = getAudioUrl(audioUrl);
    const audio = new Audio(fullUrl);
    audioRef.current = audio;
    audio.play();
    audio.onended = () => { resetToListening(); };
  }, [appState, pauseListening, resetToListening]);

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

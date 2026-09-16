/**
 * useVoiceRecorder hook.
 * Manages continuous microphone recording with Voice Activity Detection (VAD).
 * Automatically segments speech based on silence.
 */
import { useCallback, useRef, useState, useEffect } from 'react';

// Preferred MIME types in order of preference
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

function getSupportedMimeType() {
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return ''; // Let the browser decide
}

// Configurable VAD settings (using constants, could be moved to env later)
const VAD_SILENCE_MS = 900;
const VAD_MIN_SPEECH_MS = 500;
const VAD_THRESHOLD = 0.02;
const VAD_MAX_UTTERANCE_MS = 30000;

export function useVoiceRecorder({ onUtteranceComplete }) {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState(null);

  // References to keep state across renders without triggering re-renders
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const mimeTypeRef = useRef(getSupportedMimeType());

  // VAD state refs
  const vadActiveRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const isSpeechActiveRef = useRef(false);
  const utteranceTimeoutRef = useRef(null);

  /** Completely stop the stream and VAD loop. */
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  /** Stop the current MediaRecorder to finalize a chunk */
  const stopCurrentRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  /** Start a new MediaRecorder using the existing stream */
  const startNewRecorder = useCallback(() => {
    if (!streamRef.current) return;
    
    // Clear old chunks
    chunksRef.current = [];
    
    const options = mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : {};
    const recorder = new MediaRecorder(streamRef.current, options);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current || 'audio/webm',
        });
        if (onUtteranceComplete) {
          onUtteranceComplete(blob);
        }
      }
      chunksRef.current = [];
    };

    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
    };

    recorder.start(250);
  }, [onUtteranceComplete]);

  /** VAD loop to monitor audio levels and segment utterances */
  const vadLoop = useCallback(() => {
    if (!vadActiveRef.current || !analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Calculate RMS (volume level)
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = dataArray[i] / 255.0; // Normalize to 0-1
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    
    // Smooth visual level for UI
    setAudioLevel(prev => prev * 0.8 + rms * 0.2);

    const now = Date.now();
    const isLoud = rms > VAD_THRESHOLD;

    if (isLoud) {
      lastSpeechAtRef.current = now;
      if (!isSpeechActiveRef.current) {
        // Speech just started
        isSpeechActiveRef.current = true;
        speechStartedAtRef.current = now;
        console.log('[VOICE] Speech detected');
        
        // Enforce max duration safety
        if (utteranceTimeoutRef.current) clearTimeout(utteranceTimeoutRef.current);
        utteranceTimeoutRef.current = setTimeout(() => {
          console.log('[VOICE] Max utterance duration reached');
          if (vadActiveRef.current) finalizeUtterance();
        }, VAD_MAX_UTTERANCE_MS);
      }
    } else if (isSpeechActiveRef.current) {
      // Silence checking
      const silenceDuration = now - lastSpeechAtRef.current;
      const speechDuration = lastSpeechAtRef.current - speechStartedAtRef.current;

      if (silenceDuration >= VAD_SILENCE_MS) {
        if (speechDuration >= VAD_MIN_SPEECH_MS) {
          console.log(`[VOICE] Silence detected - finalizing utterance (${(speechDuration/1000).toFixed(1)}s)`);
          finalizeUtterance();
        } else {
          // Noise spike, just reset speech state without finalizing
          isSpeechActiveRef.current = false;
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(vadLoop);
  }, []);

  const finalizeUtterance = useCallback(() => {
    isSpeechActiveRef.current = false;
    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
      utteranceTimeoutRef.current = null;
    }
    
    // Pause VAD while we process
    vadActiveRef.current = false;
    stopCurrentRecorder();
    // Note: next step (PROCESSING) will be handled by the parent when onUtteranceComplete fires
  }, [stopCurrentRecorder]);

  /** Initializes the audio context for VAD analysis */
  const initAudioAnalysis = useCallback((stream) => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext();
      } else if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.5;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
    } catch (e) {
      console.warn("Could not initialize VAD audio context:", e);
    }
  }, []);

  /** Start a brand new listening session, requesting permissions */
  const startListening = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    isSpeechActiveRef.current = false;
    
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support microphone access.');
      return;
    }

    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }, 
          video: false 
        });
        initAudioAnalysis(streamRef.current);
      }
      
      setIsListening(true);
      vadActiveRef.current = true;
      startNewRecorder();
      
      if (!animFrameRef.current) {
        animFrameRef.current = requestAnimationFrame(vadLoop);
      }
      
      console.log('[VOICE] Session started');
    } catch (err) {
      releaseStream();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone permission was denied.');
      } else {
        setError(`Could not access microphone: ${err.message}`);
      }
    }
  }, [initAudioAnalysis, startNewRecorder, vadLoop, releaseStream]);

  /** Resume listening within an active session (e.g., after TTS finishes) */
  const resumeListening = useCallback(() => {
    if (!streamRef.current) return;
    console.log('[VOICE] Returning to listening mode');
    setIsListening(true);
    vadActiveRef.current = true;
    isSpeechActiveRef.current = false;
    
    // Always create a fresh recorder instance for the next utterance
    startNewRecorder();

    // Restart VAD loop if stopped
    if (!animFrameRef.current) {
      animFrameRef.current = requestAnimationFrame(vadLoop);
    }
  }, [startNewRecorder, vadLoop]);

  /** Pause VAD and recording (e.g., while AI is speaking) */
  const pauseListening = useCallback(() => {
    vadActiveRef.current = false;
    setIsListening(false);
    stopCurrentRecorder();
  }, [stopCurrentRecorder]);

  /** Completely stop the session and release microphone */
  const stopListening = useCallback(() => {
    console.log('[VOICE] Session stopped');
    vadActiveRef.current = false;
    setIsListening(false);
    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
    }
    stopCurrentRecorder();
    releaseStream();
  }, [stopCurrentRecorder, releaseStream]);

  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseStream();
    };
  }, [releaseStream]);

  return {
    isListening,
    audioLevel,
    error,
    startListening,
    resumeListening,
    pauseListening,
    stopListening,
    clearError,
  };
}

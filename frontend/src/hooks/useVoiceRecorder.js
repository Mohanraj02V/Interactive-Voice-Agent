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

// Configurable VAD settings from env
const VAD_DEBUG = import.meta.env.VITE_VAD_DEBUG === 'true';
const VAD_SILENCE_MS = parseInt(import.meta.env.VITE_VAD_SILENCE_MS) || 500;
const VAD_MIN_SPEECH_MS = parseInt(import.meta.env.VITE_VAD_MIN_SPEECH_MS) || 400;
const VAD_MAX_UTTERANCE_MS = parseInt(import.meta.env.VITE_VAD_MAX_UTTERANCE_MS) || 15000;
const VAD_NOISE_MULTIPLIER = parseFloat(import.meta.env.VITE_VAD_NOISE_MULTIPLIER) || 2.5;

export function useVoiceRecorder({ onUtteranceComplete }) {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState(null);

  // Sync callback to a ref so the recorder doesn't need to rebuild when messages change
  const callbackRef = useRef(onUtteranceComplete);
  useEffect(() => {
    callbackRef.current = onUtteranceComplete;
  }, [onUtteranceComplete]);

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

  // Adaptive Noise Floor refs
  const noiseFloorRef = useRef(0.01);
  const calibrationFramesRef = useRef(0);
  const consecutiveSpeechFramesRef = useRef(0);
  const lastDebugLogRef = useRef(0);

  /** Stop the current MediaRecorder to finalize a chunk */
  const stopCurrentRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const finalizeUtterance = useCallback(() => {
    isSpeechActiveRef.current = false;
    speechStartedAtRef.current = 0;
    lastSpeechAtRef.current = 0;
    consecutiveSpeechFramesRef.current = 0;

    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
      utteranceTimeoutRef.current = null;
    }
    
    // Pause VAD while we process
    vadActiveRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    stopCurrentRecorder();
    // Note: next step (PROCESSING) will be handled by the parent when onUtteranceComplete fires
  }, [stopCurrentRecorder]);

  /** VAD loop to monitor audio levels and segment utterances */
  const vadLoop = useCallback(() => {
    if (!vadActiveRef.current || !analyserRef.current) {
      animFrameRef.current = null;
      return;
    }

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

    // Calibration phase (~700ms at 60fps is ~42 frames)
    if (calibrationFramesRef.current > 0) {
      calibrationFramesRef.current--;
      // Initialize or adapt heavily during calibration
      noiseFloorRef.current = noiseFloorRef.current === 0.01 
        ? Math.max(rms, 0.001)
        : noiseFloorRef.current * 0.8 + rms * 0.2;
      
      animFrameRef.current = requestAnimationFrame(vadLoop);
      return;
    }

    // Adapt noise floor slowly if not speaking
    if (!isSpeechActiveRef.current) {
      noiseFloorRef.current = noiseFloorRef.current * 0.95 + rms * 0.05;
    }

    const threshold = Math.max(noiseFloorRef.current * VAD_NOISE_MULTIPLIER, 0.015);
    const isLoud = rms > threshold;

    if (VAD_DEBUG && now - lastDebugLogRef.current > 250) {
      lastDebugLogRef.current = now;
      console.log(`[VAD DEBUG] rms: ${rms.toFixed(4)}, floor: ${noiseFloorRef.current.toFixed(4)}, thr: ${threshold.toFixed(4)}, loud: ${isLoud}, active: ${isSpeechActiveRef.current}`);
    }

    if (isLoud) {
      consecutiveSpeechFramesRef.current++;
      if (consecutiveSpeechFramesRef.current >= 2) {
        lastSpeechAtRef.current = now;
        if (!isSpeechActiveRef.current) {
          // Speech just started
          isSpeechActiveRef.current = true;
          speechStartedAtRef.current = now;
          console.log(`[VAD] Speech started: ${now}`);
          
          // Enforce max duration safety
          if (utteranceTimeoutRef.current) clearTimeout(utteranceTimeoutRef.current);
          utteranceTimeoutRef.current = setTimeout(() => {
            console.log('[VAD] Max utterance duration reached');
            if (vadActiveRef.current) finalizeUtterance();
          }, VAD_MAX_UTTERANCE_MS);
        }
      }
    } else {
      consecutiveSpeechFramesRef.current = 0;
      if (isSpeechActiveRef.current) {
        // Silence checking
        const silenceDuration = now - lastSpeechAtRef.current;
        const speechDuration = lastSpeechAtRef.current - speechStartedAtRef.current;

        if (silenceDuration >= VAD_SILENCE_MS) {
          if (speechDuration >= VAD_MIN_SPEECH_MS) {
            console.log(`[VAD] Last speech: ${lastSpeechAtRef.current}`);
            console.log(`[VAD] Silence duration: ${silenceDuration}ms`);
            console.log(`[VAD] Utterance finalized: ${now}`);
            finalizeUtterance();
          } else {
            // Noise spike, just reset speech state without finalizing
            isSpeechActiveRef.current = false;
          }
        }
      }
    }

    // Schedule next frame if still active
    if (vadActiveRef.current) {
      animFrameRef.current = requestAnimationFrame(vadLoop);
    } else {
      animFrameRef.current = null;
    }
  }, [finalizeUtterance]);

  /** Helper to unconditionally start the VAD loop */
  const startVadLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    vadActiveRef.current = true;
    animFrameRef.current = requestAnimationFrame(vadLoop);
  }, [vadLoop]);

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
    vadActiveRef.current = false;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
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
        if (callbackRef.current) {
          callbackRef.current(blob);
        }
      }
      chunksRef.current = [];
    };

    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
    };

    recorder.start(250);
  }, []);

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
    consecutiveSpeechFramesRef.current = 0;
    
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
      
      // Calibrate noise floor on initial start
      calibrationFramesRef.current = 42; // ~700ms at 60fps
      noiseFloorRef.current = 0.01;
      
      startNewRecorder();
      startVadLoop();
      
      console.log('[VOICE] Session started');
    } catch (err) {
      releaseStream();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone permission was denied.');
      } else {
        setError(`Could not access microphone: ${err.message}`);
      }
    }
  }, [initAudioAnalysis, startNewRecorder, startVadLoop, releaseStream]);

  /** Resume listening within an active session (e.g., after TTS finishes) */
  const resumeListening = useCallback(() => {
    if (!streamRef.current) return;
    console.log('[VOICE] Returning to listening mode');
    setIsListening(true);
    isSpeechActiveRef.current = false;
    consecutiveSpeechFramesRef.current = 0;
    
    // Optionally re-calibrate slightly? We'll just trust the adapted noise floor
    
    // Always create a fresh recorder instance for the next utterance
    startNewRecorder();
    startVadLoop();
  }, [startNewRecorder, startVadLoop]);

  /** Pause VAD and recording (e.g., while AI is speaking) */
  const pauseListening = useCallback(() => {
    vadActiveRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
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

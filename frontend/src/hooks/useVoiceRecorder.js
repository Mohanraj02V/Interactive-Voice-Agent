/**
 * useVoiceRecorder hook.
 * Manages microphone recording using the MediaRecorder API.
 * Handles permissions, recording state, and audio Blob creation.
 */
import { useCallback, useRef, useState } from 'react';

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

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  /** Stop audio level monitoring. */
  const stopLevelMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  /** Start monitoring microphone audio level for waveform. */
  const startLevelMonitor = useCallback((stream) => {
    try {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        setAudioLevel(Math.min(avg / 128, 1));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Audio level monitoring is best-effort; not critical
    }
  }, []);

  /** Release microphone stream tracks. */
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  /**
   * Start recording from the microphone.
   * Requests permission on first use.
   */
  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    chunksRef.current = [];

    // Check MediaRecorder support
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support microphone access. Please use Chrome or Edge.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Your browser does not support audio recording. Please use Chrome or Edge.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        setAudioBlob(blob);
        chunksRef.current = [];
        stopLevelMonitor();
        releaseStream();
      };

      recorder.onerror = (e) => {
        setError(`Recording error: ${e.error?.message || 'Unknown error'}`);
        setIsRecording(false);
        stopLevelMonitor();
        releaseStream();
      };

      recorder.start(250); // Collect data every 250ms
      setIsRecording(true);
      startLevelMonitor(stream);
    } catch (err) {
      releaseStream();
      stopLevelMonitor();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError(
          'Microphone permission was denied. Please allow microphone access in your browser settings and try again.'
        );
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotSupportedError') {
        setError('Microphone access is not supported in this browser.');
      } else {
        setError(`Could not access microphone: ${err.message}`);
      }
    }
  }, [startLevelMonitor, stopLevelMonitor, releaseStream]);

  /**
   * Stop recording and finalize the audio Blob.
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  /**
   * Cancel recording without creating a Blob.
   */
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    chunksRef.current = [];
    stopLevelMonitor();
    releaseStream();
    setIsRecording(false);
    setAudioBlob(null);
  }, [stopLevelMonitor, releaseStream]);

  const clearError = useCallback(() => setError(null), []);
  const clearBlob = useCallback(() => setAudioBlob(null), []);

  return {
    isRecording,
    audioBlob,
    audioLevel,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    clearError,
    clearBlob,
  };
}

/**
 * API service layer.
 * All backend communication goes through these functions.
 */
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000, // 2 minutes for LLM processing
});

/**
 * Check backend service health.
 * @returns {Promise<{status, ollama, whisper, tts, ollama_model, whisper_model}>}
 */
export async function checkHealth() {
  const response = await api.get('/health');
  return response.data;
}

/**
 * Send audio and conversation history to the backend.
 * @param {Blob} audioBlob - Recorded audio blob
 * @param {Array} conversation - Array of {role, content} messages
 * @returns {Promise<{success, transcript, response, audio_url, error}>}
 */
export async function sendVoiceChat(audioBlob, conversation = []) {
  const formData = new FormData();

  // Determine extension from MIME type
  const mimeType = audioBlob.type || 'audio/webm';
  const extension = mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('wav') ? 'wav'
    : mimeType.includes('mp4') ? 'mp4'
    : 'webm';

  formData.append('audio', audioBlob, `recording.${extension}`);
  formData.append('conversation', JSON.stringify(conversation));

  const response = await api.post('/voice-chat', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

/**
 * Get the full URL for a generated audio file.
 * @param {string} filename - Audio filename from the API response
 * @returns {string} Full URL
 */
export function getAudioUrl(filename) {
  if (!filename) return null;
  // filename may be a path like /api/audio/response_abc.wav or just the name
  if (filename.startsWith('/api/')) {
    const backendBase = BASE_URL.replace('/api', '');
    return `${backendBase}${filename}`;
  }
  return `${BASE_URL}/audio/${filename}`;
}

export default api;

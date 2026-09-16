# Troubleshooting Guide — Interactive Voice AI

---

## Backend Issues

### ❌ Ollama not running

**Symptom:** Health check shows `ollama: false`. Requests return "AI service is currently unavailable."

**Fix:**
```bash
# Start Ollama
ollama serve

# Windows: Ollama should be a background service after installation.
# Check Task Manager for 'ollama' process.
```

Verify with:
```bash
curl http://localhost:11434/api/tags
```

Expected: JSON with a `models` key.

---

### ❌ Model not found

**Symptom:** Error "Model 'qwen2.5:3b' not found in Ollama"

**Fix:**
```bash
ollama pull qwen2.5:3b
```

Check available models:
```bash
ollama list
```

---

### ❌ Whisper not installed / import error

**Symptom:** Backend logs "faster-whisper is not installed"

**Fix:**
```bash
pip install faster-whisper
```

If you see PyTorch errors on Windows:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install faster-whisper
```

---

### ❌ PyTorch / CUDA issues

**Symptom:** Errors about CUDA not available, slow inference.

**For CPU-only (no GPU):**
Set in `.env`:
```env
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

**For NVIDIA GPU:**
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

Then:
```env
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
```

---

### ❌ Piper executable missing

**Symptom:** Health check shows `tts: false`. Logs say "Piper executable 'piper' not found."

**Fix:**
1. Download Piper from https://github.com/rhasspy/piper/releases
2. Add to PATH, OR set in `.env`:
   ```env
   PIPER_EXECUTABLE=C:\piper\piper.exe   # Windows
   PIPER_EXECUTABLE=/usr/local/bin/piper  # Linux
   ```

Verify piper works:
```bash
echo "Hello world" | piper --model voices/en_US-lessac-medium.onnx --output_file /tmp/test.wav
```

---

### ❌ Piper voice model missing

**Symptom:** Logs say "Piper voice model not found: voices/en_US-lessac-medium.onnx"

**Fix:**
1. Create `backend/voices/` folder
2. Download from HuggingFace:
   - `en_US-lessac-medium.onnx`
   - `en_US-lessac-medium.onnx.json`
3. Confirm path in `.env` matches

---

### ❌ FFmpeg missing (audio format conversion)

**Symptom:** Transcription fails on certain audio formats.

**Windows:**
```powershell
winget install ffmpeg
# or download from https://ffmpeg.org/download.html and add to PATH
```

**Linux:**
```bash
sudo apt install ffmpeg -y
```

faster-whisper uses ffmpeg internally to handle non-WAV formats.

---

### ❌ Port already in use

**Symptom:** `Address already in use` on port 8000 or 5173.

**Backend — find and kill:**
```powershell
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

Or change port in `.env`:
```env
PORT=8001
```
And update `VITE_API_BASE_URL=http://localhost:8001/api` in `frontend/.env`.

**Frontend:**
```bash
# Vite will automatically use the next available port if 5173 is taken
npm run dev -- --port 5174
```

---

## Frontend Issues

### ❌ Microphone permission denied

**Symptom:** Error "Microphone permission was denied"

**Chrome/Edge fix:**
1. Click the 🔒 lock icon in the address bar
2. Set Microphone → Allow
3. Reload the page

**Firefox fix:**
1. Click the 🔒 lock icon
2. Permissions → Microphone → Allow

**Note:** Microphone only works on `localhost` or HTTPS. If accessing from another device, you need HTTPS.

---

### ❌ No microphone found

**Symptom:** Error "No microphone found"

**Fix:**
- Connect a microphone or use a headset.
- Check OS sound settings: the microphone must be set as the default input device.
- Windows: Settings → System → Sound → Input → Select correct device

---

### ❌ CORS error in browser console

**Symptom:** `Access to XMLHttpRequest blocked by CORS policy`

**Fix:** In `backend/.env`:
```env
CORS_ORIGINS=http://localhost:5173
```

Restart the backend after changing `.env`.

---

### ❌ Network error / cannot connect to backend

**Symptom:** "Unable to connect to the AI server"

**Check:**
1. Is the backend running? Look for the uvicorn process.
2. Visit http://localhost:8000/api/health in your browser.
3. Is `VITE_API_BASE_URL` correct in `frontend/.env`?
4. Check firewall rules on Windows if accessing from another machine.

---

### ❌ Audio playback blocked by browser

**Symptom:** AI responds with text but no audio plays. Console shows autoplay error.

**Fix:**
- Click somewhere on the page first (browsers block audio on pages with no user interaction).
- This is a browser security restriction — it should work after the first microphone click.

---

## Performance Tips

| Tip | Setting |
|-----|---------|
| Use smaller Whisper model | `WHISPER_MODEL=tiny` |
| Use CPU compute type | `WHISPER_COMPUTE_TYPE=int8` |
| Reduce LLM response length | `OLLAMA_NUM_PREDICT=150` |
| Use a smaller Ollama model | `OLLAMA_MODEL=qwen2.5:1.5b` |

---

## Logs

Backend logs include timestamps and component names:
```
2024-01-01 12:00:00 | INFO     | Transcription started: upload_abc123.webm (45231 bytes)
2024-01-01 12:00:02 | INFO     | Transcription completed in 1.82s
2024-01-01 12:00:02 | INFO     | LLM request started: model=qwen2.5:3b, messages=3
2024-01-01 12:00:05 | INFO     | LLM request completed in 3.12s
2024-01-01 12:00:05 | INFO     | TTS started: generating response_abc456.wav
2024-01-01 12:00:07 | INFO     | TTS completed in 1.95s
```

For more verbose logs, set `DEBUG=true` in `.env`.

# Interactive Voice AI

A fully local, privacy-first voice assistant that runs on your machine.

```
You speak → Whisper transcribes → Ollama thinks → Piper speaks back
```

No cloud APIs. No subscriptions. Just open-source AI on your hardware.

---

## Architecture

```
Browser (React + Vite)
    │
    │  POST /api/voice-chat (multipart audio + conversation history)
    ▼
FastAPI Backend (Python)
    │
    ├── faster-whisper  →  Speech-to-Text
    ├── Ollama          →  LLM (Qwen 2.5 3B by default)
    └── Piper TTS       →  Text-to-Speech
    │
    │  JSON response (transcript + text + audio URL)
    ▼
Browser plays WAV audio
```

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Python      | 3.11+   |
| Node.js     | 18+     |
| Ollama      | Latest  |
| Piper TTS   | Latest  |
| FFmpeg      | Optional (helps with format conversion) |

Hardware:
- CPU: Any modern x86-64 CPU (GPU optional, improves speed)
- RAM: 4 GB minimum, 8 GB+ recommended
- Disk: ~2–4 GB for models

---

## Quick Start

### Step 1 — Clone / Open the Project

```bash
cd "path/to/Interactive AI"
```

### Step 2 — Create Python Virtual Environment

```bash
python -m venv .venv
```

**Windows:**
```bash
.venv\Scripts\activate
```

**Linux/macOS:**
```bash
source .venv/bin/activate
```

### Step 3 — Install Python Dependencies

```bash
pip install -r backend/requirements.txt
```

> **Note:** `faster-whisper` requires PyTorch. On CPU-only systems this installs automatically. On GPU systems you may want to install a CUDA-compatible PyTorch first — see `docs/SETUP_WINDOWS.md`.

### Step 4 — Install Ollama

Download from: https://ollama.com/download

Start the Ollama service:
```bash
ollama serve
```

### Step 5 — Pull the Default LLM

```bash
ollama pull qwen2.5:3b
```

This downloads ~2 GB. Any other Ollama model works — update `OLLAMA_MODEL` in `.env`.

### Step 6 — Install Piper TTS

Piper is the text-to-speech engine.

1. Download Piper for your platform from:  
   https://github.com/rhasspy/piper/releases

2. Extract the archive. You will get a `piper` executable (or `piper.exe` on Windows).

3. Place the executable somewhere in your `PATH`, or note the full path for `.env`.

4. Download a voice model:  
   https://huggingface.co/rhasspy/piper-voices/tree/main

   Recommended (English): `en_US-lessac-medium`
   - Download `en_US-lessac-medium.onnx`
   - Download `en_US-lessac-medium.onnx.json`

5. Place both files in `backend/voices/`.

### Step 7 — Configure Environment

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
WHISPER_MODEL=base
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://localhost:11434
PIPER_MODEL=voices/en_US-lessac-medium.onnx
PIPER_EXECUTABLE=piper
```

Frontend:
```bash
cd frontend
cp .env.example .env
```

`frontend/.env`:
```env
VITE_API_BASE_URL=http://localhost:8000/api
```

### Step 8 — Start the Backend

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

You should see:
```
✓ Whisper model 'base' loaded
✓ Ollama connected
✓ Piper TTS available
✓ API ready at http://0.0.0.0:8000
```

### Step 9 — Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

### Step 10 — Open the App

Visit: http://localhost:5173

---

## Configuration Reference

See `backend/.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `base` | Whisper model size: tiny/base/small/medium |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Ollama model name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_NUM_PREDICT` | `300` | Max tokens for LLM response |
| `PIPER_MODEL` | `voices/en_US-lessac-medium.onnx` | Path to Piper voice model |
| `PIPER_EXECUTABLE` | `piper` | Piper executable name or path |
| `MAX_AUDIO_SIZE_MB` | `25` | Max uploaded audio size |
| `AUDIO_RETENTION_MINUTES` | `60` | Delete old audio files after N minutes |

---

## Running Tests

```bash
cd backend
pytest app/tests/ -v
```

---

## Project Structure

```
Interactive AI/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Settings from .env
│   │   ├── schemas.py           # Pydantic request/response models
│   │   ├── api/
│   │   │   ├── health.py        # GET /api/health
│   │   │   ├── voice_chat.py    # POST /api/voice-chat
│   │   │   └── audio.py         # GET /api/audio/{filename}
│   │   ├── services/
│   │   │   ├── speech_to_text.py  # faster-whisper wrapper
│   │   │   ├── llm.py             # Ollama chat client
│   │   │   ├── text_to_speech.py  # Piper TTS wrapper
│   │   │   └── voice_chat.py      # Pipeline orchestrator
│   │   └── utils/
│   │       ├── audio.py           # File validation
│   │       ├── files.py           # Secure filenames, cleanup
│   │       └── logging.py         # Structured logging
│   ├── voices/                    # Place Piper .onnx voice models here
│   ├── generated_audio/           # TTS output (auto-cleaned)
│   ├── temp_audio/                # Upload temp dir (auto-cleaned)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx                # Main app + state machine
│       ├── components/
│       │   ├── ChatWindow.jsx
│       │   ├── ChatMessage.jsx
│       │   ├── VoiceButton.jsx
│       │   ├── VoiceStatus.jsx
│       │   └── Waveform.jsx
│       ├── hooks/
│       │   └── useVoiceRecorder.js
│       └── services/
│           └── api.js
└── docs/
    ├── SETUP_WINDOWS.md
    ├── SETUP_LINUX.md
    └── TROUBLESHOOTING.md
```

---

## Troubleshooting

See `docs/TROUBLESHOOTING.md` for detailed help.

Common issues:
- **Ollama not running** → Start with `ollama serve`
- **Model not found** → Run `ollama pull qwen2.5:3b`
- **Piper not found** → Add piper to PATH or set full path in `PIPER_EXECUTABLE`
- **Whisper slow** → Use `WHISPER_MODEL=tiny` for faster (less accurate) transcription
- **Microphone denied** → Allow in browser settings → site permissions

---

## License

MIT

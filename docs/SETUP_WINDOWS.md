# Windows Setup Guide — Interactive Voice AI

This guide walks you through a complete setup on Windows 10/11.

---

## Prerequisites

### 1. Python 3.11+

Download from: https://www.python.org/downloads/

During installation:
- ✅ Check "Add Python to PATH"
- ✅ Check "Install pip"

Verify:
```powershell
python --version
pip --version
```

### 2. Node.js 18+

Download LTS from: https://nodejs.org/

Verify:
```powershell
node --version
npm --version
```

### 3. Git (optional but recommended)

Download from: https://git-scm.com/

---

## Step 1 — Python Virtual Environment

Open PowerShell in the project folder:

```powershell
cd "C:\path\to\Interactive AI"
python -m venv .venv
.venv\Scripts\activate
```

You should see `(.venv)` in the prompt.

---

## Step 2 — Install Python Dependencies

```powershell
pip install -r backend\requirements.txt
```

This installs:
- FastAPI, Uvicorn
- faster-whisper (includes PyTorch for CPU)
- httpx
- pydantic-settings

> **GPU (NVIDIA) Users:** For CUDA acceleration, install PyTorch with CUDA first:
> ```powershell
> pip install torch --index-url https://download.pytorch.org/whl/cu121
> pip install -r backend\requirements.txt
> ```
> Then set in `.env`: `WHISPER_DEVICE=cuda`

---

## Step 3 — Install Ollama

1. Download from: https://ollama.com/download
2. Run the installer — it adds `ollama` to your PATH.
3. Ollama installs as a Windows service and starts automatically.

Check it's running:
```powershell
ollama list
```

Pull the default model:
```powershell
ollama pull qwen2.5:3b
```

This downloads ~2 GB. Be patient.

---

## Step 4 — Install Piper TTS

### 4a. Download Piper

1. Go to: https://github.com/rhasspy/piper/releases/latest
2. Download `piper_windows_amd64.zip`
3. Extract it — you'll get a `piper.exe` file.

### 4b. Add to PATH (Option A — Easiest)

1. Create a folder: `C:\piper\`
2. Move `piper.exe` (and any DLLs) into `C:\piper\`
3. Add `C:\piper\` to your system PATH:
   - Win+R → `sysdm.cpl` → Advanced → Environment Variables
   - Under "System variables" → Edit `Path` → New → `C:\piper\`
4. Restart your terminal.

Verify:
```powershell
piper --version
```

### 4b. Set Full Path (Option B — No PATH change)

In `backend\.env`:
```env
PIPER_EXECUTABLE=C:\piper\piper.exe
```

### 4c. Download a Voice Model

1. Go to: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium
2. Download:
   - `en_US-lessac-medium.onnx`
   - `en_US-lessac-medium.onnx.json`
3. Create folder `backend\voices\` and place both files there.

Your `.env` should have:
```env
PIPER_MODEL=voices/en_US-lessac-medium.onnx
```

---

## Step 5 — Configure Environment

```powershell
cd backend
copy .env.example .env
```

Edit `backend\.env` in Notepad or VS Code:

```env
WHISPER_MODEL=base
WHISPER_DEVICE=auto
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://localhost:11434
PIPER_MODEL=voices/en_US-lessac-medium.onnx
PIPER_EXECUTABLE=piper
```

Frontend:
```powershell
cd ..\frontend
copy .env.example .env
```

---

## Step 6 — Start the Backend

Open PowerShell in the project root:

```powershell
.venv\Scripts\activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Expected output:
```
Starting Interactive Voice AI
✓ Audio directories ready
Loading Whisper model...
✓ Whisper model 'base' loaded in 3.21s
✓ Ollama connected at http://localhost:11434
✓ Piper TTS available (model: en_US-lessac-medium.onnx)
✓ API ready at http://0.0.0.0:8000
```

Test the API:
```
http://localhost:8000/api/health
```

---

## Step 7 — Start the Frontend

Open a second PowerShell window:

```powershell
cd "C:\path\to\Interactive AI\frontend"
npm install
npm run dev
```

Open: http://localhost:5173

---

## Whisper Model Sizes

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny  | 75 MB | Fastest | Lower |
| base  | 145 MB | Fast | Good |
| small | 465 MB | Medium | Better |
| medium | 1.5 GB | Slow | Best for CPU |

For most users on CPU, `base` is the best balance.

---

## Tips

- **Keep Ollama running**: The `ollama serve` command starts the API server. On Windows, the installer usually starts it as a background service.
- **Slow first response**: Whisper and Ollama load on first use. Subsequent responses are faster.
- **Port conflicts**: If port 8000 is taken, set `PORT=8001` in `.env` and update `VITE_API_BASE_URL` in `frontend\.env`.

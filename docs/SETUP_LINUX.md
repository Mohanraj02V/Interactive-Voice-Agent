# Linux Setup Guide — Interactive Voice AI

---

## Prerequisites

### Python 3.11+

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3.11 python3.11-venv python3.11-pip -y

# Fedora
sudo dnf install python3.11 -y

# Arch
sudo pacman -S python
```

### Node.js 18+

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# Or Ubuntu/Debian via NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y
```

---

## Step 1 — Python Virtual Environment

```bash
cd "/path/to/Interactive AI"
python3.11 -m venv .venv
source .venv/bin/activate
```

---

## Step 2 — Install Python Dependencies

```bash
pip install -r backend/requirements.txt
```

For NVIDIA GPU acceleration:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install -r backend/requirements.txt
```

Then in `.env`: `WHISPER_DEVICE=cuda`

---

## Step 3 — Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Start the service:
```bash
ollama serve &
```

Or as a systemd service:
```bash
sudo systemctl enable ollama
sudo systemctl start ollama
```

Pull model:
```bash
ollama pull qwen2.5:3b
```

---

## Step 4 — Install Piper TTS

```bash
# Download the latest release
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar xzf piper_linux_x86_64.tar.gz
sudo mv piper /usr/local/bin/

# Verify
piper --version
```

Download voice model:
```bash
mkdir -p backend/voices
cd backend/voices

# Download lessac medium English voice
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

---

## Step 5 — Configure

```bash
cd backend
cp .env.example .env
# Edit .env with your settings

cd ../frontend
cp .env.example .env
```

---

## Step 6 — Start Backend

```bash
source .venv/bin/activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## Step 7 — Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

---

## Audio Dependencies (if needed)

Some systems may need additional audio libraries:

```bash
# Ubuntu/Debian
sudo apt install libsndfile1 ffmpeg -y

# Fedora
sudo dnf install libsndfile ffmpeg -y
```

---

## Microphone Permissions

On Linux, ensure your user has microphone access:

```bash
# Check audio groups
groups | grep audio

# Add user to audio group if needed
sudo usermod -aG audio $USER
```

Browser microphone permission is also required — click Allow when prompted.

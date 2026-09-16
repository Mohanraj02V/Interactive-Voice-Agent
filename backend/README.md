# Interactive Voice AI — Backend

FastAPI backend for the Interactive Voice AI application.

## Quick Start

```bash
# Activate virtual environment
.venv\Scripts\activate   # Windows
source .venv/bin/activate  # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run
py -m uvicorn app.main:app --reload --reload-dir app --port 8000
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Service health check |
| `/api/voice-chat` | POST | Process voice input |
| `/api/audio/{filename}` | GET | Retrieve generated audio |
| `/docs` | GET | Swagger UI (debug mode) |

## Tests

```bash
pytest app/tests/ -v
```

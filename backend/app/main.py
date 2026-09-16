"""
FastAPI application entry point.
Initializes all AI services at startup.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audio, health, voice_chat
from app.config import get_settings
from app.services.llm import get_llm_service
from app.services.speech_to_text import get_stt_service
from app.services.text_to_speech import get_tts_service
from app.utils.files import get_generated_audio_dir, get_temp_audio_dir
from app.utils.logging import get_logger, setup_logging

# Setup logging before anything else
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    settings = get_settings()

    logger.info("=" * 60)
    logger.info(f"  Starting {settings.app_name}")
    logger.info(f"  Environment: {settings.app_env}")
    logger.info("=" * 60)

    # Ensure audio directories exist
    get_temp_audio_dir()
    get_generated_audio_dir()
    logger.info("[OK] Audio directories ready")

    # Initialize Whisper
    logger.info("Loading Whisper model...")
    stt = get_stt_service()
    stt_ok = stt.initialize()
    if not stt_ok:
        logger.warning("[WARN] Whisper unavailable - speech recognition will not work")

    # Check Ollama
    logger.info("Checking Ollama...")
    llm = get_llm_service()
    llm_ok = llm.check_availability()
    if not llm_ok:
        logger.warning("[WARN] Ollama service is unreachable - LLM will not work")
    elif not llm.is_model_available:
        logger.warning(f"[WARN] Ollama model '{settings.ollama_model}' is missing - LLM will not work")

    # Initialize Piper TTS
    logger.info("Checking Piper TTS...")
    tts = get_tts_service()
    tts_ok = tts.initialize()
    if not tts_ok:
        logger.warning("[WARN] Piper TTS unavailable - voice playback will not work")

    logger.info("=" * 60)
    logger.info(f"  Whisper:  {'[OK] available' if stt_ok else '[WARN] unavailable'} (model: {settings.whisper_model})")
    logger.info(f"  Ollama:   {'[OK] available' if llm_ok else '[WARN] unavailable'} (model: {settings.ollama_model}, max_predict: {settings.ollama_num_predict})")
    logger.info(f"  Piper:    {'[OK] available' if tts_ok else '[WARN] unavailable'}")
    logger.info(f"  CORS:     Allowed origins: {settings.cors_origins_list}")
    logger.info(f"  API ready at http://{settings.host}:{settings.port}")
    logger.info("=" * 60)

    yield

    logger.info("Application shutting down...")


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Interactive Voice AI Chat — voice → Whisper → Ollama → Piper → voice",
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(health.router, prefix="/api", tags=["Health"])
    app.include_router(voice_chat.router, prefix="/api", tags=["Voice Chat"])
    app.include_router(audio.router, prefix="/api", tags=["Audio"])

    return app


app = create_application()

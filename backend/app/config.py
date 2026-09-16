"""
Application configuration using Pydantic Settings.
All settings are loaded from environment variables or .env file.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central application configuration."""

    # App
    app_name: str = Field(default="Interactive Voice AI", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    debug: bool = Field(default=True, alias="DEBUG")

    # Server
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")

    # CORS
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    # Whisper STT
    whisper_model: str = Field(default="base", alias="WHISPER_MODEL")
    whisper_device: str = Field(default="auto", alias="WHISPER_DEVICE")
    whisper_compute_type: str = Field(default="auto", alias="WHISPER_COMPUTE_TYPE")

    # Ollama LLM
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="qwen2.5:3b", alias="OLLAMA_MODEL")
    ollama_num_predict: int = Field(default=300, alias="OLLAMA_NUM_PREDICT")
    ollama_timeout: int = Field(default=120, alias="OLLAMA_TIMEOUT")

    # Piper TTS
    piper_model: str = Field(default="voices/en_US-lessac-medium.onnx", alias="PIPER_MODEL")
    piper_executable: str = Field(default="piper", alias="PIPER_EXECUTABLE")

    # Audio settings
    max_audio_size_mb: int = Field(default=25, alias="MAX_AUDIO_SIZE_MB")
    max_conversation_messages: int = Field(default=20, alias="MAX_CONVERSATION_MESSAGES")
    generated_audio_dir: str = Field(default="generated_audio", alias="GENERATED_AUDIO_DIR")
    temp_audio_dir: str = Field(default="temp_audio", alias="TEMP_AUDIO_DIR")
    audio_retention_minutes: int = Field(default=60, alias="AUDIO_RETENTION_MINUTES")

    # System prompt for the LLM
    system_prompt: str = Field(
        default=(
            "You are a helpful voice AI assistant. "
            "Answer clearly and naturally. "
            "Keep responses concise enough to be comfortable when spoken aloud. "
            "Do not use unnecessary markdown, bullet points, or headers in your responses. "
            "Do not produce extremely long responses unless the user explicitly requests more detail. "
            "Speak in plain, conversational sentences."
        ),
        alias="SYSTEM_PROMPT",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse the comma-separated CORS origins string into a list."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def max_audio_size_bytes(self) -> int:
        return self.max_audio_size_mb * 1024 * 1024

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()

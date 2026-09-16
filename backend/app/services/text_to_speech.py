"""
Text-to-Speech service using Piper TTS.
Converts response text into WAV audio files.
"""
import time
import wave
from pathlib import Path
from pathlib import Path
from typing import Optional

from app.config import get_settings
from app.utils.files import generate_unique_filename, get_generated_audio_dir
from app.utils.logging import get_logger

logger = get_logger(__name__)


class TTSError(Exception):
    """Raised when TTS synthesis fails."""
    pass


class TTSUnavailableError(TTSError):
    """Raised when Piper is not installed or the voice model is missing."""
    pass


class TextToSpeechService:
    """
    Wraps Piper TTS to convert text to speech WAV files.
    """

    def __init__(self):
        self._available = False
        self._voice = None
        self._model_path: Optional[Path] = None

    def initialize(self) -> bool:
        """
        Check that Piper is available and the voice model exists.
        Returns True if everything is set up.
        """
        # Find voice model relative to backend project
        # Project root is backend/
        settings = get_settings()
        model_path = Path(settings.piper_model).absolute()

        if not model_path.exists():
            logger.warning(
                f"⚠ Piper voice model not found: {model_path}. "
                "TTS will be unavailable."
            )
            self._available = False
            return False

        try:
            logger.info(f"[TTS] Initialization started for model: {model_path.name}")
            from piper import PiperVoice
            self._voice = PiperVoice.load(str(model_path))
            self._model_path = model_path
            self._available = True
            logger.info(f"[OK] Piper TTS available (model: {model_path.name})")
            return True
        except ImportError:
            logger.warning("[WARN] piper-tts python package is not installed. Run: pip install piper-tts")
            self._available = False
            return False
        except Exception as e:
            logger.warning(f"[WARN] Failed to load Piper model '{model_path.name}': {e}")
            self._available = False
            return False

    @property
    def is_available(self) -> bool:
        return self._available

    def synthesize(self, text: str) -> Path:
        """
        Convert text to speech and save as a WAV file.

        Args:
            text: The text to speak.

        Returns:
            Path to the generated WAV file.

        Raises:
            TTSUnavailableError: If Piper is not available.
            TTSError: If synthesis fails.
        """
        if not self._available:
            raise TTSUnavailableError(
                "Voice synthesis is currently unavailable. "
                "Please install Piper TTS and configure a voice model."
            )

        if not text or not text.strip():
            raise TTSError("Cannot synthesize empty text")

        # Clean text for TTS (remove markdown artifacts)
        clean_text = self._clean_text(text)

        output_dir = get_generated_audio_dir()
        output_filename = generate_unique_filename(prefix="response_", extension="wav")
        output_path = output_dir / output_filename

        logger.info(f"[TTS] Synthesis started: generating {output_filename}")
        start = time.time()

        try:
            with wave.open(str(output_path), "wb") as f:
                self._voice.synthesize(clean_text, f)
        except Exception as e:
            output_path.unlink(missing_ok=True)
            raise TTSError(f"TTS synthesis failed: {str(e)}")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise TTSError("Piper did not produce an output file")

        elapsed = time.time() - start
        logger.info(f"[TTS] Synthesis completed")
        logger.info(
            f"[TTS] Duration: {elapsed:.2f}s "
            f"({output_path.name}, {output_path.stat().st_size} bytes)"
        )

        return output_path

    def _clean_text(self, text: str) -> str:
        """Remove markdown artifacts and clean text for TTS."""
        import re
        # Remove markdown headers
        text = re.sub(r"#+\s*", "", text)
        # Remove bold/italic
        text = re.sub(r"\*{1,3}(.*?)\*{1,3}", r"\1", text)
        # Remove code blocks
        text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
        # Remove inline code
        text = re.sub(r"`([^`]+)`", r"\1", text)
        # Remove bullet points
        text = re.sub(r"^[\*\-\+]\s+", "", text, flags=re.MULTILINE)
        # Collapse multiple newlines
        text = re.sub(r"\n{2,}", " ", text)
        text = text.replace("\n", " ")
        # Collapse multiple spaces
        text = re.sub(r"\s{2,}", " ", text)
        return text.strip()


# Module-level singleton
_tts_service = TextToSpeechService()


def get_tts_service() -> TextToSpeechService:
    """Return the shared TextToSpeechService instance."""
    return _tts_service

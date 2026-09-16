"""
Speech-to-Text service using faster-whisper.
Model is loaded once at startup and reused across requests.
"""
import time
from pathlib import Path
from typing import Optional

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger(__name__)


class SpeechToTextError(Exception):
    """Raised when transcription fails."""
    pass


class SpeechToTextService:
    """
    Wraps faster-whisper for audio transcription.
    The Whisper model is loaded once and reused for all requests.
    """

    def __init__(self):
        self._model = None
        self._available = False
        self._model_size: Optional[str] = None

    def initialize(self) -> bool:
        """
        Load the Whisper model. Returns True if successful.
        This must be called once during application startup.
        """
        settings = get_settings()
        model_size = settings.whisper_model
        device = settings.whisper_device
        compute_type = settings.whisper_compute_type

        try:
            from faster_whisper import WhisperModel  # type: ignore

            logger.info(f"Loading Whisper model '{model_size}' on device='{device}'...")
            start = time.time()

            # Resolve device/compute_type 'auto' settings
            actual_device = self._resolve_device(device)
            actual_compute_type = self._resolve_compute_type(compute_type, actual_device)

            self._model = WhisperModel(
                model_size,
                device=actual_device,
                compute_type=actual_compute_type,
            )
            self._model_size = model_size
            self._available = True

            elapsed = time.time() - start
            gpu_status = "Available" if actual_device == "cuda" else "Not Available"
            logger.info(f"[STT] Initialization: Whisper model '{model_size}' loaded in {elapsed:.2f}s "
                        f"(device={actual_device}, compute={actual_compute_type}, GPU: {gpu_status})")
            return True

        except ImportError:
            logger.warning("[WARN] faster-whisper is not installed. Run: pip install faster-whisper")
            self._available = False
            return False
        except Exception as e:
            logger.warning(f"[WARN] Failed to load Whisper model '{model_size}': {e}")
            self._available = False
            return False

    def _resolve_device(self, device: str) -> str:
        """Resolve 'auto' device to 'cuda' or 'cpu'."""
        if device == "auto":
            try:
                import torch  # type: ignore
                return "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                return "cpu"
        return device

    def _resolve_compute_type(self, compute_type: str, device: str) -> str:
        """Resolve 'auto' compute type based on device."""
        if compute_type == "auto":
            return "float16" if device == "cuda" else "int8"
        return compute_type

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def model_size(self) -> Optional[str]:
        return self._model_size

    def transcribe(self, audio_path: Path) -> str:
        """
        Transcribe an audio file and return clean text.

        Args:
            audio_path: Path to the audio file.

        Returns:
            Transcribed text string.

        Raises:
            SpeechToTextError: If the service is unavailable or transcription fails.
        """
        if not self._available or self._model is None:
            raise SpeechToTextError(
                "Speech recognition is currently unavailable. "
                "Please check that faster-whisper is installed and the model is loaded."
            )

        if not audio_path.exists():
            raise SpeechToTextError(f"Audio file not found: {audio_path}")

        file_size = audio_path.stat().st_size
        if file_size == 0:
            raise SpeechToTextError("Audio file is empty")

        logger.info(f"[STT] Started: {audio_path.name} ({file_size} bytes)")
        start = time.time()

        try:
            segments, info = self._model.transcribe(
                str(audio_path),
                beam_size=5,
                language="en",
                vad_filter=True,  # Filter out silent sections
                vad_parameters={"min_silence_duration_ms": 500},
            )

            # Collect all segments
            transcript_parts = []
            for segment in segments:
                text = segment.text.strip()
                if text:
                    transcript_parts.append(text)

            transcript = " ".join(transcript_parts).strip()
            elapsed = time.time() - start

            logger.info(f"[STT] Completed: {elapsed:.2f}s")
            logger.info(
                f"[STT] Duration: {elapsed:.2f}s "
                f"(detected language: {info.language}, "
                f"probability: {info.language_probability:.2f})"
            )

            if not transcript:
                logger.warning("Transcription produced empty result")
                return ""

            logger.debug(f"Transcript: {transcript[:100]}{'...' if len(transcript) > 100 else ''}")
            return transcript

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise SpeechToTextError(f"Transcription failed: {str(e)}")


# Module-level singleton
_stt_service = SpeechToTextService()


def get_stt_service() -> SpeechToTextService:
    """Return the shared SpeechToTextService instance."""
    return _stt_service

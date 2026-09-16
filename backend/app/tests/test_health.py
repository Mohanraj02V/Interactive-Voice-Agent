"""
Tests for the health endpoint.
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestHealthEndpoint:
    """Tests for GET /api/health"""

    @patch("app.api.health.get_llm_service")
    @patch("app.api.health.get_stt_service")
    @patch("app.api.health.get_tts_service")
    def test_health_all_available(self, mock_tts, mock_stt, mock_llm):
        """Health endpoint returns ok when all services are available."""
        mock_stt.return_value.is_available = True
        mock_stt.return_value.model_size = "base"
        mock_llm.return_value.check_availability.return_value = True
        mock_llm.return_value.is_available = True
        mock_tts.return_value.is_available = True

        response = client.get("/api/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"
        assert data["whisper"] is True
        assert data["ollama"] is True
        assert data["tts"] is True

    @patch("app.api.health.get_llm_service")
    @patch("app.api.health.get_stt_service")
    @patch("app.api.health.get_tts_service")
    def test_health_services_unavailable(self, mock_tts, mock_stt, mock_llm):
        """Health endpoint still returns 200 when services are unavailable."""
        mock_stt.return_value.is_available = False
        mock_stt.return_value.model_size = None
        mock_llm.return_value.check_availability.return_value = False
        mock_llm.return_value.is_available = False
        mock_tts.return_value.is_available = False

        response = client.get("/api/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"  # Endpoint itself still works
        assert data["whisper"] is False
        assert data["ollama"] is False
        assert data["tts"] is False

    @patch("app.api.health.get_llm_service")
    @patch("app.api.health.get_stt_service")
    @patch("app.api.health.get_tts_service")
    def test_health_response_schema(self, mock_tts, mock_stt, mock_llm):
        """Health response includes all required fields."""
        mock_stt.return_value.is_available = False
        mock_stt.return_value.model_size = None
        mock_llm.return_value.check_availability.return_value = False
        mock_tts.return_value.is_available = False

        response = client.get("/api/health")
        data = response.json()

        assert "status" in data
        assert "ollama" in data
        assert "whisper" in data
        assert "tts" in data

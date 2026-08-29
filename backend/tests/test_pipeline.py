import io
import wave

from fastapi.testclient import TestClient
from voonie.backend.app.core.config import Settings
from voonie.backend.app.main import create_app

client = TestClient(
    create_app(
        Settings(
            DATABASE_URL="sqlite+aiosqlite:///:memory:",
            JWT_SECRET="pipeline-test-secret-that-is-long-enough",
            TESTING=True,
        )
    )
)

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"

def test_web_index():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Voonie" in resp.text

def test_text_generate_comic():
    payload = {
        "text": "今天和朋友在街角喝了热拿铁，阳光照在树叶上很漂亮，感觉身心都被治愈了！",
        "character": {
            "character_name": "小夏",
            "appearance_prompt": "a girl with brown bob hair and oversized sweater",
            "style_preset": "chibi_manga"
        }
    }
    resp = client.post("/api/v1/diaries/text-generate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "title" in data
    assert len(data["panels"]) == 1
    assert data["composite_comic_url"] is None
    assert data["organized_diary"] == payload["text"]
    assert data["panels"][0]["anchor_text"] in data["organized_diary"]
    assert "companion_note" in data
    assert data["emotion"]["mood_score"] >= 1

def test_pet_chat_with_memory():
    payload = {
        "message": "上周我做提拉米苏那天发生了什么？",
        "pet_name": "Voonie",
        "pet_type": "cat"
    }
    resp = client.post("/api/v1/pet/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert data["pet_action"] in ["happy", "comfort", "think", "wave", "sleepy"]

def test_get_memories():
    resp = client.get("/api/v1/pet/memories")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

def test_voice_generate_mock_audio():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\0\0" * 800)
    files = {"audio_file": ("test_voice.wav", buffer.getvalue(), "audio/wav")}
    data = {
        "character_name": "测试员",
        "appearance_prompt": "cute cartoon cat with glasses",
        "style_preset": "chibi_manga"
    }
    resp = client.post("/api/v1/diaries/voice-generate", files=files, data=data)
    assert resp.status_code == 200
    result = resp.json()
    assert len(result["panels"]) == 1
    assert result["title"] != ""


def test_voice_generate_rejects_unsupported_audio():
    response = client.post(
        "/api/v1/diaries/voice-generate",
        files={"audio_file": ("fake.m4a", b"not-audio", "audio/m4a")},
    )
    assert response.status_code == 415

import time
import uuid
from pathlib import Path
from voonie.backend.app.core.config import Settings, settings

class StorageService:
    def __init__(self, app_settings: Settings = settings):
        self.settings = app_settings
        self.base_dir = app_settings.TEMP_MEDIA_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, data: bytes, suffix: str = ".png") -> Path:
        file_id = f"{uuid.uuid4().hex[:12]}_{int(time.time())}{suffix}"
        file_path = self.base_dir / file_id
        with open(file_path, "wb") as f:
            f.write(data)
        return file_path

    def get_file_url(self, file_path: str | Path) -> str:
        path = Path(file_path)
        base_url = self.settings.MEDIA_PUBLIC_BASE.rstrip("/")
        return f"{base_url}/media/{path.name}"

    def delete(self, file_path: str | Path | None) -> bool:
        if not file_path:
            return False
        path = Path(file_path)
        try:
            path.relative_to(self.base_dir)
        except ValueError:
            return False
        if not path.is_file():
            return False
        path.unlink()
        return True

    def cleanup_expired_files(self, referenced_keys: set[str] | None = None) -> int:
        """无痕零沉淀策略：清除超过 TTL 的临时文件"""
        referenced_names = {Path(key).name for key in (referenced_keys or set())}
        now = time.time()
        ttl_seconds = self.settings.TEMP_FILE_TTL_HOURS * 3600
        deleted = 0
        for item in self.base_dir.glob("*"):
            if item.is_file():
                if item.name in referenced_names:
                    continue
                file_age = now - item.stat().st_mtime
                if file_age > ttl_seconds:
                    try:
                        item.unlink()
                        deleted += 1
                    except Exception:
                        pass
        return deleted

storage_service = StorageService()

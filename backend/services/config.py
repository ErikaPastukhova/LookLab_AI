from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_base_url: str = "http://localhost:8000"
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    storage_backend: str = "local"
    storage_local_dir: str = "backend/storage_data"
    storage_local_mount: str = "/storage"

    s3_bucket: str = ""
    s3_region: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_endpoint_url: str = ""
    s3_url_ttl_seconds: int = 900

    tryon_max_upload_mb: int = 10

    ai_provider: str = "mock"
    ai_http_endpoint: str = ""
    ai_http_token: str = ""
    ai_http_timeout_seconds: int = 120


@lru_cache
def get_settings() -> Settings:
    return Settings()

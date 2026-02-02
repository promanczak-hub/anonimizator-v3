"""Anonimizator v3 - Configuration"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database - use SQLite for local dev, PostgreSQL for production
    database_url: str = "sqlite+aiosqlite:///./anonimizator.db"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Google Cloud / Vertex AI
    google_cloud_project: str = "express-handlorz"
    google_cloud_location: str = "europe-west1"
    gemini_model: str = "gemini-2.5-pro"  # Hardcoded as per requirements

    # Storage
    storage_path: str = "./storage"
    watch_folder: str = "./watch"

    # App
    api_prefix: str = "/api"
    debug: bool = True
    max_file_size_mb: int = 30

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()

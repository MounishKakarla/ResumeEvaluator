import logging
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./resume_eval.db"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    refresh_token_expire_days: int = 7

    cosine_match_threshold: float = 0.70
    cosine_strong_threshold: float = 0.85
    simhash_duplicate_threshold: int = 3

    default_weight_projects: int = 50
    default_weight_skills: int = 30
    default_weight_education: int = 20

    embedding_model: str = "all-MiniLM-L6-v2"
    upload_dir: str = "./uploads"
    max_upload_mb: int = 20

    # CORS — comma-separated list of allowed origins (e.g. "https://app.example.com")
    # Defaults to localhost dev origins; override in production.
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

    # SMTP outbound email
    smtp_server: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    app_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"

    # IMAP email ingestion (leave imap_host blank to disable)
    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""
    imap_ssl: bool = True
    imap_poll_interval: int = 60
    # Folder to monitor — use "INBOX" for the main inbox or a sub-folder like "Applications"
    imap_folder: str = "INBOX"
    # Comma-separated subject keywords; only emails whose subject contains at least one
    # keyword will be processed.  Leave empty ("") to accept all emails (no filter).
    imap_subject_keywords: str = "resume,cv,application,applying,job application,position,candidate"

    # GitHub API token — optional but recommended; raises rate limit from 60 to 5000 req/hr
    github_token: str = ""

    # LLM integration
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout: int = 30

    # Logging
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        extra = "ignore"

    @field_validator("secret_key")
    @classmethod
    def secret_key_must_not_be_default(cls, v: str) -> str:
        if v == "change-me-in-production":
            logging.getLogger(__name__).warning(
                "SECRET_KEY is set to the insecure default. "
                "Set SECRET_KEY env var to a random 32+ character string."
            )
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def validate_production(self) -> None:
        """Log warnings for missing or insecure production configuration."""
        logger = logging.getLogger(__name__)
        if "sqlite" in self.database_url:
            logger.warning(
                "DATABASE_URL is SQLite — not suitable for production. "
                "Set DATABASE_URL to a PostgreSQL connection string."
            )
        if self.secret_key == "change-me-in-production":
            logger.error("SECRET_KEY is insecure. Set SECRET_KEY env var before deploying.")
        if self.max_upload_mb <= 0:
            raise ValueError(f"MAX_UPLOAD_MB must be positive, got {self.max_upload_mb}")


settings = Settings()

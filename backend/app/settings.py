from dataclasses import dataclass
from pathlib import Path
import os

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", 'sqlite:///' + (PROJECT_ROOT / 'data-workbench.db').as_posix())
    snapshot_root: Path = Path(os.getenv("SNAPSHOT_ROOT", str(PROJECT_ROOT / 'data/snapshots')))
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
    max_result_rows: int = int(os.getenv("MAX_RESULT_ROWS", "10000"))
    query_timeout_seconds: int = int(os.getenv('QUERY_TIMEOUT_SECONDS', '30'))
    max_concurrent_queries: int = int(os.getenv('MAX_CONCURRENT_QUERIES', '2'))
    dataset_root: Path = Path(os.getenv('DATASET_ROOT', str(PROJECT_ROOT / 'datasets')))
    report_root: Path = Path(os.getenv('REPORT_ROOT', str(PROJECT_ROOT / 'reports')))
    secret_key_file: Path = Path(os.getenv('SECRET_KEY_FILE', str(PROJECT_ROOT / 'data/secret.key')))
    dynamic_max_rows: int = int(os.getenv('DYNAMIC_MAX_ROWS', '1000000'))
    dynamic_timeout_seconds: int = int(os.getenv('DYNAMIC_TIMEOUT_SECONDS', '300'))


settings = Settings()


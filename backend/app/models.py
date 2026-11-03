from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def new_id() -> str:
    return str(uuid4())


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255))
    current_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class DatasetSnapshot(Base):
    __tablename__ = "dataset_snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"))
    schema_json: Mapped[list] = mapped_column(JSON)
    row_count: Mapped[int] = mapped_column(Integer)
    storage_uri: Mapped[str] = mapped_column(String(1000), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="SUCCEEDED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Dashboard(Base):
    __tablename__ = 'dashboards'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255))
    document: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)


class UserProfile(Base):
    __tablename__ = 'user_profile'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    display_name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), default='')
    avatar: Mapped[str] = mapped_column(String, default='')


class PublishedDashboard(Base):
    __tablename__ = 'published_dashboards'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    document: Mapped[dict] = mapped_column(JSON)
    theme: Mapped[dict] = mapped_column(JSON)


class ChartComment(Base):
    __tablename__ = 'chart_comments'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dashboard_id: Mapped[str] = mapped_column(String(36), index=True)
    chart_id: Mapped[str] = mapped_column(String(36), index=True)
    author: Mapped[str] = mapped_column(String(255))
    author_id: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    avatar: Mapped[str] = mapped_column(String, default='')
    content: Mapped[str] = mapped_column(String(5000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

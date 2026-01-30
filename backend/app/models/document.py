"""Document model - Document library metadata"""

from sqlmodel import SQLModel, Field
from datetime import datetime
from uuid import UUID, uuid4
from typing import Optional


class DocumentBase(SQLModel):
    """Base document fields"""

    display_name: Optional[str] = Field(default=None)
    description: Optional[str] = Field(default=None)
    tags: Optional[str] = Field(default=None, description="Comma-separated tags")


class Document(DocumentBase, table=True):
    """Document database model for library"""

    __tablename__ = "documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    original_filename: str = Field(default="")
    mode: str = Field(default="unify")
    status: str = Field(default="queued")

    page_count: int = Field(default=0)
    file_size: int = Field(default=0)

    # Storage paths
    input_path: Optional[str] = Field(default=None)
    output_pdf_path: Optional[str] = Field(default=None)
    output_json_path: Optional[str] = Field(default=None)
    audit_path: Optional[str] = Field(default=None)
    annotations_path: Optional[str] = Field(default=None)
    thumbnail_path: Optional[str] = Field(default=None)

    # Metadata
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    policy_preset: str = Field(default="default")

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = Field(default=None)

    # Retention
    pinned: bool = Field(default=False, description="Prevent auto-deletion")
    expires_at: Optional[datetime] = Field(default=None)


class DocumentResponse(DocumentBase):
    """Schema for document response"""

    id: UUID
    original_filename: str
    mode: str
    status: str
    page_count: int
    file_size: int
    confidence: float
    created_at: datetime
    completed_at: Optional[datetime]
    thumbnail_path: Optional[str]
    pinned: bool


class DocumentUpdate(SQLModel):
    """Schema for updating document"""

    display_name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None
    pinned: Optional[bool] = None

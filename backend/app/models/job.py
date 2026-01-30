"""Job model - Processing job for document anonymization"""

from sqlmodel import SQLModel, Field
from datetime import datetime
from uuid import UUID, uuid4
from typing import Literal, Optional
from pydantic import BaseModel


class JobBase(SQLModel):
    """Base job fields"""

    mode: str = Field(
        default="unify",
        description="Processing mode: unify (Mode A) or layout (Mode B)",
    )
    policy_preset: str = Field(
        default="default", description="Anonymization policy preset"
    )
    pricing_strategy: str = Field(default="final_only")
    description: Optional[str] = Field(default=None)
    tags: Optional[str] = Field(default=None, description="Comma-separated tags")


class Job(JobBase, table=True):
    """Job database model"""

    __tablename__ = "jobs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    document_id: Optional[UUID] = Field(default=None, foreign_key="documents.id")

    status: str = Field(default="queued")
    progress: int = Field(default=0, ge=0, le=100)

    original_filename: str = Field(default="")
    page_count: int = Field(default=0)
    file_size: int = Field(default=0)

    # Storage paths (relative to storage root)
    input_path: Optional[str] = Field(default=None)
    output_pdf_path: Optional[str] = Field(default=None)
    output_json_path: Optional[str] = Field(default=None)
    audit_path: Optional[str] = Field(default=None)

    # AI results (stored as JSON strings)
    sections_json: Optional[str] = Field(default=None)
    findings_json: Optional[str] = Field(default=None)
    digital_twin_json: Optional[str] = Field(default=None)

    # User decisions (stored as JSON string)
    decisions_json: Optional[str] = Field(default=None)

    # Global confidence from AI analysis
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    error_message: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = Field(default=None)


class JobCreate(JobBase):
    """Schema for creating a job"""

    pass


class JobResponse(JobBase):
    """Schema for job response"""

    id: UUID
    status: str
    progress: int
    original_filename: str
    page_count: int
    confidence: float
    created_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]


# Fiszki (Verification Cards) schemas
class Fiszka(BaseModel):
    """Single verification card"""

    id: str
    category: Literal[
        "personal",
        "contact",
        "dealer",
        "discount",
        "finance",
        "trade_in",
        "legal",
        "notes",
    ]
    label: str
    description: str
    risk_level: Literal["HIGH", "MEDIUM", "LOW"]
    default_action: Literal["remove", "mask", "keep"]
    items_count: int = 0
    confidence: float = 0.0


class Finding(BaseModel):
    """Single detected sensitive item"""

    id: str
    category: str
    label: str
    value_preview: str  # First 20 chars only
    page: int
    bbox: dict  # {"x": 0, "y": 0, "w": 100, "h": 20}
    confidence: float
    suggested_action: Literal["remove", "mask", "keep"]


class Section(BaseModel):
    """Document section"""

    id: str
    title: str
    category: str
    page_range: list[int]
    confidence: float


class UserDecision(BaseModel):
    """User's decision for a finding or section"""

    item_id: str
    item_type: Literal["finding", "section", "page"]
    action: Literal["remove", "mask", "keep"]


class UserDecisions(BaseModel):
    """Batch of user decisions"""

    decisions: list[UserDecision]
    notes: Optional[str] = None
    annotations: Optional[list[dict]] = None


# Default fiszki configuration
DEFAULT_FISZKI = [
    Fiszka(
        id="personal",
        category="personal",
        label="Dane osobowe",
        description="Imiona, nazwiska, podpisy",
        risk_level="HIGH",
        default_action="remove",
    ),
    Fiszka(
        id="contact",
        category="contact",
        label="Dane kontaktowe",
        description="Telefony, emaile, adresy",
        risk_level="HIGH",
        default_action="remove",
    ),
    Fiszka(
        id="dealer",
        category="dealer",
        label="Dealer / salon / logo",
        description="Nazwa dealera, logo, NIP/REGON",
        risk_level="HIGH",
        default_action="remove",
    ),
    Fiszka(
        id="discount",
        category="discount",
        label="Rabaty / upusty",
        description="Rabaty, promocje, indywidualne warunki",
        risk_level="HIGH",
        default_action="remove",
    ),
    Fiszka(
        id="finance",
        category="finance",
        label="Finansowanie / leasing",
        description="Warunki leasingu, raty, finansowanie",
        risk_level="MEDIUM",
        default_action="keep",
    ),
    Fiszka(
        id="trade_in",
        category="trade_in",
        label="Trade-in / odkup",
        description="Wycena pojazdu używanego, warunki odkupu",
        risk_level="MEDIUM",
        default_action="keep",
    ),
    Fiszka(
        id="legal",
        category="legal",
        label="Stopki / RODO",
        description="Stopki prawne, klauzule RODO",
        risk_level="LOW",
        default_action="keep",
    ),
    Fiszka(
        id="notes",
        category="notes",
        label="Notatki handlowca",
        description="Odręczne notatki, komentarze sprzedawcy",
        risk_level="HIGH",
        default_action="remove",
    ),
]

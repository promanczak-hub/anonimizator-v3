"""Digital Twin schema - Pydantic models for unified document output"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class VehicleInfo(BaseModel):
    """Vehicle basic information"""

    brand: Optional[str] = None
    model: Optional[str] = None
    version: Optional[str] = None
    year: Optional[int] = None
    vin: Optional[str] = None
    body_type: Optional[str] = None
    color: Optional[str] = None
    mileage_km: Optional[int] = None


class PowertrainInfo(BaseModel):
    """Powertrain specifications"""

    engine_type: Optional[str] = None  # ICE, HEV, PHEV, BEV
    engine_name: Optional[str] = None
    fuel_type: Optional[str] = None
    displacement_cc: Optional[int] = None
    power_hp: Optional[int] = None
    power_kw: Optional[int] = None
    torque_nm: Optional[int] = None
    transmission: Optional[str] = None
    drivetrain: Optional[str] = None
    battery_kwh: Optional[float] = None  # For EV/PHEV
    range_km: Optional[int] = None  # WLTP range


class EquipmentInfo(BaseModel):
    """Equipment and options"""

    packages: list[str] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    standard_features: list[str] = Field(default_factory=list)
    safety: list[str] = Field(default_factory=list)
    comfort: list[str] = Field(default_factory=list)
    multimedia: list[str] = Field(default_factory=list)
    exterior: list[str] = Field(default_factory=list)
    interior: list[str] = Field(default_factory=list)


class DimensionsInfo(BaseModel):
    """Vehicle dimensions"""

    length_mm: Optional[int] = None
    width_mm: Optional[int] = None
    height_mm: Optional[int] = None
    wheelbase_mm: Optional[int] = None
    boot_capacity_l: Optional[int] = None
    curb_weight_kg: Optional[int] = None
    gross_weight_kg: Optional[int] = None


class PricingInfo(BaseModel):
    """Pricing information (sanitized)"""

    list_price: Optional[float] = None
    final_price: Optional[float] = None
    currency: str = "PLN"
    tax_type: str = "VAT"
    discounts_removed: bool = True
    pricing_strategy: str = "final_only"  # final_only | msrp_only


class AvailabilityInfo(BaseModel):
    """Availability status"""

    status: Optional[str] = None  # available, incoming, sold
    delivery_time: Optional[str] = None
    location_general: Optional[str] = None  # City/region only


class ImageInfo(BaseModel):
    """Image reference"""

    id: str
    source_page: int
    role: str = "gallery"  # hero, gallery
    file_path: Optional[str] = None
    confidence: float = 0.0


class SectionInfo(BaseModel):
    """Extracted section"""

    id: str
    title: str
    category: str
    content_md: Optional[str] = None
    source_pages: list[int] = Field(default_factory=list)
    confidence: float = 0.0


class RedactionInfo(BaseModel):
    """Redaction record"""

    category: str
    reason: str
    source_pages: list[int] = Field(default_factory=list)
    items_count: int = 0


class ProvenanceInfo(BaseModel):
    """Field provenance for auditability"""

    field_path: str
    source_page: int
    evidence_snippet: str
    confidence: float


class AuditAction(BaseModel):
    """Single audit action"""

    action_type: str  # mask, remove_section, remove_page, edit_field, extract
    target: str
    before: Optional[str] = None
    after: Optional[str] = None
    user_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DigitalTwin(BaseModel):
    """Complete Digital Twin schema for Mode A output"""

    # Metadata
    source_file: str
    processed_at: datetime = Field(default_factory=datetime.utcnow)
    mode: str = "unify"
    confidence: float = 0.0

    # Vehicle data
    vehicle: VehicleInfo = Field(default_factory=VehicleInfo)
    powertrain: PowertrainInfo = Field(default_factory=PowertrainInfo)
    equipment: EquipmentInfo = Field(default_factory=EquipmentInfo)
    dimensions: DimensionsInfo = Field(default_factory=DimensionsInfo)
    pricing: PricingInfo = Field(default_factory=PricingInfo)
    availability: AvailabilityInfo = Field(default_factory=AvailabilityInfo)

    # Content
    images: list[ImageInfo] = Field(default_factory=list)
    sections: list[SectionInfo] = Field(default_factory=list)

    # Anonymization
    removed_sections: list[RedactionInfo] = Field(default_factory=list)

    # Audit
    provenance: list[ProvenanceInfo] = Field(default_factory=list)
    audit: list[AuditAction] = Field(default_factory=list)

    # User annotations
    annotations: list[dict] = Field(default_factory=list)
    notes: Optional[str] = None

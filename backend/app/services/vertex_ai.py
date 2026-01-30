"""Vertex AI Service - Gemini 2.5 Pro integration for document analysis"""

import vertexai
from vertexai.generative_models import GenerativeModel, Part
import instructor
from pydantic import BaseModel
from typing import Optional
import base64
import json

from app.config import get_settings
from app.models.digital_twin import DigitalTwin

settings = get_settings()

# Initialize Vertex AI
vertexai.init(
    project=settings.google_cloud_project,
    location=settings.google_cloud_location,
)


class SectionDetection(BaseModel):
    """Schema for section detection response"""

    id: str
    title: str
    category: str  # vehicle_info, equipment, pricing, financing, trade_in, contact, legal, other
    page_range: list[int]
    confidence: float


class SectionsResponse(BaseModel):
    """Schema for sections detection"""

    document_type: str  # offer, specification, price_list, other
    sections: list[SectionDetection]


class FindingDetection(BaseModel):
    """Schema for sensitive data finding"""

    id: str
    category: (
        str  # personal, contact, dealer, discount, finance, trade_in, legal, notes
    )
    label: str
    value_preview: str
    page: int
    bbox: dict  # {"x": 0, "y": 0, "w": 100, "h": 20}
    confidence: float
    suggested_action: str  # remove, mask, keep


class FindingsResponse(BaseModel):
    """Schema for findings detection"""

    findings: list[FindingDetection]


class VertexAIService:
    """Service for Gemini 2.5 Pro document analysis"""

    def __init__(self):
        self.model = GenerativeModel(settings.gemini_model)

    def _image_to_part(self, image_bytes: bytes, mime_type: str = "image/png") -> Part:
        """Convert image bytes to Vertex AI Part"""
        return Part.from_data(image_bytes, mime_type)

    async def detect_sections(self, pages_images: list[bytes]) -> SectionsResponse:
        """
        Detect document sections and classify document type.

        Prompt Contract A: Classification & Sections
        """
        prompt = """You are a document analysis expert. Analyze this automotive offer/specification document.

Identify all sections and classify the document type.

Output JSON with this exact schema:
{
  "document_type": "offer" | "specification" | "price_list" | "other",
  "sections": [
    {
      "id": "unique_string",
      "title": "Section title as it appears",
      "category": "vehicle_info" | "equipment" | "pricing" | "financing" | "trade_in" | "contact" | "legal" | "other",
      "page_range": [start_page, end_page],
      "confidence": 0.0-1.0
    }
  ]
}

Categories guide:
- vehicle_info: Brand, model, specs, powertrain
- equipment: Options, packages, features
- pricing: Prices, fees (NOT discounts)
- financing: Leasing, loans, monthly payments
- trade_in: Vehicle exchange offers
- contact: Dealer info, salesperson, contact details
- legal: RODO, terms, legal notices

Be thorough - list ALL sections found in the document."""

        # Build content with all page images
        content = [prompt]
        for i, img_bytes in enumerate(pages_images):
            content.append(Part.from_data(img_bytes, "image/png"))

        response = self.model.generate_content(content)

        # Parse JSON response
        try:
            response_text = response.text
            # Extract JSON from response
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]

            data = json.loads(response_text)
            return SectionsResponse(**data)
        except Exception as e:
            # Return empty response on parse error
            return SectionsResponse(document_type="other", sections=[])

    async def detect_sensitive_data(
        self, pages_images: list[bytes]
    ) -> FindingsResponse:
        """
        Detect sensitive information for anonymization.

        Prompt Contract B: Sensitive Data Detection
        """
        prompt = """Detect all sensitive information in this automotive document that should be anonymized.

Categories to detect:
- personal: Names, signatures, personal identifiers
- contact: Phone numbers, email addresses, physical addresses
- dealer: Dealer/salon name, logo, NIP/REGON, company identifiers
- discount: Rabaty, promocje, individual pricing conditions, upusty
- finance: Leasing terms, monthly payments, financing details
- trade_in: Vehicle valuation, trade-in offers
- legal: RODO notices, legal disclaimers
- notes: Handwritten notes, seller comments

For each finding, provide bbox coordinates as percentages of page (0-100).

Output JSON:
{
  "findings": [
    {
      "id": "finding_001",
      "category": "personal" | "contact" | "dealer" | "discount" | "finance" | "trade_in" | "legal" | "notes",
      "label": "Short label, e.g. 'Email', 'Dealer Name', 'Discount %'",
      "value_preview": "First 20 characters only",
      "page": 1,
      "bbox": {"x": 10, "y": 20, "w": 30, "h": 5},
      "confidence": 0.95,
      "suggested_action": "remove" | "mask" | "keep"
    }
  ]
}

Suggested action guide:
- remove: Personal data, dealer names, discounts (HIGH risk)
- mask: Contact info, some financial details (MEDIUM risk)
- keep: Legal notices, general terms (LOW risk)

Be exhaustive - find ALL sensitive items."""

        content = [prompt]
        for i, img_bytes in enumerate(pages_images):
            content.append(Part.from_data(img_bytes, "image/png"))

        response = self.model.generate_content(content)

        try:
            response_text = response.text
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]

            data = json.loads(response_text)
            return FindingsResponse(**data)
        except Exception as e:
            return FindingsResponse(findings=[])

    async def extract_digital_twin(
        self, pages_images: list[bytes], filename: str
    ) -> DigitalTwin:
        """
        Extract full Digital Twin data (Mode A only).

        Prompt Contract C: Digital Twin Extraction
        """
        prompt = """Extract structured vehicle data from this automotive offer document to create a Digital Twin.

Extract the following information:

VEHICLE:
- brand, model, version/trim
- year, body_type (sedan/hatchback/SUV/etc)
- color, mileage (if used vehicle)

POWERTRAIN:
- engine_type: ICE, HEV, PHEV, or BEV
- fuel_type, displacement_cc
- power_hp, power_kw, torque_nm
- transmission (manual/automatic), drivetrain (FWD/RWD/AWD)
- battery_kwh (for EV/PHEV), range_km (WLTP)

EQUIPMENT:
- packages (named option packages)
- options (individual options)
- standard_features, safety, comfort, multimedia, exterior, interior

DIMENSIONS (if available):
- length_mm, width_mm, height_mm, wheelbase_mm
- boot_capacity_l, curb_weight_kg

PRICING:
- list_price and/or final_price
- currency (default PLN)
- Do NOT include discounts - set discounts_removed: true

AVAILABILITY:
- status (available/incoming/sold)
- delivery_time, location (city/region only, no dealer name)

IMAGES:
- List images found with page number and role (hero/gallery)

Output as JSON matching the DigitalTwin schema. For each extracted field, only include if found with reasonable confidence.
If a field cannot be determined, omit it or use null."""

        content = [prompt]
        for i, img_bytes in enumerate(pages_images):
            content.append(Part.from_data(img_bytes, "image/png"))

        response = self.model.generate_content(content)

        try:
            response_text = response.text
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]

            data = json.loads(response_text)

            # Create DigitalTwin with extracted data
            twin = DigitalTwin(
                source_file=filename,
                mode="unify",
            )

            # Populate from response
            if "vehicle" in data:
                for key, value in data["vehicle"].items():
                    if hasattr(twin.vehicle, key):
                        setattr(twin.vehicle, key, value)

            if "powertrain" in data:
                for key, value in data["powertrain"].items():
                    if hasattr(twin.powertrain, key):
                        setattr(twin.powertrain, key, value)

            if "equipment" in data:
                for key, value in data["equipment"].items():
                    if hasattr(twin.equipment, key) and isinstance(value, list):
                        setattr(twin.equipment, key, value)

            if "pricing" in data:
                for key, value in data["pricing"].items():
                    if hasattr(twin.pricing, key):
                        setattr(twin.pricing, key, value)

            if "dimensions" in data:
                for key, value in data["dimensions"].items():
                    if hasattr(twin.dimensions, key):
                        setattr(twin.dimensions, key, value)

            if "availability" in data:
                for key, value in data["availability"].items():
                    if hasattr(twin.availability, key):
                        setattr(twin.availability, key, value)

            return twin

        except Exception as e:
            # Return minimal twin on error
            return DigitalTwin(source_file=filename, mode="unify", confidence=0.0)


# Singleton instance
vertex_ai_service = VertexAIService()

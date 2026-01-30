"""PDF Processor Service - PDF rendering and manipulation"""

import pypdfium2 as pdfium
from pathlib import Path
from PIL import Image
import io
from typing import Optional
import fitz  # PyMuPDF

from app.config import get_settings

settings = get_settings()


class PDFProcessor:
    """Service for PDF processing, rendering, and manipulation"""

    def __init__(self, pdf_path: str | Path):
        self.pdf_path = Path(pdf_path)
        self._pdf = None
        self._fitz_doc = None

    def __enter__(self):
        self._pdf = pdfium.PdfDocument(str(self.pdf_path))
        self._fitz_doc = fitz.open(str(self.pdf_path))
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._pdf:
            self._pdf.close()
        if self._fitz_doc:
            self._fitz_doc.close()

    @property
    def page_count(self) -> int:
        """Get number of pages in PDF"""
        return len(self._pdf)

    def is_scanned(self) -> bool:
        """
        Detect if PDF is scanned (image-based) or text-based.
        Heuristic: less than 50 chars per page on average = scanned
        """
        total_text = 0
        for page in self._fitz_doc:
            total_text += len(page.get_text())
        avg_chars = total_text / len(self._fitz_doc) if len(self._fitz_doc) > 0 else 0
        return avg_chars < 50

    def render_page(self, page_num: int, dpi: int = 300) -> bytes:
        """
        Render a single page to PNG bytes.

        Args:
            page_num: Page number (0-indexed)
            dpi: Resolution in DPI (default 300 for high quality)

        Returns:
            PNG image as bytes
        """
        page = self._pdf[page_num]
        scale = dpi / 72  # PDF default is 72 DPI
        bitmap = page.render(scale=scale)
        pil_image = bitmap.to_pil()

        # Convert to PNG bytes
        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG")
        return buffer.getvalue()

    def render_thumbnail(self, page_num: int, max_width: int = 2480) -> bytes:
        """
        Render a thumbnail for a page.

        Args:
            page_num: Page number (0-indexed)
            max_width: Maximum width in pixels (2480 = A4 at 300 DPI)

        Returns:
            PNG thumbnail as bytes
        """
        page = self._pdf[page_num]

        # Calculate scale for thumbnail
        width, height = page.get_size()
        scale = max_width / width

        bitmap = page.render(scale=scale)
        pil_image = bitmap.to_pil()

        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()

    def extract_text(self, page_num: Optional[int] = None) -> str:
        """
        Extract text from PDF.

        Args:
            page_num: Specific page (0-indexed) or None for all pages

        Returns:
            Extracted text
        """
        if page_num is not None:
            return self._fitz_doc[page_num].get_text()

        text = ""
        for page in self._fitz_doc:
            text += page.get_text() + "\n\n"
        return text

    def render_all_pages(self, output_dir: Path, dpi: int = 300) -> list[Path]:
        """
        Render all pages to PNG files.

        Args:
            output_dir: Directory to save images
            dpi: Resolution in DPI

        Returns:
            List of output file paths
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []

        for i in range(len(self._pdf)):
            img_bytes = self.render_page(i, dpi)
            output_path = output_dir / f"page_{i}.png"
            output_path.write_bytes(img_bytes)
            paths.append(output_path)

        return paths

    def generate_thumbnails(self, output_dir: Path) -> list[Path]:
        """
        Generate thumbnails for all pages.

        Args:
            output_dir: Directory to save thumbnails

        Returns:
            List of thumbnail paths
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []

        for i in range(len(self._pdf)):
            thumb_bytes = self.render_thumbnail(i)
            output_path = output_dir / f"page_{i}.png"
            output_path.write_bytes(thumb_bytes)
            paths.append(output_path)

        return paths


class PDFAnonymizer:
    """Service for PDF redaction and anonymization"""

    def __init__(self, pdf_path: str | Path):
        self.pdf_path = Path(pdf_path)
        self.doc = fitz.open(str(pdf_path))
        self.redactions = []

    def add_redaction(
        self,
        page_num: int,
        bbox: dict,
        action: str = "mask",
        fill_color: tuple = (0, 0, 0),  # Black
    ):
        """
        Add a redaction to the document.

        Args:
            page_num: Page number (0-indexed)
            bbox: {"x": 0, "y": 0, "w": 100, "h": 20} as percentages
            action: "mask" (black box) or "remove" (white box)
            fill_color: RGB tuple (0-1 range)
        """
        page = self.doc[page_num]
        page_rect = page.rect

        # Convert percentage bbox to absolute coordinates
        x = bbox["x"] / 100 * page_rect.width
        y = bbox["y"] / 100 * page_rect.height
        w = bbox["w"] / 100 * page_rect.width
        h = bbox["h"] / 100 * page_rect.height

        rect = fitz.Rect(x, y, x + w, y + h)

        if action == "remove":
            fill_color = (1, 1, 1)  # White

        self.redactions.append(
            {
                "page": page_num,
                "rect": rect,
                "fill": fill_color,
            }
        )

    def remove_page(self, page_num: int):
        """Mark page for removal"""
        self.redactions.append(
            {
                "page": page_num,
                "delete": True,
            }
        )

    def apply_redactions(self, output_path: Path) -> Path:
        """
        Apply all redactions and save to output file.

        Args:
            output_path: Path for the redacted PDF

        Returns:
            Path to the output file
        """
        # First, apply visual redactions
        for redaction in self.redactions:
            if redaction.get("delete"):
                continue

            page = self.doc[redaction["page"]]
            page.add_redact_annot(
                redaction["rect"],
                fill=redaction["fill"],
            )
            page.apply_redactions()

        # Then, delete pages (in reverse order to maintain indices)
        pages_to_delete = sorted(
            [r["page"] for r in self.redactions if r.get("delete")], reverse=True
        )
        for page_num in pages_to_delete:
            self.doc.delete_page(page_num)

        # Save
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(str(output_path))

        return output_path

    def close(self):
        """Close the document"""
        self.doc.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

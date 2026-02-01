"""Jobs API - Processing job endpoints"""

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    Body,
    Depends,
    HTTPException,
    BackgroundTasks,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from uuid import UUID
from datetime import datetime
from pathlib import Path
import json
import aiofiles
import os

from app.database import get_session
from app.config import get_settings
from app.models.job import (
    Job,
    JobCreate,
    JobResponse,
    Fiszka,
    Finding,
    Section,
    UserDecisions,
    DEFAULT_FISZKI,
)
from app.workers.tasks import process_document

router = APIRouter()
settings = get_settings()


@router.post("", response_model=JobResponse)
async def create_job(
    file: UploadFile = File(...),
    mode: str = Form("unify"),
    policy_preset: str = Form("default"),
    pricing_strategy: str = Form("final_only"),
    description: str = Form(None),
    tags: str = Form(None),
    background_tasks: BackgroundTasks = None,
    session: AsyncSession = Depends(get_session),
):
    """
    Create a new document processing job.

    - **file**: PDF file to process
    - **mode**: "unify" (Mode A - full extraction) or "layout" (Mode B - in-place redaction)
    - **policy_preset**: Anonymization policy preset (default, leasing, fleet, tender)
    - **pricing_strategy**: "final_only" or "msrp_only"
    """
    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    max_size_bytes = settings.max_file_size_mb * 1024 * 1024
    if file.size is not None and file.size > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Plik za duży: {file.size / (1024 * 1024):.1f}MB (max {settings.max_file_size_mb}MB)",
        )

    content = await file.read()
    file_size = len(content)
    if file_size > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Plik za duży: {file_size / (1024 * 1024):.1f}MB (max {settings.max_file_size_mb}MB)",
        )

    # Create job
    job = Job(
        mode=mode,
        policy_preset=policy_preset,
        pricing_strategy=pricing_strategy,
        description=description,
        tags=tags,
        original_filename=file.filename,
        file_size=file_size,
        status="queued",
    )

    # Save to database
    session.add(job)
    await session.commit()
    await session.refresh(job)

    # Save uploaded file
    storage_dir = Path(settings.storage_path) / "inputs" / str(job.id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    input_path = storage_dir / file.filename

    async with aiofiles.open(input_path, "wb") as f:
        await f.write(content)

    # Update job with file path
    job.input_path = str(input_path.relative_to(settings.storage_path))
    await session.commit()

    # Trigger async processing
    process_document.delay(str(job.id))

    return job


@router.get("/{job_id}", response_model=dict)
async def get_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Get job status and results"""
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "mode": job.mode,
        "original_filename": job.original_filename,
        "page_count": job.page_count,
        "confidence": job.confidence,
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }

    # Add thumbnails path
    if job.input_path:
        thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
        if thumbnails_dir.exists():
            result["thumbnails"] = [
                f"/api/jobs/{job_id}/thumbnail/{i}" for i in range(job.page_count)
            ]

    # Add analysis results if available
    if job.sections_json:
        result["sections"] = json.loads(job.sections_json)

    if job.findings_json:
        result["findings"] = json.loads(job.findings_json)

    # Add fiszki with counts
    if job.findings_json:
        findings = json.loads(job.findings_json)
        fiszki = []
        for f in DEFAULT_FISZKI:
            f_copy = f.model_copy()
            f_copy.items_count = len(
                [item for item in findings if item.get("category") == f.category]
            )
            # Calculate average confidence for category
            cat_items = [
                item for item in findings if item.get("category") == f.category
            ]
            if cat_items:
                f_copy.confidence = sum(
                    item.get("confidence", 0) for item in cat_items
                ) / len(cat_items)
            fiszki.append(f_copy.model_dump())
        result["fiszki"] = fiszki
    else:
        result["fiszki"] = [f.model_dump() for f in DEFAULT_FISZKI]

    return result


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Retry a failed or stuck job by re-queuing it for processing"""
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Only allow retry for stuck/failed jobs
    if job.status in ("done", "queued"):
        raise HTTPException(
            status_code=400, detail=f"Job is already {job.status}, cannot retry"
        )

    # Reset job status and re-queue
    job.status = "queued"
    job.progress = 0
    job.error_message = None
    await session.commit()

    # Re-trigger processing
    process_document.delay(str(job.id))

    return {"message": "Job re-queued for processing", "job_id": str(job.id)}


@router.get("/{job_id}/thumbnail/{page}")
async def get_thumbnail(
    job_id: UUID,
    page: int,
    session: AsyncSession = Depends(get_session),
):
    """Get thumbnail image for a specific page"""
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    thumbnail_path = (
        Path(settings.storage_path) / "thumbnails" / str(job.id) / f"page_{page}.png"
    )

    # Generate thumbnail on-the-fly if not exists
    if not thumbnail_path.exists():
        # Get PDF path
        pdf_path = (
            Path(settings.storage_path) / "inputs" / str(job.id) / job.original_filename
        )
        if not pdf_path.exists():
            raise HTTPException(status_code=404, detail="PDF not found")

        # Create thumbnails directory
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

        # Generate thumbnail using context manager
        from app.services.pdf_processor import PDFProcessor

        with PDFProcessor(pdf_path) as processor:
            thumb_bytes = processor.render_thumbnail(page)
            with open(thumbnail_path, "wb") as f:
                f.write(thumb_bytes)

    return FileResponse(thumbnail_path, media_type="image/png")


@router.get("/{job_id}/text-blocks")
async def get_text_blocks(
    job_id: UUID,
    page: int = None,
    session: AsyncSession = Depends(get_session),
):
    """
    Get text blocks with bounding boxes for text selection.

    Returns list of text blocks with their positions for rendering
    text selection overlay in frontend.
    """
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    input_path = Path(settings.storage_path) / job.input_path
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")

    import fitz

    doc = fitz.open(str(input_path))

    result = {"pages": []}

    pages_to_process = range(len(doc)) if page is None else [page]

    # Get text and image blocks
    # fitz.TextPage.extractDICT returns blocks with "type": 0 (text) or 1 (image)
    for page_num in pages_to_process:
        if page_num >= len(doc):
            continue

        pdf_page = doc[page_num]
        page_rect = pdf_page.rect
        blocks = pdf_page.get_text("dict")["blocks"]

        page_data = {
            "page": page_num,
            "width": page_rect.width,
            "height": page_rect.height,
            "blocks": [],
        }

        for block in blocks:
            b_type = block.get("type", 0)
            bbox = block.get("bbox", [])

            if len(bbox) < 4:
                continue

            # Normalized bbox (0-100%)
            norm_bbox = {
                "x": bbox[0] / page_rect.width * 100,
                "y": bbox[1] / page_rect.height * 100,
                "w": (bbox[2] - bbox[0]) / page_rect.width * 100,
                "h": (bbox[3] - bbox[1]) / page_rect.height * 100,
            }

            if b_type == 0:  # Text
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if not text:
                            continue

                        span_bbox = span.get("bbox", [])
                        if len(span_bbox) >= 4:
                            page_data["blocks"].append(
                                {
                                    "type": "text",
                                    "text": text,
                                    "bbox": {
                                        "x": span_bbox[0] / page_rect.width * 100,
                                        "y": span_bbox[1] / page_rect.height * 100,
                                        "w": (span_bbox[2] - span_bbox[0])
                                        / page_rect.width
                                        * 100,
                                        "h": (span_bbox[3] - span_bbox[1])
                                        / page_rect.height
                                        * 100,
                                    },
                                    "font_size": span.get("size", 12),
                                }
                            )

            elif b_type == 1:  # Image
                page_data["blocks"].append(
                    {
                        "type": "image",
                        "text": "[IMAGE]",
                        "bbox": norm_bbox,
                        "font_size": 0,
                    }
                )

        result["pages"].append(page_data)

    doc.close()
    return result


@router.post("/{job_id}/decisions")
async def submit_decisions(
    job_id: UUID,
    decisions: UserDecisions,
    session: AsyncSession = Depends(get_session),
):
    """
    Submit user decisions for findings/sections.

    Each decision specifies an item and the action to take (remove/mask/keep).
    """
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Save decisions
    job.decisions_json = decisions.model_dump_json()
    job.updated_at = datetime.utcnow()
    await session.commit()

    return {"status": "ok", "decisions_count": len(decisions.decisions)}


@router.post("/{job_id}/text-replace")
async def text_replace(
    job_id: UUID,
    replacements: list = [],
    session: AsyncSession = Depends(get_session),
):
    """
    Apply text replacements to PDF using white fill + text insert technique.

    Each replacement is: {"find": "80.000", "replace": "100.000", "page": 0 or null for all}

    This method:
    - Draws white rectangle over original text (no visible border)
    - Inserts new text with matching font size
    - Automatically shifts text LEFT if replacement is longer (prevents overflow)
    """
    from pydantic import BaseModel

    class TextReplacement(BaseModel):
        find: str
        replace: str
        page: int = None  # None = all pages

    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    input_path = Path(settings.storage_path) / job.input_path
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")

    import fitz

    doc = fitz.open(str(input_path))

    changes_made = []

    for repl_data in replacements:
        repl = TextReplacement(**repl_data)
        pages_to_check = [repl.page] if repl.page is not None else range(len(doc))

        for page_num in pages_to_check:
            if page_num >= len(doc):
                continue

            page = doc[page_num]
            text_instances = page.search_for(repl.find)

            for inst in text_instances:
                # Get original text properties for font matching
                text_dict = page.get_text("dict", clip=inst)
                font_size = 10  # default
                for block in text_dict.get("blocks", []):
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            font_size = span.get("size", 10)
                            break

                # Calculate width difference for longer replacements
                orig_width = inst.x1 - inst.x0
                # Estimate new width (approx chars * avg char width)
                avg_char_width = orig_width / max(1, len(repl.find))
                new_width = len(repl.replace) * avg_char_width
                left_shift = max(0, new_width - orig_width)

                # Expand rectangle to cover area for longer text
                cover_rect = fitz.Rect(
                    inst.x0 - left_shift - 2,  # Shift left if needed
                    inst.y0 - 1,
                    inst.x1 + 2,
                    inst.y1 + 1,
                )

                if not repl.replace:
                    # Empty replacement = TRUE DELETION using redaction API
                    # This removes text from content stream, not just covers it
                    page.add_redact_annot(cover_rect, fill=(1, 1, 1))
                else:
                    # Text replacement: white cover + new text
                    page.draw_rect(cover_rect, color=None, fill=(1, 1, 1), width=0)

                    # Insert new text at adjusted position
                    text_x = inst.x0 - left_shift  # Shift left for longer text
                    text_y = inst.y1 - 1.5  # Baseline position

                    page.insert_text(
                        fitz.Point(text_x, text_y),
                        repl.replace,
                        fontsize=font_size,
                        fontname="helv",  # Helvetica - similar to Arial
                        color=(0, 0, 0),  # Black text
                    )

                changes_made.append(
                    {
                        "page": page_num,
                        "find": repl.find,
                        "replace": repl.replace,
                        "bbox": [inst.x0, inst.y0, inst.x1, inst.y1],
                        "left_shift": left_shift,
                        "action": "delete" if not repl.replace else "replace",
                    }
                )

    # Apply redactions (finalize deletions - removes text from content stream)
    for page_num in range(len(doc)):
        page = doc[page_num]
        page.apply_redactions()

    # Save modified PDF
    output_dir = Path(settings.storage_path) / "outputs" / str(job.id)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"replaced_{job.original_filename}"
    doc.save(str(output_path))
    doc.close()

    # Update job
    job.output_pdf_path = str(output_path.relative_to(settings.storage_path))
    job.status = "done"
    job.completed_at = datetime.utcnow()
    await session.commit()

    # Regenerate thumbnails
    from app.services.pdf_processor import PDFProcessor

    thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
    with PDFProcessor(output_path) as processor:
        processor.generate_thumbnails(thumbnails_dir)

    return {"status": "ok", "changes_count": len(changes_made), "changes": changes_made}


@router.post("/{job_id}/delete-blocks")
async def delete_blocks(
    job_id: UUID,
    blocks: list = Body(
        default=[], description="List of blocks with page and bbox (normalized %)"
    ),
    session: AsyncSession = Depends(get_session),
):
    """
    Delete specific blocks (images or text areas) using redaction.
    Input: List of blocks with normalized coordinates (0-100%).
    """
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    input_path = Path(settings.storage_path) / job.input_path
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")

    import fitz

    doc = fitz.open(str(input_path))

    for block in blocks:
        page_num = block.get("page")
        if page_num is None or page_num >= len(doc):
            continue

        page = doc[page_num]
        page_rect = page.rect

        # Convert normalized coordinates (0-100) back to PDF points
        bbox = block.get("bbox", {})
        if not bbox:
            continue

        x = (bbox.get("x", 0) / 100) * page_rect.width
        y = (bbox.get("y", 0) / 100) * page_rect.height
        w = (bbox.get("w", 0) / 100) * page_rect.width
        h = (bbox.get("h", 0) / 100) * page_rect.height

        # Create redaction annotation
        rect = fitz.Rect(x, y, x + w, y + h)
        page.add_redact_annot(rect, fill=(1, 1, 1))  # White fill

    # Apply redactions
    for page in doc:
        page.apply_redactions()

    # Save modified PDF with garbage collection to truly remove data
    output_dir = Path(settings.storage_path) / "outputs" / str(job.id)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"blocks_removed_{job.original_filename}"
    doc.save(str(output_path), garbage=3, deflate=True)
    doc.close()

    # Update job to point to new file (critical for subsequent operations)
    job.input_path = str(output_path.relative_to(settings.storage_path))
    job.output_pdf_path = job.input_path
    job.status = "done"
    job.completed_at = datetime.utcnow()
    await session.commit()

    # Regenerate thumbnails
    from app.services.pdf_processor import PDFProcessor

    thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
    with PDFProcessor(output_path) as processor:
        processor.generate_thumbnails(thumbnails_dir)

    return {"status": "ok", "deleted_count": len(blocks)}


@router.post("/{job_id}/delete-pages")
async def delete_pages(
    job_id: UUID,
    request_body: dict = Body(
        default={}, description="Dict with 'pages' list of 0-indexed page numbers"
    ),
    session: AsyncSession = Depends(get_session),
):
    """
    Delete entire pages from PDF.

    Body: {"pages": [0, 2, 5]} - list of 0-indexed page numbers to delete
    """
    pages = request_body.get("pages", [])

    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not pages:
        raise HTTPException(status_code=400, detail="No pages specified")

    input_path = Path(settings.storage_path) / job.input_path
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")

    import fitz

    doc = fitz.open(str(input_path))
    original_count = len(doc)

    # Validate page numbers
    invalid_pages = [p for p in pages if p < 0 or p >= original_count]
    if invalid_pages:
        doc.close()
        raise HTTPException(
            status_code=400, detail=f"Invalid page numbers: {invalid_pages}"
        )

    # Sort pages in reverse order to delete from end first (preserves indices)
    pages_to_delete = sorted(set(pages), reverse=True)

    for page_num in pages_to_delete:
        doc.delete_page(page_num)

    # Save modified PDF with garbage collection
    output_dir = Path(settings.storage_path) / "outputs" / str(job.id)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"pages_removed_{job.original_filename}"
    doc.save(str(output_path), garbage=3, deflate=True)
    new_count = len(doc)
    doc.close()

    # Update job to point to new file (critical for subsequent operations)
    job.input_path = str(output_path.relative_to(settings.storage_path))
    job.output_pdf_path = job.input_path
    job.page_count = new_count
    job.status = "done"
    job.completed_at = datetime.utcnow()
    await session.commit()

    # Regenerate thumbnails for new PDF
    from app.services.pdf_processor import PDFProcessor

    thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
    # Clear old thumbnails
    if thumbnails_dir.exists():
        import shutil

        shutil.rmtree(thumbnails_dir)
    thumbnails_dir.mkdir(parents=True, exist_ok=True)

    with PDFProcessor(output_path) as processor:
        processor.generate_thumbnails(thumbnails_dir)

    return {
        "status": "ok",
        "deleted_pages": sorted(pages),
        "original_page_count": original_count,
        "new_page_count": new_count,
    }


@router.post("/{job_id}/render")
async def render_output(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Generate final output (PDF and/or JSON) based on user decisions.
    """
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Update status
    job.status = "rendering"
    await session.commit()

    # Trigger rendering task
    from app.workers.tasks import render_document

    render_document.delay(str(job_id))

    return {"status": "rendering", "job_id": str(job_id)}


@router.get("/{job_id}/download/{file_type}")
async def download_output(
    job_id: UUID,
    file_type: str,
    session: AsyncSession = Depends(get_session),
):
    """
    Download output file.

    - **file_type**: "pdf", "json", "audit"
    """
    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "done":
        raise HTTPException(status_code=400, detail="Job not completed yet")

    if file_type == "pdf" and job.output_pdf_path:
        path = Path(settings.storage_path) / job.output_pdf_path
        return FileResponse(path, filename=f"anonimized_{job.original_filename}")
    elif file_type == "json" and job.output_json_path:
        path = Path(settings.storage_path) / job.output_json_path
        return FileResponse(
            path, filename=f"digital_twin_{job.id}.json", media_type="application/json"
        )
    elif file_type == "audit" and job.audit_path:
        path = Path(settings.storage_path) / job.audit_path
        return FileResponse(
            path, filename=f"audit_{job.id}.json", media_type="application/json"
        )
    else:
        raise HTTPException(
            status_code=404, detail=f"File type '{file_type}' not available"
        )


@router.get("")
async def list_jobs(
    status: str = None,
    mode: str = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """List all jobs with optional filtering"""
    query = select(Job).order_by(Job.created_at.desc())

    if status:
        query = query.where(Job.status == status)
    if mode:
        query = query.where(Job.mode == mode)

    query = query.offset(offset).limit(limit)
    result = await session.execute(query)
    jobs = result.scalars().all()

    return {
        "items": [
            {
                "id": str(j.id),
                "status": j.status,
                "mode": j.mode,
                "original_filename": j.original_filename,
                "page_count": j.page_count,
                "confidence": j.confidence,
                "created_at": j.created_at.isoformat(),
            }
            for j in jobs
        ],
        "total": len(jobs),
        "limit": limit,
        "offset": offset,
    }


@router.delete("/{job_id}")
async def delete_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Delete a job and all associated files (input, output, thumbnails).
    """
    import shutil

    job = await session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Delete associated files
    files_deleted = []

    # Delete input files directory
    input_dir = Path(settings.storage_path) / "inputs" / str(job.id)
    if input_dir.exists():
        shutil.rmtree(input_dir)
        files_deleted.append("inputs")

    # Delete output files directory
    output_dir = Path(settings.storage_path) / "outputs" / str(job.id)
    if output_dir.exists():
        shutil.rmtree(output_dir)
        files_deleted.append("outputs")

    # Delete thumbnails directory
    thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
    if thumbnails_dir.exists():
        shutil.rmtree(thumbnails_dir)
        files_deleted.append("thumbnails")

    # Delete job from database
    await session.delete(job)
    await session.commit()

    return {
        "status": "ok",
        "message": f"Job {job_id} deleted",
        "files_deleted": files_deleted,
    }

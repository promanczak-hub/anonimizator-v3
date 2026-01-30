"""Jobs API - Processing job endpoints"""

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
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

    # Create job
    job = Job(
        mode=mode,
        policy_preset=policy_preset,
        pricing_strategy=pricing_strategy,
        description=description,
        tags=tags,
        original_filename=file.filename,
        file_size=file.size or 0,
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
        content = await file.read()
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
    if not thumbnail_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    return FileResponse(thumbnail_path, media_type="image/png")


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

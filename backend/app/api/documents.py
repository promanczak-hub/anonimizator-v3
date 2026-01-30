"""Documents API - Document library endpoints"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, or_
from uuid import UUID
from datetime import datetime
from typing import Optional

from app.database import get_session
from app.models.document import Document, DocumentResponse, DocumentUpdate

router = APIRouter()


@router.get("")
async def list_documents(
    query: Optional[str] = Query(
        None, description="Search in filename, display_name, description, tags"
    ),
    status: Optional[str] = Query(None),
    mode: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, description="ISO date string"),
    to_date: Optional[str] = Query(None, description="ISO date string"),
    tag: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """
    List documents with search and filtering.

    - **query**: Search in filename, display_name, description, tags
    - **status**: Filter by status (queued, processing, review, done, failed)
    - **mode**: Filter by mode (unify, layout)
    - **from_date/to_date**: Date range filter
    - **tag**: Filter by tag
    """
    stmt = select(Document).order_by(Document.created_at.desc())

    # Search query
    if query:
        search_pattern = f"%{query}%"
        stmt = stmt.where(
            or_(
                Document.original_filename.ilike(search_pattern),
                Document.display_name.ilike(search_pattern),
                Document.description.ilike(search_pattern),
                Document.tags.ilike(search_pattern),
            )
        )

    # Filters
    if status:
        stmt = stmt.where(Document.status == status)
    if mode:
        stmt = stmt.where(Document.mode == mode)
    if tag:
        stmt = stmt.where(Document.tags.ilike(f"%{tag}%"))
    if from_date:
        stmt = stmt.where(Document.created_at >= datetime.fromisoformat(from_date))
    if to_date:
        stmt = stmt.where(Document.created_at <= datetime.fromisoformat(to_date))

    # Pagination
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await session.execute(stmt)
    documents = result.scalars().all()

    # Count total
    count_stmt = select(Document)
    if query:
        search_pattern = f"%{query}%"
        count_stmt = count_stmt.where(
            or_(
                Document.original_filename.ilike(search_pattern),
                Document.display_name.ilike(search_pattern),
                Document.description.ilike(search_pattern),
                Document.tags.ilike(search_pattern),
            )
        )
    if status:
        count_stmt = count_stmt.where(Document.status == status)
    if mode:
        count_stmt = count_stmt.where(Document.mode == mode)

    count_result = await session.execute(count_stmt)
    total = len(count_result.scalars().all())

    return {
        "items": [
            {
                "id": str(doc.id),
                "original_filename": doc.original_filename,
                "display_name": doc.display_name,
                "description": doc.description,
                "tags": doc.tags,
                "mode": doc.mode,
                "status": doc.status,
                "page_count": doc.page_count,
                "file_size": doc.file_size,
                "confidence": doc.confidence,
                "created_at": doc.created_at.isoformat(),
                "completed_at": doc.completed_at.isoformat()
                if doc.completed_at
                else None,
                "thumbnail_path": f"/api/documents/{doc.id}/thumbnail"
                if doc.thumbnail_path
                else None,
                "pinned": doc.pinned,
            }
            for doc in documents
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{document_id}")
async def get_document(
    document_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Get document details and artifact links"""
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    result = {
        "id": str(doc.id),
        "original_filename": doc.original_filename,
        "display_name": doc.display_name,
        "description": doc.description,
        "tags": doc.tags,
        "mode": doc.mode,
        "status": doc.status,
        "page_count": doc.page_count,
        "file_size": doc.file_size,
        "confidence": doc.confidence,
        "policy_preset": doc.policy_preset,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
        "completed_at": doc.completed_at.isoformat() if doc.completed_at else None,
        "pinned": doc.pinned,
        "expires_at": doc.expires_at.isoformat() if doc.expires_at else None,
    }

    # Add artifact links
    artifacts = {}
    if doc.output_pdf_path:
        artifacts["pdf"] = f"/api/documents/{document_id}/download/pdf"
    if doc.output_json_path:
        artifacts["json"] = f"/api/documents/{document_id}/download/json"
    if doc.audit_path:
        artifacts["audit"] = f"/api/documents/{document_id}/download/audit"
    if doc.annotations_path:
        artifacts["annotations"] = f"/api/documents/{document_id}/download/annotations"
    if doc.thumbnail_path:
        artifacts["thumbnail"] = f"/api/documents/{document_id}/thumbnail"

    result["artifacts"] = artifacts

    return result


@router.patch("/{document_id}")
async def update_document(
    document_id: UUID,
    update: DocumentUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update document metadata (display_name, description, tags, pinned)"""
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(doc, key, value)

    doc.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(doc)

    return {"status": "ok", "id": str(doc.id)}


@router.delete("/{document_id}")
async def delete_document(
    document_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Delete document and its files (respects pinned flag)"""
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.pinned:
        raise HTTPException(status_code=400, detail="Cannot delete pinned document")

    # TODO: Delete files from storage

    await session.delete(doc)
    await session.commit()

    return {"status": "deleted", "id": str(document_id)}


@router.get("/{document_id}/thumbnail")
async def get_document_thumbnail(
    document_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Get document thumbnail (first page)"""
    from fastapi.responses import FileResponse
    from pathlib import Path
    from app.config import get_settings

    settings = get_settings()
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not doc.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")

    thumbnail_path = Path(settings.storage_path) / doc.thumbnail_path
    if not thumbnail_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file not found")

    return FileResponse(thumbnail_path, media_type="image/png")

"""Celery tasks for document processing"""

from celery import Celery
from pathlib import Path
from datetime import datetime
import json
import asyncio

from app.config import get_settings

settings = get_settings()

# Initialize Celery
celery_app = Celery(
    "anonimizator",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Warsaw",
    enable_utc=True,
    task_track_started=True,
)


def get_db_session():
    """Get sync database session for Celery tasks"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlmodel import SQLModel

    # Import ALL models to ensure foreign keys work
    from app.models.job import Job
    from app.models.document import Document

    # Convert async URL to sync
    sync_url = settings.database_url.replace("+asyncpg", "")
    engine = create_engine(sync_url)

    # Create tables if needed
    SQLModel.metadata.create_all(engine)

    Session = sessionmaker(bind=engine)
    return Session()


@celery_app.task(bind=True)
def process_document(self, job_id: str):
    """
    Main document processing task.

    1. Render PDF pages to images
    2. Call Vertex AI for section detection
    3. Call Vertex AI for sensitive data detection
    4. (Mode A) Extract Digital Twin data
    5. Update job status to 'review'
    """
    from app.models.job import Job
    from app.services.pdf_processor import PDFProcessor
    from app.services.vertex_ai import vertex_ai_service

    session = get_db_session()

    try:
        # Get job
        job = session.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Update status
        job.status = "processing"
        job.progress = 10
        session.commit()

        # Get input file
        input_path = Path(settings.storage_path) / job.input_path

        # Process PDF
        with PDFProcessor(input_path) as processor:
            job.page_count = processor.page_count
            session.commit()

            # Generate thumbnails
            thumbnails_dir = Path(settings.storage_path) / "thumbnails" / str(job.id)
            processor.generate_thumbnails(thumbnails_dir)
            job.progress = 20
            session.commit()

            # Render pages for AI analysis (lower DPI for speed)
            pages_dir = Path(settings.storage_path) / "pages" / str(job.id)
            page_paths = processor.render_all_pages(pages_dir, dpi=150)
            job.progress = 30
            session.commit()

            # Load page images
            page_images = [p.read_bytes() for p in page_paths]

        # Update status to analyzing
        job.status = "analyzing"
        job.progress = 40
        session.commit()

        # Run async AI analysis
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            # Detect sections
            sections_response = loop.run_until_complete(
                vertex_ai_service.detect_sections(page_images)
            )
            job.sections_json = json.dumps(
                [s.model_dump() for s in sections_response.sections]
            )
            job.progress = 55
            session.commit()

            # Detect sensitive data
            findings_response = loop.run_until_complete(
                vertex_ai_service.detect_sensitive_data(page_images)
            )
            job.findings_json = json.dumps(
                [f.model_dump() for f in findings_response.findings]
            )
            job.progress = 70
            session.commit()

            # Mode A: Extract Digital Twin
            if job.mode == "unify":
                digital_twin = loop.run_until_complete(
                    vertex_ai_service.extract_digital_twin(
                        page_images, job.original_filename
                    )
                )
                job.digital_twin_json = digital_twin.model_dump_json()
                job.confidence = digital_twin.confidence
                job.progress = 85
                session.commit()
        finally:
            loop.close()

        # Calculate overall confidence
        if job.findings_json:
            findings = json.loads(job.findings_json)
            if findings:
                avg_confidence = sum(f.get("confidence", 0) for f in findings) / len(
                    findings
                )
                job.confidence = max(job.confidence, avg_confidence)

        # Update to review status
        job.status = "review"
        job.progress = 100
        session.commit()

        return {"status": "success", "job_id": job_id}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        session.commit()
        raise
    finally:
        session.close()


@celery_app.task(bind=True)
def render_document(self, job_id: str):
    """
    Render final output based on user decisions.

    1. Load user decisions
    2. Apply redactions (Mode B) or build unified PDF (Mode A)
    3. Generate output files
    4. Update job to 'done'
    """
    from app.models.job import Job
    from app.services.pdf_processor import PDFAnonymizer

    session = get_db_session()

    try:
        job = session.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job.status = "rendering"
        session.commit()

        input_path = Path(settings.storage_path) / job.input_path
        output_dir = Path(settings.storage_path) / "outputs" / str(job.id)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Parse decisions
        decisions = {}
        if job.decisions_json:
            decisions_data = json.loads(job.decisions_json)
            for d in decisions_data.get("decisions", []):
                decisions[d["item_id"]] = d["action"]

        # Parse findings
        findings = []
        if job.findings_json:
            findings = json.loads(job.findings_json)

        # Apply redactions
        with PDFAnonymizer(input_path) as anonymizer:
            for finding in findings:
                finding_id = finding.get("id")
                action = decisions.get(
                    finding_id, finding.get("suggested_action", "keep")
                )

                if action in ("remove", "mask"):
                    anonymizer.add_redaction(
                        page_num=finding.get("page", 1) - 1,  # Convert to 0-indexed
                        bbox=finding.get("bbox", {"x": 0, "y": 0, "w": 0, "h": 0}),
                        action=action,
                    )

            # Save redacted PDF
            output_pdf = output_dir / f"anonymized_{job.original_filename}"
            anonymizer.apply_redactions(output_pdf)
            job.output_pdf_path = str(output_pdf.relative_to(settings.storage_path))

        # Save Digital Twin JSON (Mode A)
        if job.mode == "unify" and job.digital_twin_json:
            json_path = output_dir / "digital_twin.json"
            json_path.write_text(job.digital_twin_json)
            job.output_json_path = str(json_path.relative_to(settings.storage_path))

        # Save audit log
        audit_path = output_dir / "audit.json"
        audit_data = {
            "job_id": str(job.id),
            "processed_at": datetime.utcnow().isoformat(),
            "mode": job.mode,
            "decisions": decisions,
            "findings_count": len(findings),
            "redactions_applied": sum(
                1 for d in decisions.values() if d in ("remove", "mask")
            ),
        }
        audit_path.write_text(json.dumps(audit_data, indent=2))
        job.audit_path = str(audit_path.relative_to(settings.storage_path))

        # Update job
        job.status = "done"
        job.completed_at = datetime.utcnow()
        session.commit()

        return {"status": "success", "job_id": job_id}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        session.commit()
        raise
    finally:
        session.close()

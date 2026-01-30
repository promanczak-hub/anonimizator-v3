"""Watch Folder Service - Auto-process PDFs from watched directory"""

import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent
import shutil
from uuid import uuid4

from app.config import get_settings
from app.workers.tasks import process_document

settings = get_settings()


class PDFHandler(FileSystemEventHandler):
    """Handler for new PDF files in watch folder"""

    def __init__(self):
        self.processing = set()  # Track files being processed

    def on_created(self, event: FileCreatedEvent):
        """Handle new file creation"""
        if event.is_directory:
            return

        file_path = Path(event.src_path)

        # Only process PDF files
        if not file_path.suffix.lower() == ".pdf":
            return

        # Skip if already processing
        if str(file_path) in self.processing:
            return

        # Wait for file to be fully written
        time.sleep(1)

        # Check file still exists and is complete
        if not file_path.exists():
            return

        self.processing.add(str(file_path))

        try:
            self._process_file(file_path)
        finally:
            self.processing.discard(str(file_path))

    def _process_file(self, file_path: Path):
        """Process a PDF file from watch folder"""
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.models.job import Job

        print(f"[Watcher] New PDF detected: {file_path.name}")

        # Create database session
        sync_url = settings.database_url.replace("+asyncpg", "")
        engine = create_engine(sync_url)
        Session = sessionmaker(bind=engine)
        session = Session()

        try:
            # Create job
            job = Job(
                mode="layout",  # Default to layout mode for watch folder
                policy_preset="default",
                pricing_strategy="final_only",
                original_filename=file_path.name,
                file_size=file_path.stat().st_size,
                status="queued",
                description=f"Auto-imported from watch folder",
            )
            session.add(job)
            session.commit()
            session.refresh(job)

            # Move file to storage
            storage_dir = Path(settings.storage_path) / "inputs" / str(job.id)
            storage_dir.mkdir(parents=True, exist_ok=True)
            dest_path = storage_dir / file_path.name

            shutil.move(str(file_path), str(dest_path))

            # Update job with path
            job.input_path = str(dest_path.relative_to(settings.storage_path))
            session.commit()

            print(f"[Watcher] Created job {job.id} for {file_path.name}")

            # Trigger processing
            process_document.delay(str(job.id))

        except Exception as e:
            print(f"[Watcher] Error processing {file_path.name}: {e}")
            session.rollback()
        finally:
            session.close()


def start_watcher():
    """Start the watch folder service"""
    watch_path = Path(settings.watch_folder)
    watch_path.mkdir(parents=True, exist_ok=True)

    print(f"[Watcher] Starting watch folder service")
    print(f"[Watcher] Watching: {watch_path.absolute()}")

    event_handler = PDFHandler()
    observer = Observer()
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()

    observer.join()


if __name__ == "__main__":
    start_watcher()

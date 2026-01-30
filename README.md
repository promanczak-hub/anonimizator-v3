# Anonimizator v3

Webowa aplikacja do anonimizacji i unifikacji ofert handlowych samochodów.

## Quick Start

```bash
# Start all services
docker-compose up -d

# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

## Architecture

- **Frontend**: React 19 + Vite
- **Backend**: FastAPI + Celery
- **Database**: PostgreSQL
- **Queue**: Redis
- **AI**: Vertex AI (Gemini 2.5 Pro)

## Watch Folder

Drop PDF files into `./watch/` directory for automatic processing.

## Modes

1. **Unify (Mode A)**: Full extraction to Digital Twin JSON
2. **Layout (Mode B)**: In-place redaction preserving original layout

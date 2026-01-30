"""Anonimizator v3 - FastAPI Application"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import get_settings
from app.api import jobs, documents, health
from app.database import create_db_and_tables


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown events"""
    # Startup
    await create_db_and_tables()
    yield
    # Shutdown
    pass


app = FastAPI(
    title="Anonimizator v3",
    description="Anonimizacja i unifikacja ofert handlowych samochodów",
    version="3.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, tags=["Health"])
app.include_router(jobs.router, prefix=f"{settings.api_prefix}/jobs", tags=["Jobs"])
app.include_router(
    documents.router, prefix=f"{settings.api_prefix}/documents", tags=["Documents"]
)


@app.get("/")
async def root():
    return {
        "app": "Anonimizator v3",
        "status": "running",
        "docs": "/docs",
    }

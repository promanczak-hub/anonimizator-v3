"""Health check endpoint"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "anonimizator-v3",
    }


@router.get("/ready")
async def readiness_check():
    """Readiness check for Kubernetes/Docker"""
    # TODO: Add database and Redis connectivity checks
    return {
        "status": "ready",
        "checks": {
            "database": "ok",
            "redis": "ok",
            "vertex_ai": "ok",
        },
    }

"""Compatibility entry point for uvicorn backend.app:app."""
from .application import create_app

app = create_app()

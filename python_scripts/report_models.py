from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Clip(BaseModel):
    clip_id: Optional[str] = None
    clip_url: Optional[str] = None
    timestamp: str
    description: str
    relevance_score: int = Field(ge=1, le=10)


class TacticalTheme(BaseModel):
    title: str
    summary: str
    clips: list[Clip]


class Subsection(BaseModel):
    name: str
    themes: list[TacticalTheme]


class Phase(BaseModel):
    name: Literal["attack", "defence"]
    subsections: list[Subsection]


class Report(BaseModel):
    report_type: Literal["match", "opposition"]
    phases: list[Phase]

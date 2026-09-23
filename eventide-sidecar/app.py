"""Habitat 的 Eventide 薄 sidecar：纯计算、无持久化、无 LLM 调用。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from eventide import EventideRuntime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator

EVENTIDE_REVISION = "5d8bef965137427e41d97f5b60e5a14c24dd812c"

app = FastAPI(title="Habitat Eventide Sidecar", version="0.1.0")
runtime = EventideRuntime()


class TickRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: dict[str, Any] | None = None
    now: datetime
    last_counterpart_message_at: datetime | None = None

    @field_validator("now", "last_counterpart_message_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "eventide", "revision": EVENTIDE_REVISION}


@app.post("/v1/tick")
def tick(request: TickRequest) -> dict[str, Any]:
    try:
        if request.state is None:
            state = runtime.create_state(request.now)
            state_card = runtime.render_card(state, request.now)
        else:
            state = runtime.load_state(request.state)
            state_card = runtime.tick_and_render(
                state,
                request.now,
                last_counterpart_message_at=request.last_counterpart_message_at,
            )
        return {
            "state": runtime.dump_state(state),
            "state_card": state_card,
            "payload": runtime.payload(state),
        }
    except (TypeError, ValueError, KeyError) as error:
        # 上游状态损坏属于调用方输入问题，不伪装成 sidecar 500。
        raise HTTPException(status_code=422, detail=str(error)) from error

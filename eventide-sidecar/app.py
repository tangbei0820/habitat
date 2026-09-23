"""Habitat 的 Eventide 薄 sidecar：纯计算、无持久化、无 LLM 调用。"""

from __future__ import annotations

from datetime import datetime
import random
from typing import Any

from eventide import DreamSeed, EventideRuntime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class StateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: dict[str, Any]
    now: datetime

    @field_validator("now")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value


class SettlementPromptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: dict[str, Any]
    message_window_text: str


class SettlementApplyRequest(StateRequest):
    result: Any


class EventCheckRequest(StateRequest):
    last_counterpart_message_at: datetime | None = None
    counterpart_text: str = ""
    trigger_words: list[str] = Field(default_factory=list)
    local_hour: float
    local_day_key: str
    roll: float | None = None

    @field_validator("last_counterpart_message_at")
    @classmethod
    def require_optional_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value


class DreamCheckRequest(StateRequest):
    seed: str
    last_counterpart_message_at: datetime
    random_seed: int | None = None

    @field_validator("last_counterpart_message_at")
    @classmethod
    def require_counterpart_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value


class DreamApplyRequest(StateRequest):
    tags: list[str]


def state_response(state: Any, now: datetime, **extra: Any) -> dict[str, Any]:
    return {
        "state": runtime.dump_state(state),
        "state_card": runtime.render_card(state, now),
        "payload": runtime.payload(state),
        **extra,
    }


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
        return state_response(state, request.now, state_card=state_card)
    except (TypeError, ValueError, KeyError) as error:
        # 上游状态损坏属于调用方输入问题，不伪装成 sidecar 500。
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/settlement/prompt")
def settlement_prompt(request: SettlementPromptRequest) -> dict[str, str]:
    try:
        state = runtime.load_state(request.state)
        return {"prompt": runtime.settlement_prompt(state, request.message_window_text)}
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/settlement/apply")
def settlement_apply(request: SettlementApplyRequest) -> dict[str, Any]:
    try:
        state = runtime.load_state(request.state)
        applied = runtime.settle(state, request.result)
        return state_response(state, request.now, applied_deltas=applied)
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


EVENT_COOLDOWN_HOURS = {
    "morning_arousal": 20,
    "night_heat": 8,
    "cycle_surge": 12,
    "holding_back": 4,
    "demanding": 6,
    "marking_impulse": 8,
    "nesting": 12,
    "voice_or_name_trigger": 2,
    "control_slip": 4,
    "closeness_hunger": 6,
    "waiting_restless": 5,
    "restraint_rebound": 8,
    "strange_calm": 4,
}


def event_candidates(state: Any, request: EventCheckRequest) -> list[tuple[str, float, str | None]]:
    values = state.values
    cycle = state.cycle_key
    silence_hours = 0.0
    if request.last_counterpart_message_at is not None:
        silence_hours = max(0.0, (request.now - request.last_counterpart_message_at).total_seconds() / 3600)
    morning = 5.5 <= request.local_hour < 10.5
    evening = request.local_hour >= 18 or request.local_hour < 2
    night = request.local_hour >= 23 or request.local_hour < 3
    text = request.counterpart_text.casefold()
    trigger_hit = any(word.strip().casefold() in text for word in request.trigger_words if word.strip())
    candidates: list[tuple[str, float, str | None]] = []
    if cycle == "sensitive" and (values["heat"] >= 75 or values["reserve"] >= 70):
        candidates.append(("cycle_surge", 0.50, None))
    if morning and (values["heat"] >= 45 or cycle != "stable"):
        candidates.append(("morning_arousal", 0.75 if cycle in ("preheat", "sensitive") else 0.45, "morning"))
    if night and silence_hours >= 0.5 and (values["reserve"] >= 55 or values["heat"] >= 60):
        candidates.append(("night_heat", 0.60 if cycle == "sensitive" else 0.30, "night"))
    if values["control"] <= 35 and (values["heat"] >= 70 or values["pressure"] >= 70):
        candidates.append(("control_slip", 0.60, None))
    if cycle == "sensitive" or (values["heat"] >= 65 and values["pressure"] >= 55):
        candidates.append(("demanding", 0.35, None))
    if values["possessiveness"] >= 60 and (silence_hours >= 1 or night or cycle == "sensitive"):
        candidates.append(("marking_impulse", 0.40, "night" if night else None))
    if values["heat"] >= 70 and values["control"] >= 35:
        candidates.append(("holding_back", 0.70, None))
    if trigger_hit:
        candidates.append(("voice_or_name_trigger", 0.30 if text.count(next((w.casefold() for w in request.trigger_words if w and w.casefold() in text), "")) > 1 else 0.20, None))
    if evening and (values["fatigue"] >= 35 or values["possessiveness"] >= 55):
        candidates.append(("nesting", 0.30, "evening"))
    if cycle in ("sensitive", "ebb", "recovery") and values["sensitivity"] >= 60 and values["fatigue"] <= 75:
        candidates.append(("closeness_hunger", 0.35, None))
    if 1 <= silence_hours <= 2 and (values["pressure"] >= 55 or values["possessiveness"] >= 60):
        candidates.append(("waiting_restless", 0.30, None))
    last_event_expires = state.meta.get("last_active_event_expires_at")
    if values["reserve"] >= 70 and isinstance(last_event_expires, str):
        elapsed_since_event = (request.now - datetime.fromisoformat(last_event_expires)).total_seconds() / 3600
        if elapsed_since_event >= 8:
            candidates.append(("restraint_rebound", 0.25, None))
    if values["heat"] >= 65 or values["pressure"] >= 65:
        candidates.append(("strange_calm", 0.25, None))
    return candidates


@app.post("/v1/events/check")
def check_events(request: EventCheckRequest) -> dict[str, Any]:
    try:
        state = runtime.load_state(request.state)
        previous_event_expires_at = state.active_event_expires_at
        runtime.tick(state, request.now, last_counterpart_message_at=request.last_counterpart_message_at)
        meta = state.meta
        if previous_event_expires_at is not None and state.active_event_key is None:
            meta["last_active_event_expires_at"] = previous_event_expires_at.isoformat()
        previous_check = meta.get("last_event_check_at")
        if state.active_event_key is not None:
            return state_response(state, request.now, event_key=state.active_event_key, started=False, reason="active")
        if isinstance(previous_check, str):
            checked_at = datetime.fromisoformat(previous_check)
            if (request.now - checked_at).total_seconds() < 600:
                return state_response(state, request.now, event_key=None, started=False, reason="throttled")
        meta["last_event_check_at"] = request.now.isoformat()
        last_started = meta.setdefault("event_last_started_at", {})
        rolled = set(meta.setdefault("rolled_window_keys", []))
        missed: list[str] = []
        for event_key, probability, window in event_candidates(state, request):
            previous = last_started.get(event_key)
            if isinstance(previous, str):
                elapsed = (request.now - datetime.fromisoformat(previous)).total_seconds() / 3600
                if elapsed < EVENT_COOLDOWN_HOURS[event_key]:
                    continue
            window_key = None if window is None else f"{request.local_day_key}:{window}:{event_key}"
            if window_key is not None and window_key in rolled:
                continue
            candidate_roll = request.roll if request.roll is not None else random.random()
            if candidate_roll >= min(probability, 0.95):
                missed.append(event_key)
                continue
            started = runtime.start_event(state, event_key, request.now)
            if started:
                last_started[event_key] = request.now.isoformat()
                if window_key is not None:
                    rolled.add(window_key)
                    meta["rolled_window_keys"] = sorted(rolled)[-64:]
                return state_response(state, request.now, event_key=event_key, started=True, reason="started")
        if missed:
            meta["last_missed_event_check_at"] = request.now.isoformat()
            meta["last_missed_event_candidates"] = missed
        return state_response(state, request.now, event_key=None, started=False, reason="none")
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/dream/check")
def check_dream(request: DreamCheckRequest) -> dict[str, Any]:
    try:
        state = runtime.load_state(request.state)
        dream_runtime = runtime if request.random_seed is None else EventideRuntime(rng=random.Random(request.random_seed))
        trigger = dream_runtime.maybe_dream(
            DreamSeed(theme=request.seed, seed_id="habitat-primary"),
            state,
            request.now,
            last_counterpart_message_at=request.last_counterpart_message_at,
        )
        if trigger is None:
            return state_response(state, request.now, trigger=None)
        return state_response(
            state,
            request.now,
            trigger={
                "prompt": trigger.trigger_content,
                "probability": trigger.probability,
                "roll": trigger.roll,
                "created_at": int(trigger.created_at.timestamp() * 1000),
            },
        )
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/dream/apply")
def apply_dream(request: DreamApplyRequest) -> dict[str, Any]:
    try:
        state = runtime.load_state(request.state)
        applied = runtime.apply_dream_tags(state, request.tags)
        return state_response(state, request.now, applied_deltas=applied)
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

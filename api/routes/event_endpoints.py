import asyncio
import json
from typing import Optional
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from api.repository import repo

router = APIRouter(tags=["events"])

@router.get("/events")
async def get_events(
    request: Request,
    last_event_id: Optional[str] = Query(None),
    since_revision: Optional[int] = Query(None),
    stream: bool = Query(True)
):
    """
    Publish graph revisions and barrier lifecycle events.
    Supports both Server-Sent Events (SSE) stream and REST catch-up.
    """
    if not stream:
        events = repo.get_events_since(last_event_id=last_event_id, since_revision=since_revision)
        return {"events": events}

    async def event_generator():
        # Yield current graph revision immediately upon connection
        state = repo.get_graph_state()
        yield f"event: init\ndata: {json.dumps(state)}\n\n"

        last_seen_rev = since_revision if since_revision is not None else state["revision"]

        while True:
            if await request.is_disconnected():
                break

            current_state = repo.get_graph_state()
            if current_state["revision"] > last_seen_rev:
                # Fetch new events
                new_events = repo.get_events_since(since_revision=last_seen_rev)
                for ev in new_events:
                    yield f"id: {ev['id']}\nevent: {ev['event_type']}\ndata: {json.dumps(ev)}\n\n"
                    last_seen_rev = max(last_seen_rev, ev["revision"])

            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

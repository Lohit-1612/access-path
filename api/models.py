import uuid
from datetime import datetime, timezone
import json
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from api.database import Base

def gen_uuid():
    return str(uuid.uuid4())

def utc_now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    role = Column(String(32), nullable=False, default="reporter")  # reporter, verifier, admin
    name = Column(String(128), nullable=False, default="Anonymous User")
    created_at = Column(DateTime, default=utc_now)

class Node(Base):
    __tablename__ = "nodes"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(128), nullable=False)
    type = Column(String(64), nullable=False)  # junction, crossing, kerb, entrance, destination
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    level = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)

class Place(Base):
    __tablename__ = "places"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(128), nullable=False)
    category = Column(String(64), nullable=False)  # gate, academic, library, dining, recreation
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    # JSON list of entrance node IDs
    entrance_node_ids = Column(Text, default="[]")

class Edge(Base):
    __tablename__ = "edges"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(128), nullable=True)
    from_id = Column(String(36), ForeignKey("nodes.id"), nullable=False)
    to_id = Column(String(36), ForeignKey("nodes.id"), nullable=False)
    # Geometry stored as JSON coordinates [[lon1, lat1], [lon2, lat2], ...]
    geom = Column(Text, nullable=False)
    length_m = Column(Float, nullable=False)
    stairs = Column(Boolean, default=False)
    width_m = Column(Float, nullable=True)
    slope_pct = Column(Float, nullable=True)
    roughness = Column(Float, default=0.0)  # 0.0 smooth, 1.0 rough
    crossing_type = Column(String(64), nullable=True)  # dropped_kerb, tactile, raised, none
    surface = Column(String(64), default="paved")
    checked_at = Column(DateTime, default=utc_now)
    source = Column(String(64), default="survey")

    from_node = relationship("Node", foreign_keys=[from_id])
    to_node = relationship("Node", foreign_keys=[to_id])
    report_edges = relationship("ReportEdge", back_populates="edge", cascade="all, delete-orphan")

class Report(Base):
    __tablename__ = "reports"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    reporter_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    category = Column(String(64), nullable=False)  # stairs, construction, damaged_surface, missing_ramp, narrow_path, steep_slope, blockage
    status = Column(String(32), default="draft")  # draft, pending, verified_active, disputed, stale, resolved, rejected
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    accuracy_m = Column(Float, default=5.0)
    observed_at = Column(DateTime, default=utc_now)
    version = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    reporter = relationship("User", foreign_keys=[reporter_id])
    report_edges = relationship("ReportEdge", back_populates="report", cascade="all, delete-orphan")
    media = relationship("Media", back_populates="report", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="report", cascade="all, delete-orphan")

class ReportEdge(Base):
    __tablename__ = "report_edges"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    report_id = Column(String(36), ForeignKey("reports.id"), nullable=False)
    edge_id = Column(String(36), ForeignKey("edges.id"), nullable=False)
    extent = Column(String(32), default="complete")  # complete, partial
    direction = Column(String(32), default="both")  # both, forward, backward
    notes = Column(Text, nullable=True)

    report = relationship("Report", back_populates="report_edges")
    edge = relationship("Edge", back_populates="report_edges")

class Media(Base):
    __tablename__ = "media"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    report_id = Column(String(36), ForeignKey("reports.id"), nullable=False)
    object_key = Column(String(256), nullable=False)
    file_path = Column(String(512), nullable=False)
    sha256_hash = Column(String(64), nullable=False)
    mime_type = Column(String(64), default="image/jpeg")
    created_at = Column(DateTime, default=utc_now)

    report = relationship("Report", back_populates="media")
    detections = relationship("Detection", back_populates="media", cascade="all, delete-orphan")

class Detection(Base):
    __tablename__ = "detections"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    media_id = Column(String(36), ForeignKey("media.id"), nullable=False)
    box_x1 = Column(Float, nullable=False)
    box_y1 = Column(Float, nullable=False)
    box_x2 = Column(Float, nullable=False)
    box_y2 = Column(Float, nullable=False)
    label = Column(String(64), nullable=False)
    raw_score = Column(Float, nullable=False)
    model_revision = Column(String(128), default="google/owlv2-base-patch16")
    prompt = Column(String(256), nullable=False)
    is_precomputed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)

    media = relationship("Media", back_populates="detections")

class Job(Base):
    __tablename__ = "jobs"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    type = Column(String(64), default="barrier_detection")
    payload = Column(Text, nullable=False)  # JSON payload
    state = Column(String(32), default="queued")  # queued, running, succeeded, failed
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    lease_until = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
    result = Column(Text, nullable=True)  # JSON results
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

class Review(Base):
    __tablename__ = "reviews"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    report_id = Column(String(36), ForeignKey("reports.id"), nullable=False)
    actor_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    actor_name = Column(String(128), default="Campus Verifier")
    action = Column(String(64), nullable=False)  # verify, dispute, reject, resolve
    reason = Column(Text, nullable=False)
    old_state = Column(String(32), nullable=False)
    new_state = Column(String(32), nullable=False)
    timestamp = Column(DateTime, default=utc_now)

    report = relationship("Report", back_populates="reviews")

class GraphState(Base):
    __tablename__ = "graph_state"
    id = Column(Integer, primary_key=True, autoincrement=True)
    revision = Column(Integer, default=1, nullable=False)
    event_id = Column(String(36), nullable=True)
    affected_edge_ids = Column(Text, default="[]")  # JSON list
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

class Event(Base):
    __tablename__ = "events"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    revision = Column(Integer, nullable=False)
    event_type = Column(String(64), nullable=False)  # barrier_updated, route_invalidated, barrier_resolved
    payload = Column(Text, default="{}")  # JSON payload
    created_at = Column(DateTime, default=utc_now)

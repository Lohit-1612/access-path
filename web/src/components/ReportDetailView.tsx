import React, { useState, useEffect } from 'react';
import { ReportDetail, CandidateEdge } from '../types';
import { fetchReport, patchReport } from '../api';
import {
  Sparkles, CheckCircle2, AlertTriangle, ShieldAlert,
  ArrowRight, Layers, Tag, Eye
} from 'lucide-react';

interface ReportDetailViewProps {
  reportId: string;
  onConfirmed: () => void;
  onCancel: () => void;
}

export const ReportDetailView: React.FC<ReportDetailViewProps> = ({
  reportId,
  onConfirmed,
  onCancel
}) => {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form confirmation state
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [extent, setExtent] = useState<'complete' | 'partial'>('complete');
  const [direction, setDirection] = useState<'both' | 'forward' | 'backward'>('both');
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    fetchReport(reportId)
      .then((data) => {
        if (!mounted) return;
        setReport(data);
        setSelectedCategory(data.category);
        setNotes(data.notes || '');

        // Auto-select the nearest candidate edge if any
        if (data.candidate_edges && data.candidate_edges.length > 0) {
          const nearest = data.candidate_edges[0];
          setSelectedEdges([`${nearest.edge_id}_fwd`, `${nearest.edge_id}_rev`]);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setErrorMsg(err.message || 'Failed to load report detail.');
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [reportId]);

  const toggleEdge = (edgeId: string) => {
    const fwd = `${edgeId}_fwd`;
    const rev = `${edgeId}_rev`;
    if (selectedEdges.includes(fwd) || selectedEdges.includes(rev)) {
      setSelectedEdges(selectedEdges.filter((e) => e !== fwd && e !== rev && e !== edgeId));
    } else {
      setSelectedEdges([...selectedEdges, fwd, rev]);
    }
  };

  const handleConfirmAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report) return;
    if (selectedEdges.length === 0) {
      setErrorMsg('Please select at least one affected pedestrian pathway.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      await patchReport(report.id, {
        corrected_category: selectedCategory,
        affected_edge_ids: selectedEdges,
        extent,
        direction,
        notes,
        expected_version: report.version
      });
      onConfirmed();
    } catch (err: any) {
      setErrorMsg(err.message || 'Conflict or update failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md border border-slate-200 p-8 text-center">
        <Sparkles className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-slate-700 font-semibold">Running OWLv2 Inference & Candidate Edge Matching...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 text-center text-slate-600">
        <p>Report not found.</p>
        <button onClick={onCancel} className="mt-3 text-blue-600 underline">Go Back</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            AI Detections & Evidence Confirmation
          </h2>
          <span className="text-xs text-slate-500">Report ID: {report.id} (Version {report.version})</span>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">
          State: {report.status}
        </span>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Image with Overlaid Bounding Boxes */}
      <div className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-300 flex items-center justify-center max-h-[380px]">
        {report.image_url ? (
          <div className="relative inline-block max-w-full">
            <img
              src={report.image_url}
              alt="Uploaded barrier evidence"
              className="max-h-[380px] w-auto object-contain block mx-auto"
            />
            {/* Overlay bounding boxes */}
            {report.detections.map((det, idx) => {
              const left = `${det.box_x1 * 100}%`;
              const top = `${det.box_y1 * 100}%`;
              const width = `${(det.box_x2 - det.box_x1) * 100}%`;
              const height = `${(det.box_y2 - det.box_y1) * 100}%`;

              return (
                <div
                  key={det.id || idx}
                  style={{ left, top, width, height }}
                  className="absolute border-2 border-rose-500 bg-rose-500/20 rounded pointer-events-none"
                >
                  <div className="absolute -top-6 left-0 bg-rose-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                    {det.label} (Score: {Math.round(det.raw_score * 100)}%)
                    {det.is_precomputed && <span className="ml-1 opacity-80">[benchmark]</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-slate-400">No image evidence attached</div>
        )}
      </div>

      {/* Model Revision and Detection Metadata */}
      {report.detections.length > 0 && (
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-slate-700">Model:</span>
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-800">
              {report.detections[0].model_revision}
            </code>
          </div>
          <div className="text-slate-600">
            Prompt: <em>"{report.detections[0].prompt}"</em>
          </div>
        </div>
      )}

      {/* Human Verification Form (Section 5 Stage 3) */}
      <form onSubmit={handleConfirmAndSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="confirm-category" className="block text-xs font-bold uppercase text-slate-700 mb-1">
              Confirm / Correct Barrier Label:
            </label>
            <select
              id="confirm-category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-medium bg-slate-50"
            >
              <option value="construction">Construction Barricade / Excavation</option>
              <option value="stairs">Flight of Stairs</option>
              <option value="damaged_surface">Pothole / Damaged Pavement</option>
              <option value="blockage">Blocked Path / Scooter / Obstacle</option>
              <option value="missing_ramp">Missing Ramp</option>
              <option value="steep_slope">Excessive Slope</option>
            </select>
          </div>

          <div>
            <label htmlFor="confirm-extent" className="block text-xs font-bold uppercase text-slate-700 mb-1">
              Obstruction Extent:
            </label>
            <select
              id="confirm-extent"
              value={extent}
              onChange={(e) => setExtent(e.target.value as any)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-medium bg-slate-50"
            >
              <option value="complete">Complete Blockage (Impassable for Wheelchairs)</option>
              <option value="partial">Partial Obstruction (Passable with Care)</option>
            </select>
          </div>
        </div>

        {/* Candidate Edge Selection within Search Radius (Section 8: ST_DWithin) */}
        <div>
          <label className="block text-xs font-bold uppercase text-slate-700 mb-1 flex items-center justify-between">
            <span>Select Affected Walkway Segment(s) within 35m Radius:</span>
            <span className="text-xs font-normal text-blue-600 font-sans">
              {report.candidate_edges.length} nearby candidate edges
            </span>
          </label>

          <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50">
            {report.candidate_edges.map((cand) => {
              const isSelected = selectedEdges.some((e) => e.startsWith(cand.edge_id));
              return (
                <div
                  key={cand.edge_id}
                  onClick={() => toggleEdge(cand.edge_id)}
                  className={`p-2.5 rounded-lg border cursor-pointer text-xs transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-blue-50 border-blue-500 text-blue-900 font-semibold'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}} // handled by parent onClick
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <div>
                      <p className="font-bold text-slate-900">{cand.name}</p>
                      <p className="text-slate-500 text-[11px]">
                        From: {cand.from_node_name} → To: {cand.to_node_name} | {cand.surface}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="bg-slate-200 px-2 py-0.5 rounded text-[11px] font-bold text-slate-700">
                      {cand.distance_to_pin_m} m away
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="confirm-notes" className="block text-xs font-bold uppercase text-slate-700 mb-1">
            Additional Observations / Notes:
          </label>
          <input
            id="confirm-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-slate-50"
            placeholder="e.g., Construction blocks the east footpath entirely."
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-6 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg shadow flex items-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            <span>Confirm Evidence & Submit to Review Queue</span>
          </button>
        </div>
      </form>
    </div>
  );
};

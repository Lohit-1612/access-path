import React, { useState, useEffect } from 'react';
import { BarrierItem, ReportDetail } from '../types';
import { fetchBarriers, fetchReport, submitReview } from '../api';
import {
  ShieldCheck, AlertTriangle, Check, X, CheckCheck,
  Clock, RefreshCw, FileText, ChevronRight
} from 'lucide-react';

interface ReviewQueueProps {
  onRevisionChanged: () => void;
}

export const ReviewQueue: React.FC<ReviewQueueProps> = ({ onRevisionChanged }) => {
  const [barriers, setBarriers] = useState<BarrierItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [actionReason, setActionReason] = useState<string>('Verified by campus facilities inspector');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadBarriers = () => {
    setLoading(true);
    const filter = statusFilter === 'all' ? undefined : statusFilter;
    fetchBarriers(filter)
      .then((data) => {
        setBarriers(data);
        if (data.length > 0 && !selectedReportId) {
          setSelectedReportId(data[0].id);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadBarriers();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedReportId) {
      setDetail(null);
      return;
    }
    fetchReport(selectedReportId)
      .then(setDetail)
      .catch(console.error);
  }, [selectedReportId]);

  const handleAction = async (action: 'verify' | 'dispute' | 'reject' | 'resolve') => {
    if (!detail) return;
    if (!actionReason.trim()) {
      setMsg({ text: 'Please enter a reason for this audit action.', type: 'error' });
      return;
    }

    setSubmitting(true);
    setMsg(null);

    try {
      const res = await submitReview(detail.id, {
        action,
        reason: actionReason,
        expected_version: detail.version,
        actor_name: 'Dr. Sarah Miller (Campus Verifier)'
      });

      setMsg({
        text: `Successfully performed '${action}'. Graph revision updated to #${res.graph_revision}.`,
        type: 'success'
      });

      // Reload detail and list
      const updated = await fetchReport(detail.id);
      setDetail(updated);
      loadBarriers();
      onRevisionChanged();
    } catch (err: any) {
      setMsg({ text: err.message || 'Action failed.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified_active':
        return <span className="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded text-xs">Active Barrier</span>;
      case 'pending':
        return <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-xs">Pending Review</span>;
      case 'resolved':
        return <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-xs">Resolved (Clear)</span>;
      case 'disputed':
        return <span className="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded text-xs">Disputed</span>;
      case 'stale':
        return <span className="bg-orange-100 text-orange-800 font-bold px-2 py-0.5 rounded text-xs">Stale (&gt;24h)</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded text-xs">{status}</span>;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Verifier Review Queue & Barrier Lifecycle
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Resolve uncertainty, confirm affected pedestrian paths, and publish atomic graph revisions.
          </p>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-300 text-xs font-semibold">
          {['all', 'pending', 'verified_active', 'resolved'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-md capitalize transition-colors ${
                statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
          <button
            onClick={loadBarriers}
            className="p-1.5 text-slate-600 hover:text-slate-900"
            title="Refresh queue"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Two Column Layout: List on Left, Detail & Actions on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Barrier Items List */}
        <div className="lg:col-span-5 space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {barriers.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-lg border">
              No reports matching "{statusFilter}".
            </div>
          ) : (
            barriers.map((b) => (
              <div
                key={b.id}
                onClick={() => setSelectedReportId(b.id)}
                className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start justify-between gap-3 ${
                  selectedReportId === b.id
                    ? 'bg-blue-50 border-blue-500 shadow-sm'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-900 text-sm capitalize">
                      {b.category.replace('_', ' ')}
                    </span>
                    {getStatusBadge(b.status)}
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-1">{b.notes || 'No description notes'}</p>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {b.freshness_hours} hrs ago
                    </span>
                    <span>{b.affected_edge_ids.length} edge(s)</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 mt-2 shrink-0" />
              </div>
            ))
          )}
        </div>

        {/* Right: Selected Detail & Verification Actions */}
        <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
          {detail ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 capitalize">
                    {detail.category.replace('_', ' ')} Report
                  </h3>
                  <span className="text-xs text-slate-500">ID: {detail.id} | Version: {detail.version}</span>
                </div>
                {getStatusBadge(detail.status)}
              </div>

              {/* Photo Evidence with detections */}
              {detail.image_url && (
                <div className="relative rounded-lg overflow-hidden border border-slate-300 max-h-52 bg-black flex items-center justify-center">
                  <img
                    src={detail.image_url}
                    alt="Evidence"
                    className="max-h-52 w-auto object-contain"
                  />
                  {detail.detections.map((det, idx) => (
                    <div
                      key={idx}
                      style={{
                        left: `${det.box_x1 * 100}%`,
                        top: `${det.box_y1 * 100}%`,
                        width: `${(det.box_x2 - det.box_x1) * 100}%`,
                        height: `${(det.box_y2 - det.box_y1) * 100}%`
                      }}
                      className="absolute border-2 border-emerald-400 bg-emerald-400/20 pointer-events-none"
                    >
                      <span className="bg-emerald-600 text-white text-[10px] font-bold px-1 rounded absolute -top-5 left-0">
                        {det.label} ({Math.round(det.raw_score * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Details & Affected Path Info */}
              <div className="space-y-2 text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200">
                <p><strong>Reporter Observation:</strong> {detail.notes || 'None'}</p>
                <p><strong>Affected Edges:</strong> {detail.affected_edges.join(', ') || 'No edges mapped yet'}</p>
                <p><strong>Observed At:</strong> {new Date(detail.observed_at).toLocaleString()}</p>
              </div>

              {/* Audit Action Panel (Section 8: Every transition records actor, old state, new state, reason) */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Perform Verifier Moderation Action
                </h4>

                <div>
                  <label htmlFor="audit-reason" className="block text-xs font-semibold text-slate-600 mb-1">
                    Audit Log Reason:
                  </label>
                  <input
                    id="audit-reason"
                    type="text"
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    className="w-full h-9 px-3 rounded border border-slate-300 text-xs bg-slate-50"
                    placeholder="Enter verifiable reason for audit log..."
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleAction('verify')}
                    disabled={submitting}
                    className="min-h-[44px] px-2 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow flex flex-col items-center justify-center gap-1"
                  >
                    <Check className="w-4 h-4" />
                    Verify Active
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAction('resolve')}
                    disabled={submitting}
                    className="min-h-[44px] px-2 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold shadow flex flex-col items-center justify-center gap-1"
                  >
                    <CheckCheck className="w-4 h-4" />
                    Verify Clearance
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAction('dispute')}
                    disabled={submitting}
                    className="min-h-[44px] px-2 py-2 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white rounded-lg text-xs font-bold shadow flex flex-col items-center justify-center gap-1"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Dispute
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAction('reject')}
                    disabled={submitting}
                    className="min-h-[44px] px-2 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-bold shadow flex flex-col items-center justify-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Reject Report
                  </button>
                </div>
              </div>

              {/* Audit History Log */}
              {detail.reviews.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Review Audit Trail
                  </h4>
                  <div className="space-y-1.5">
                    {detail.reviews.map((r, idx) => (
                      <div key={idx} className="p-2 bg-white rounded border border-slate-200 text-xs">
                        <div className="flex items-center justify-between text-slate-500 text-[11px]">
                          <span>{r.actor_name}</span>
                          <span>{new Date(r.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="font-semibold text-slate-800 mt-0.5">
                          {r.old_state} → {r.new_state} ({r.action})
                        </p>
                        <p className="text-slate-600 italic">"{r.reason}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-12 text-center text-slate-400">
              Select a report from the list on the left to inspect evidence and review.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

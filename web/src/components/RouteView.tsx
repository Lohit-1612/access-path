import React, { useState } from 'react';
import { RouteResponse, MobilityProfile } from '../types';
import {
  AlertTriangle, CheckCircle2, Volume2, VolumeX, ShieldCheck,
  RefreshCw, Navigation, CornerUpRight, Info
} from 'lucide-react';

interface RouteViewProps {
  route: RouteResponse | null;
  profile: MobilityProfile;
  originName: string;
  destName: string;
  onRefresh: () => void;
  onStartNavigation?: () => void;
}

export const RouteView: React.FC<RouteViewProps> = ({
  route,
  profile,
  originName,
  destName,
  onRefresh,
  onStartNavigation
}) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  if (!route) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        <Navigation className="w-12 h-12 mx-auto text-slate-400 mb-3" />
        <p className="text-lg font-medium text-slate-700">No journey planned yet</p>
        <p className="text-sm">Select origin and destination and click "Calculate Accessible Route".</p>
      </div>
    );
  }

  const turnCount = route.turn_count !== undefined
    ? route.turn_count
    : route.steps.filter(s => s.instruction.toLowerCase().includes('turn')).length;

  const isDetour = route.reason_codes.includes('BLOCKED_EDGE_AVOIDED') || route.reason_codes.includes('UNVERIFIED_BLOCKAGE_AVOIDED');
  const isUnverifiedDetour = route.reason_codes.includes('UNVERIFIED_BLOCKAGE_AVOIDED');

  // Handle Voice Synthesis (Page 10: user initiated start & stop control)
  const handleToggleSpeech = () => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this browser.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const textToRead = [
      route.explanation || `Route to ${destName}. Total distance ${route.total_distance_m} metres.`,
      ...route.steps.map((s, idx) => `Step ${idx + 1}: ${s.instruction}.`)
    ].join(' ');

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 space-y-6">
      {/* Polite ARIA Live Region for dynamic route changes */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {route.explanation}
      </div>

      {/* Header & Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-900">
              {originName} → {destName}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300">
              {profile.name}
            </span>
            {isDetour && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                isUnverifiedDetour ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-rose-100 text-rose-900 border border-rose-300'
              }`}>
                {isUnverifiedDetour ? 'Provisional Detour' : 'Active Detour'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Pedestrian Network Revision #{route.graph_revision}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {route.status === 'ok' && onStartNavigation && (
            <button
              type="button"
              onClick={onStartNavigation}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm flex items-center gap-1.5 shadow transition-all"
            >
              <Navigation className="w-4 h-4 fill-white" />
              <span>Start Navigation</span>
            </button>
          )}

          {route.status === 'ok' && (
            <button
              type="button"
              onClick={handleToggleSpeech}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 border transition-all ${
                isSpeaking
                  ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
              aria-label={isSpeaking ? 'Stop voice readout' : 'Read route instructions aloud'}
            >
              {isSpeaking ? <VolumeX className="w-5 h-5 text-amber-600" /> : <Volume2 className="w-5 h-5 text-blue-600" />}
              <span>{isSpeaking ? 'Stop Audio' : 'Voice Guidance'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 text-sm font-medium flex items-center gap-1"
            title="Recalculate with current live graph"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Explanations & Alerts */}
      {route.status === 'no_route' ? (
        <div className="bg-rose-50 border-l-4 border-rose-600 p-4 rounded-r-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-rose-900 text-base">No Accessible Route Found</h3>
              <p className="text-sm text-rose-800 mt-1">{route.explanation}</p>
              <ul className="mt-2 text-xs text-rose-700 list-disc list-inside space-y-0.5">
                {route.reason_codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              {route.reason_codes.includes('BLOCKED_EDGE_AVOIDED') && (
                <div className="mt-3 pt-3 border-t border-rose-200 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-rose-800 font-medium">
                    Verified barriers are blocking step-free pathways.
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const { resetDemo } = await import('../api');
                      await resetDemo();
                      onRefresh();
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                  >
                    Clear Active Barriers & Restore Paths
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Detour or Standard Explanation Banner */}
          <div className={`p-4 rounded-lg border flex items-start gap-3 ${
            isDetour
              ? (isUnverifiedDetour ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-amber-50 border-amber-300 text-amber-900')
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}>
            {isDetour ? (
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3 className="font-bold text-base">
                {isUnverifiedDetour
                  ? 'Provisional Barrier Detour (Pending Verification)'
                  : isDetour
                  ? 'Dynamic Barrier Avoidance Active'
                  : 'Accessible Surveyed Path'}
              </h3>
              <p className="text-sm mt-0.5">{route.explanation}</p>
              {route.warnings.length > 0 && (
                <div className="mt-2 pt-2 border-t border-amber-200/60 text-xs space-y-1">
                  {route.warnings.map((w, idx) => (
                    <p key={idx} className="flex items-center gap-1.5 text-amber-800">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Metrics bar: Distance, Turn Count, Evidence Coverage, Stairs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Actual Distance</span>
              <p className="text-xl font-extrabold text-slate-900">{route.actual_length_m} m</p>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Turns</span>
              <p className="text-xl font-extrabold text-slate-900">
                {turnCount} <span className="text-xs font-normal text-slate-500">({route.steps.length} segments)</span>
              </p>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Evidence Coverage</span>
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-base font-extrabold text-emerald-700">
                    {Math.round(route.evidence_coverage * 100)}%
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEvidence(!showEvidence)}
                  className="text-xs font-bold text-blue-700 hover:text-blue-900 underline"
                  title="View measured pathway attributes and survey dates"
                >
                  {showEvidence ? 'Hide' : 'Evidence'}
                </button>
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Stairs Status</span>
              <p className="text-sm font-bold text-emerald-600 mt-1">
                {profile.exclude_stairs ? '0 Steps (Step-Free)' : 'Steps Permitted'}
              </p>
            </div>
          </div>

          {/* Collapsible Genuine Evidence Panel */}
          {showEvidence && (
            <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h4 className="font-bold text-sm text-slate-900">
                    Route Evidence & Verified Attributes Breakdown
                  </h4>
                </div>
                <span className="text-xs font-mono font-semibold text-slate-500">
                  {route.evidence_breakdown
                    ? `${route.evidence_breakdown.verified_segments} of ${route.evidence_breakdown.total_segments} segments verified (${route.evidence_breakdown.verified_length_m}m of ${route.evidence_breakdown.total_length_m}m)`
                    : `${Math.round(route.evidence_coverage * 100)}% Verified`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-200 text-slate-700 uppercase font-bold text-[10px]">
                    <tr>
                      <th className="p-2">Segment</th>
                      <th className="p-2">Length</th>
                      <th className="p-2">Surface</th>
                      <th className="p-2">Slope (%)</th>
                      <th className="p-2">Width (m)</th>
                      <th className="p-2">Stairs</th>
                      <th className="p-2">Source</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {route.steps.map((s, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2 font-medium text-slate-800">{s.name}</td>
                        <td className="p-2 font-mono">{s.distance_m}m</td>
                        <td className="p-2 capitalize">{s.surface || 'Unknown'}</td>
                        <td className="p-2 font-mono">
                          {s.slope_pct !== undefined && s.slope_pct !== null ? `${s.slope_pct}%` : <span className="text-slate-400">Unmeasured</span>}
                        </td>
                        <td className="p-2 font-mono">
                          {s.width_m ? `${s.width_m}m` : <span className="text-slate-400">Unknown</span>}
                        </td>
                        <td className="p-2">
                          {s.stairs ? <span className="text-amber-700 font-bold">Yes (Stairs)</span> : <span className="text-emerald-700 font-semibold">No (Step-free)</span>}
                        </td>
                        <td className="p-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                            {s.source || 'survey'}
                          </span>
                        </td>
                        <td className="p-2">
                          {s.is_verified !== false ? (
                            <span className="text-emerald-700 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <span className="text-amber-700 font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              <span>Unverified</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500 italic">
                * Unknown parameters are reported honestly without assuming default accessibility values.
              </p>
            </div>
          )}

          {/* Turn-by-Turn Ordered Accessible Text View (WCAG / Low Vision requirement) */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
              <CornerUpRight className="w-5 h-5 text-blue-600" />
              Turn-by-Turn Accessible Directions
            </h3>

            <ol className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {route.steps.map((step, idx) => (
                <li key={step.edge_id + idx} className="p-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 text-sm">{step.instruction}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                      <span>Surface: <strong className="capitalize">{step.surface}</strong></span>
                      {step.slope_pct !== undefined && step.slope_pct !== null && (
                        <span>Slope: <strong>{step.slope_pct}%</strong></span>
                      )}
                      {step.width_m && (
                        <span>Width: <strong>{step.width_m}m</strong></span>
                      )}
                    </div>
                    {step.warning && (
                      <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200 mt-1.5 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" />
                        {step.warning}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
};

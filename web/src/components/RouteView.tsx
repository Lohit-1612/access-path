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

  if (!route) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        <Navigation className="w-12 h-12 mx-auto text-slate-400 mb-3" />
        <p className="text-lg font-medium text-slate-700">No journey planned yet</p>
        <p className="text-sm">Select origin and destination and click "Calculate Accessible Route".</p>
      </div>
    );
  }

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
                    Verified barriers from testing are blocking step-free pathways.
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
            route.reason_codes.includes('BLOCKED_EDGE_AVOIDED')
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}>
            {route.reason_codes.includes('BLOCKED_EDGE_AVOIDED') ? (
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3 className="font-bold text-base">
                {route.reason_codes.includes('BLOCKED_EDGE_AVOIDED')
                  ? 'Dynamic Barrier Avoidance Active'
                  : 'Surveyed Accessible Path'}
              </h3>
              <p className="text-sm mt-0.5">{route.explanation}</p>
            </div>
          </div>

          {/* Metrics bar: Distance, Evidence Coverage */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Actual Distance</span>
              <p className="text-xl font-extrabold text-slate-900">{route.actual_length_m} m</p>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Turn Count</span>
              <p className="text-xl font-extrabold text-slate-900">{route.steps.length} segments</p>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Evidence Coverage</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span className="text-base font-extrabold text-emerald-700">
                  {Math.round(route.evidence_coverage * 100)}% Verified
                </span>
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Stairs Status</span>
              <p className="text-sm font-bold text-emerald-600 mt-1">
                {profile.exclude_stairs ? '0 Steps (Step-Free)' : 'Steps Permitted'}
              </p>
            </div>
          </div>

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

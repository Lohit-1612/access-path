import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RouteResponse, RouteStep } from '../types';
import {
  ArrowUp, CornerUpLeft, CornerUpRight, ArrowUpRight, ArrowUpLeft,
  Flag, Volume2, VolumeX, X, Play, Pause, RotateCcw,
  LocateFixed, Compass, ShieldCheck, CheckCircle2, Eye, Globe
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  translateInstruction,
  speakText,
  playAlertSound,
  triggerHapticAlert
} from '../utils/language';

interface LiveNavigationHUDProps {
  route: RouteResponse;
  originName: string;
  destName: string;
  userLocation: [number, number] | null;
  onUpdateUserLocation: (pos: [number, number]) => void;
  onExitNavigation: () => void;
  isAutoFollow: boolean;
  onToggleAutoFollow: () => void;
  heading: number;
  onHeadingChange: (h: number) => void;
  selectedLanguage?: string;
  onLanguageChange?: (lang: string) => void;
  onToggleBlindCamera?: () => void;
  isBlindCameraOpen?: boolean;
}

// Haversine distance in meters
function haversineDistM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute bearing in degrees (0-360)
function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

export const LiveNavigationHUD: React.FC<LiveNavigationHUDProps> = ({
  route,
  originName,
  destName,
  userLocation,
  onUpdateUserLocation,
  onExitNavigation,
  isAutoFollow,
  onToggleAutoFollow,
  heading,
  onHeadingChange,
  selectedLanguage = 'en',
  onLanguageChange,
  onToggleBlindCamera,
  isBlindCameraOpen = false
}) => {
  // Navigation State
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [distanceToNextTurn, setDistanceToNextTurn] = useState<number>(0);
  const [remainingDistanceM, setRemainingDistanceM] = useState<number>(route.total_distance_m);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(1); // 1x, 2x, 4x
  const [simProgressDist, setSimProgressDist] = useState<number>(0);
  const [hasArrived, setHasArrived] = useState<boolean>(false);

  const lastSpokenStepRef = useRef<number>(-1);
  const lastMatchedIdxRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  // Extract all points along the route geometry
  const routePoints: [number, number][] = React.useMemo(() => {
    if (!route.geometry || !route.geometry.features) return [];
    const pts: [number, number][] = [];
    route.geometry.features.forEach((f: any) => {
      f.geometry.coordinates.forEach(([lon, lat]: [number, number]) => {
        pts.push([lat, lon]);
      });
    });
    return pts;
  }, [route]);

  // Compute cumulative distances for each vertex along the route
  const cumulativeDistances = React.useMemo(() => {
    if (routePoints.length === 0) return [];
    const dists = [0];
    let total = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      const d = haversineDistM(
        routePoints[i][0],
        routePoints[i][1],
        routePoints[i + 1][0],
        routePoints[i + 1][1]
      );
      total += d;
      dists.push(total);
    }
    return dists;
  }, [routePoints]);

  const totalRouteDist = cumulativeDistances.length > 0 ? cumulativeDistances[cumulativeDistances.length - 1] : route.total_distance_m;

  // Speak turn-by-turn instruction via multilingual Web Speech API
  const speakInstruction = useCallback((rawInstruction: string) => {
    if (!voiceEnabled) return;
    const translated = translateInstruction(rawInstruction, selectedLanguage);
    speakText(translated, selectedLanguage);
  }, [voiceEnabled, selectedLanguage]);

  // Announce initial start when navigation begins
  useEffect(() => {
    lastMatchedIdxRef.current = 0;
    setHasArrived(false);
    if (route.steps.length > 0) {
      const initialMsg = `Starting accessible navigation to ${destName}. ${route.steps[0].instruction}`;
      speakInstruction(initialMsg);
      lastSpokenStepRef.current = 0;
    }
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [route, destName, speakInstruction]);

  // Interpolate point along route given distance along line
  const getPointAtDistance = useCallback((dist: number): { pos: [number, number]; bearing: number; stepIdx: number } => {
    if (routePoints.length === 0) {
      return { pos: [0, 0], bearing: 0, stepIdx: 0 };
    }
    if (dist <= 0) {
      const b = routePoints.length > 1 ? computeBearing(routePoints[0][0], routePoints[0][1], routePoints[1][0], routePoints[1][1]) : 0;
      return { pos: routePoints[0], bearing: b, stepIdx: 0 };
    }
    if (dist >= totalRouteDist) {
      const last = routePoints.length - 1;
      const b = last > 0 ? computeBearing(routePoints[last - 1][0], routePoints[last - 1][1], routePoints[last][0], routePoints[last][1]) : 0;
      return { pos: routePoints[last], bearing: b, stepIdx: Math.max(0, route.steps.length - 1) };
    }

    // Find segment
    let segIdx = 0;
    for (let i = 0; i < cumulativeDistances.length - 1; i++) {
      if (dist >= cumulativeDistances[i] && dist <= cumulativeDistances[i + 1]) {
        segIdx = i;
        break;
      }
    }

    const segStartDist = cumulativeDistances[segIdx];
    const segEndDist = cumulativeDistances[segIdx + 1];
    const segSpan = segEndDist - segStartDist;
    const ratio = segSpan > 0 ? (dist - segStartDist) / segSpan : 0;

    const p1 = routePoints[segIdx];
    const p2 = routePoints[segIdx + 1];

    const lat = p1[0] + (p2[0] - p1[0]) * ratio;
    const lon = p1[1] + (p2[1] - p1[1]) * ratio;
    const bearing = computeBearing(p1[0], p1[1], p2[0], p2[1]);

    // Map to step in route.steps
    let stepAccum = 0;
    let foundStep = 0;
    for (let s = 0; s < route.steps.length; s++) {
      stepAccum += route.steps[s].distance_m;
      if (dist <= stepAccum) {
        foundStep = s;
        break;
      }
    }

    return { pos: [lat, lon], bearing, stepIdx: foundStep };
  }, [routePoints, cumulativeDistances, totalRouteDist, route.steps]);

  // Simulation loop (requestAnimationFrame with delta timing)
  useEffect(() => {
    if (!isSimulating) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let lastTime = performance.now();
    const walkingSpeedMps = 1.35 * simSpeed; // 1.35 m/s (~4.8 km/h pedestrian pace)

    const stepSimulation = (now: number) => {
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;

      setSimProgressDist((prev) => {
        const nextDist = prev + walkingSpeedMps * dt;
        if (nextDist >= totalRouteDist) {
          setIsSimulating(false);
          setHasArrived(true);
          speakInstruction(`You have arrived at your destination: ${destName}.`);
          playAlertSound();
          triggerHapticAlert();
          const finalInfo = getPointAtDistance(totalRouteDist);
          onUpdateUserLocation(finalInfo.pos);
          onHeadingChange(finalInfo.bearing);
          setCurrentStepIndex(Math.max(0, route.steps.length - 1));
          setRemainingDistanceM(0);
          setDistanceToNextTurn(0);
          return totalRouteDist;
        }

        const info = getPointAtDistance(nextDist);
        onUpdateUserLocation(info.pos);
        onHeadingChange(info.bearing);
        setCurrentStepIndex(info.stepIdx);

        const remDist = Math.max(0, totalRouteDist - nextDist);
        setRemainingDistanceM(Math.round(remDist));

        // Calculate distance to current step turn
        let stepEndDist = 0;
        for (let s = 0; s <= info.stepIdx; s++) {
          stepEndDist += route.steps[s].distance_m;
        }
        setDistanceToNextTurn(Math.max(0, Math.round(stepEndDist - nextDist)));

        // Trigger voice announcement when entering new step
        if (info.stepIdx !== lastSpokenStepRef.current && info.stepIdx < route.steps.length) {
          lastSpokenStepRef.current = info.stepIdx;
          const s = route.steps[info.stepIdx];
          speakInstruction(`${s.instruction}.`);
        }

        return nextDist;
      });

      animFrameRef.current = requestAnimationFrame(stepSimulation);
    };

    animFrameRef.current = requestAnimationFrame(stepSimulation);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isSimulating, simSpeed, totalRouteDist, getPointAtDistance, onUpdateUserLocation, onHeadingChange, route.steps, speakInstruction, destName]);

  // Real GPS live updates handler (Fixed: Monotonic progression & Honest Arrival Gating)
  useEffect(() => {
    if (isSimulating || !userLocation || routePoints.length === 0) return;

    // Search forward along route vertices starting from last matched position
    const searchStart = Math.max(0, lastMatchedIdxRef.current - 1);
    const searchEnd = Math.min(routePoints.length - 1, lastMatchedIdxRef.current + 4);

    let bestDist = Infinity;
    let bestIdx = lastMatchedIdxRef.current;

    for (let i = searchStart; i <= searchEnd; i++) {
      const d = haversineDistM(userLocation[0], userLocation[1], routePoints[i][0], routePoints[i][1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    // Only progress forward if reasonable match found
    if (bestDist < 60) {
      lastMatchedIdxRef.current = Math.max(lastMatchedIdxRef.current, bestIdx);
    }

    const currentDistOnRoute = cumulativeDistances[lastMatchedIdxRef.current] || 0;
    const remDist = Math.max(0, totalRouteDist - currentDistOnRoute);
    setRemainingDistanceM(Math.round(remDist));

    // Find active step
    let stepAccum = 0;
    let foundStep = 0;
    for (let s = 0; s < route.steps.length; s++) {
      stepAccum += route.steps[s].distance_m;
      if (currentDistOnRoute <= stepAccum) {
        foundStep = s;
        break;
      }
    }
    setCurrentStepIndex(foundStep);
    setDistanceToNextTurn(Math.max(0, Math.round(stepAccum - currentDistOnRoute)));

    if (foundStep !== lastSpokenStepRef.current && foundStep < route.steps.length) {
      lastSpokenStepRef.current = foundStep;
      speakInstruction(`${route.steps[foundStep].instruction}.`);
    }

    // Robust Arrival Gating:
    // User must be within 12m of actual terminal coordinate AND on final step AND traversed >= 70% of route
    const destPoint = routePoints[routePoints.length - 1];
    const distToDestCoord = haversineDistM(userLocation[0], userLocation[1], destPoint[0], destPoint[1]);
    const isAtEnd = lastMatchedIdxRef.current >= routePoints.length - 2;
    const hasTraveledEnough = totalRouteDist <= 15 || currentDistOnRoute >= totalRouteDist * 0.7;

    if (distToDestCoord <= 12 && isAtEnd && hasTraveledEnough && !hasArrived) {
      setHasArrived(true);
      speakInstruction(`You have arrived at your destination: ${destName}.`);
      playAlertSound();
      triggerHapticAlert();
    }
  }, [userLocation, isSimulating, routePoints, cumulativeDistances, totalRouteDist, route.steps, speakInstruction, destName, hasArrived]);

  const currentStep = route.steps[currentStepIndex] || route.steps[0];
  const nextStep = route.steps[currentStepIndex + 1];

  // Helper for maneuver turn icon
  const getTurnIcon = (step: RouteStep) => {
    const text = (step.instruction || '').toLowerCase();
    if (text.includes('left') && text.includes('slight')) return <ArrowUpLeft className="w-8 h-8 text-white" />;
    if (text.includes('right') && text.includes('slight')) return <ArrowUpRight className="w-8 h-8 text-white" />;
    if (text.includes('left')) return <CornerUpLeft className="w-8 h-8 text-white" />;
    if (text.includes('right')) return <CornerUpRight className="w-8 h-8 text-white" />;
    if (text.includes('arrive') || text.includes('destination') || text.includes('approach')) return <Flag className="w-8 h-8 text-emerald-400" />;
    return <ArrowUp className="w-8 h-8 text-white" />;
  };

  // Remaining walking time estimate (at 1.3 m/s)
  const remainingMinutes = Math.max(1, Math.round(remainingDistanceM / 78));
  const etaDate = new Date(Date.now() + remainingMinutes * 60000);
  const etaString = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Translated instruction for display
  const displayInstruction = hasArrived
    ? translateInstruction(`You have arrived at your destination: ${destName}`, selectedLanguage)
    : translateInstruction(currentStep.instruction, selectedLanguage);

  return (
    <>
      {/* 1. TOP GOOGLE MAPS NAVIGATION BANNER (HUD) */}
      <div className="absolute top-3 left-3 right-3 sm:left-6 sm:right-6 z-[500] pointer-events-auto">
        <div className="bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 p-4 transition-all">
          <div className="flex items-start gap-3.5">
            {/* Turn Maneuver Icon Box */}
            <div className="w-14 h-14 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg border border-emerald-400/40">
              {getTurnIcon(currentStep)}
            </div>

            {/* Instruction Details */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-emerald-400 text-lg sm:text-xl font-extrabold font-mono tracking-tight">
                  {hasArrived
                    ? 'Arrived'
                    : (distanceToNextTurn || currentStep.distance_m) >= 1000
                    ? `In ${((distanceToNextTurn || currentStep.distance_m) / 1000).toFixed(1)} km`
                    : `In ${distanceToNextTurn || currentStep.distance_m} m`}
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  Step {currentStepIndex + 1} of {route.steps.length}
                </span>

                {/* Multilingual Selector Badge */}
                {onLanguageChange && (
                  <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-full px-2 py-0.5 ml-auto">
                    <Globe className="w-3 h-3 text-blue-400" />
                    <select
                      value={selectedLanguage}
                      onChange={(e) => onLanguageChange(e.target.value)}
                      className="bg-transparent text-[11px] font-bold text-slate-200 focus:outline-none cursor-pointer"
                      title="Navigation Voice Language"
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code} className="bg-slate-900 text-white">
                          {l.nativeName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Main Spoken Instruction Card */}
              <h2 className="text-base sm:text-lg font-bold text-white leading-tight mt-0.5">
                {displayInstruction}
              </h2>

              {/* Street & Accessible Feature Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-300">
                <span className="flex items-center gap-1 text-emerald-300 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Step-Free Paved Walkway
                </span>
                {currentStep.slope_pct && (
                  <span className="text-slate-400">• Slope {currentStep.slope_pct}%</span>
                )}
                {currentStep.width_m && (
                  <span className="text-slate-400">• Width {currentStep.width_m}m</span>
                )}
              </div>
            </div>

            {/* Exit Navigation Button */}
            <button
              type="button"
              onClick={onExitNavigation}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors shrink-0"
              title="Exit Navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Next Turn Preview Strip */}
          {nextStep && !hasArrived && (
            <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2 truncate">
                <span className="font-semibold text-slate-300">Then:</span>
                <span className="truncate">{translateInstruction(nextStep.instruction, selectedLanguage)}</span>
              </div>
              <span className="font-mono text-slate-400 shrink-0 ml-2">
                +{nextStep.distance_m >= 1000 ? `${(nextStep.distance_m / 1000).toFixed(1)} km` : `${nextStep.distance_m}m`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. FLOATING CAMERA AUTO-FOLLOW & BLIND RADAR BUTTONS */}
      <div className="absolute bottom-24 right-4 z-[500] pointer-events-auto flex flex-col gap-2 items-end">
        {/* Toggle Blind Obstacle Camera */}
        {onToggleBlindCamera && (
          <button
            type="button"
            onClick={onToggleBlindCamera}
            className={`px-4 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2 border-2 border-white transition-all transform hover:scale-105 active:scale-95 ${
              isBlindCameraOpen
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
            title="Toggle Live Blind Walking Camera & Obstacle Detector"
          >
            <Eye className="w-4 h-4" />
            <span>{isBlindCameraOpen ? 'Close Blind Radar' : '👁️ Blind Vision Radar'}</span>
          </button>
        )}

        {/* Re-center Camera Auto-Follow */}
        {!isAutoFollow && (
          <button
            type="button"
            onClick={onToggleAutoFollow}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2 border-2 border-white transition-all transform hover:scale-105 active:scale-95 animate-bounce"
          >
            <LocateFixed className="w-4 h-4" />
            <span>Re-center Camera</span>
          </button>
        )}
      </div>

      {/* 3. BOTTOM GOOGLE MAPS NAVIGATION STATUS BAR */}
      <div className="absolute bottom-3 left-3 right-3 sm:left-6 sm:right-6 z-[500] pointer-events-auto">
        <div className="bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 p-4 transition-all">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Remaining Metrics (Google Maps Style) */}
            <div className="flex items-baseline gap-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-emerald-600 tracking-tight">
                  {hasArrived ? '0' : remainingMinutes}
                </span>
                <span className="text-sm font-bold text-slate-600">min</span>
              </div>

              <div className="text-xs text-slate-500 font-semibold border-l border-slate-300 pl-3">
                <p className="text-slate-800 text-sm font-bold font-mono">
                  {hasArrived
                    ? '0 m'
                    : remainingDistanceM >= 1000
                    ? `${(remainingDistanceM / 1000).toFixed(1)} km`
                    : `${remainingDistanceM} m`}
                </p>
                <p className="text-[11px] text-slate-400">
                  ETA {hasArrived ? 'Now' : etaString}
                </p>
              </div>
            </div>

            {/* Walk Simulation & Live Demo Controls */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  if (hasArrived) {
                    setSimProgressDist(0);
                    setHasArrived(false);
                  }
                  setIsSimulating(!isSimulating);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs ${
                  isSimulating
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
                title={isSimulating ? 'Pause Walk Simulation' : 'Start Walk Simulation'}
              >
                {isSimulating ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Simulate Walk</span>
                  </>
                )}
              </button>

              {/* Speed Multiplier */}
              <button
                type="button"
                onClick={() => setSimSpeed(simSpeed === 1 ? 2 : simSpeed === 2 ? 4 : 1)}
                className="px-2 py-1.5 text-xs font-mono font-bold text-slate-700 hover:text-slate-900 bg-white rounded-md border border-slate-200 transition-colors"
                title="Change simulation speed"
              >
                {simSpeed}x
              </button>

              {/* Reset Walk */}
              <button
                type="button"
                onClick={() => {
                  setIsSimulating(false);
                  setSimProgressDist(0);
                  setHasArrived(false);
                  lastMatchedIdxRef.current = 0;
                  const start = getPointAtDistance(0);
                  onUpdateUserLocation(start.pos);
                  onHeadingChange(start.bearing);
                  setCurrentStepIndex(0);
                  setRemainingDistanceM(totalRouteDist);
                }}
                className="p-1.5 text-slate-500 hover:text-slate-800 bg-white rounded-md border border-slate-200 transition-colors"
                title="Restart Route from Beginning"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Audio Toggle & Exit Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setVoiceEnabled(!voiceEnabled);
                  if (voiceEnabled && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                }}
                className={`p-2.5 rounded-xl border transition-all ${
                  voiceEnabled
                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                    : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                }`}
                title={voiceEnabled ? 'Mute Voice Directions' : 'Unmute Voice Directions'}
              >
                {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={onExitNavigation}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow transition-colors flex items-center gap-1.5"
              >
                <X className="w-4 h-4" />
                <span>Exit</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

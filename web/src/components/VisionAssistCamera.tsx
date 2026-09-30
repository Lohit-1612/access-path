import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, CameraOff, AlertTriangle, Eye, Volume2,
  RefreshCw, X, Maximize2, Minimize2, ShieldAlert,
  ChevronRight, VolumeX
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  translateInstruction,
  speakText,
  playAlertSound,
  triggerHapticAlert
} from '../utils/language';

interface VisionAssistCameraProps {
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface DetectedObstacle {
  label: string;
  prompt: string;
  confidence: number;
  position: 'left' | 'center' | 'right';
  suggested_action: string;
  distance_approx_m: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2] normalized 0-1
  warning: string;
}

export const VisionAssistCamera: React.FC<VisionAssistCameraProps> = ({
  selectedLanguage,
  onLanguageChange,
  isOpen,
  onClose
}) => {
  const [isCameraActive, setIsCameraActive] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [obstacles, setObstacles] = useState<DetectedObstacle[]>([]);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);
  const lastSpokenTimestampRef = useRef<number>(0);

  // Start device camera
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported in this browser context');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.warn);
      }
      setIsCameraActive(true);
    } catch (err) {
      console.warn('Camera access denied or unavailable, fallback active:', err);
      setIsCameraActive(false);
    }
  }, [facingMode]);

  // Stop device camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // Announce obstacle with voice, tone, and haptic feedback (throttled)
  const alertObstacle = useCallback((obs: DetectedObstacle) => {
    const now = Date.now();
    // 3.5s cooldown between consecutive voice alerts to avoid chatter
    if (now - lastSpokenTimestampRef.current > 3500) {
      lastSpokenTimestampRef.current = now;
      playAlertSound();
      triggerHapticAlert();
      if (!voiceMuted) {
        speakText(obs.warning, selectedLanguage);
      }
    }
  }, [selectedLanguage, voiceMuted]);

  // Draw bounding boxes on video overlay
  const drawOverlay = useCallback((detectedList: DetectedObstacle[]) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    detectedList.forEach((obs) => {
      const [x1, y1, x2, y2] = obs.box;
      const left = x1 * canvas.width;
      const top = y1 * canvas.height;
      const width = (x2 - x1) * canvas.width;
      const height = (y2 - y1) * canvas.height;

      // Outer glow and box
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#dc2626';
      ctx.shadowBlur = 8;
      ctx.strokeRect(left, top, width, height);

      // Semi-transparent danger fill
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(left, top, width, height);

      // Label background pill
      const labelText = `⚠️ ${obs.label.toUpperCase()} (${obs.distance_approx_m}m)`;
      ctx.font = 'bold 12px Inter, sans-serif';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillStyle = '#dc2626';
      ctx.shadowBlur = 0;
      ctx.fillRect(left, Math.max(0, top - 22), textWidth + 14, 22);

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, left + 7, Math.max(15, top - 6));
    });
  }, []);

  // Frame processing and obstacle detection call
  const analyzeFrame = useCallback(async (hintCategory?: string) => {
    setIsScanning(true);

    let base64Image: string | null = null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        base64Image = canvas.toDataURL('image/jpeg', 0.7);
      }
    }

    try {
      const res = await fetch('/api/vision/detect-obstacle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64Image,
          hint_category: hintCategory,
          language: selectedLanguage
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          setObstacles(data.obstacles || []);
          drawOverlay(data.obstacles || []);

          if (data.obstacles && data.obstacles.length > 0) {
            const first = data.obstacles[0];
            setLastWarning(first.warning);
            alertObstacle(first);
          } else {
            setLastWarning(null);
          }
        }
      }
    } catch (e) {
      console.warn('Vision detection fetch error:', e);
    } finally {
      setIsScanning(false);
    }
  }, [selectedLanguage, drawOverlay, alertObstacle]);

  // Periodic frame scanner loop
  useEffect(() => {
    if (!isOpen) return;

    scanIntervalRef.current = setInterval(() => {
      analyzeFrame();
    }, 1200);

    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, [isOpen, analyzeFrame]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-[600] transition-all duration-300 shadow-2xl rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 text-white ${
        isExpanded
          ? 'inset-3 sm:inset-6 flex flex-col'
          : 'bottom-20 right-3 sm:right-6 w-80 sm:w-96 h-64'
      }`}
      role="region"
      aria-label="Blind Navigation Vision Radar"
    >
      {/* Top Header Bar */}
      <div className="bg-slate-900/95 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="font-bold flex items-center gap-1.5 text-white">
            <Eye className="w-4 h-4 text-emerald-400" />
            Blind Vision Radar
          </span>
          {isScanning && (
            <span className="text-[10px] text-emerald-400 font-mono">Scanning...</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Language Selector */}
          <select
            value={selectedLanguage}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="bg-slate-800 text-white text-[11px] font-semibold rounded px-2 py-1 border border-slate-700 focus:ring-1 focus:ring-emerald-400 cursor-pointer"
            title="Choose Voice Announcement Language"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName} ({lang.name})
              </option>
            ))}
          </select>

          {/* Mute Voice */}
          <button
            type="button"
            onClick={() => setVoiceMuted(!voiceMuted)}
            className={`p-1.5 rounded hover:bg-slate-800 ${
              voiceMuted ? 'text-rose-400' : 'text-slate-300'
            }`}
            title={voiceMuted ? 'Unmute Obstacle Warnings' : 'Mute Obstacle Warnings'}
          >
            {voiceMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Flip Camera */}
          <button
            type="button"
            onClick={() => {
              setFacingMode(facingMode === 'environment' ? 'user' : 'environment');
              startCamera();
            }}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
            title="Switch Front/Rear Camera"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Expand / Minimize */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
            title={isExpanded ? 'Minimize Radar' : 'Expand Fullscreen Radar'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-rose-900/50 text-rose-400"
            title="Close Camera Radar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live Video Feed & Bounding Box Canvas */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />

        {/* Dynamic Bounding Box Overlay Canvas */}
        <canvas
          ref={overlayCanvasRef}
          width={640}
          height={480}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Hidden Canvas for Frame Capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* If Camera Permission Denied or Inactive */}
        {!isCameraActive && (
          <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center p-4 text-center">
            <CameraOff className="w-10 h-10 text-slate-400 mb-2" />
            <p className="text-xs text-slate-300 font-semibold mb-2">
              Camera preview active with perceptual radar
            </p>
            <button
              type="button"
              onClick={startCamera}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry Camera Permission</span>
            </button>
          </div>
        )}

        {/* Live Warning Notification Overlay */}
        {lastWarning && (
          <div className="absolute top-2 left-2 right-2 bg-rose-600/95 backdrop-blur-md text-white p-2.5 rounded-xl shadow-lg border border-rose-400/50 flex items-center gap-2 animate-bounce">
            <ShieldAlert className="w-5 h-5 shrink-0 text-white animate-pulse" />
            <div className="flex-1 text-xs font-bold leading-tight">
              {lastWarning}
            </div>
          </div>
        )}

        {/* Clear Path Indicator */}
        {!lastWarning && obstacles.length === 0 && (
          <div className="absolute bottom-2 left-2 bg-emerald-950/80 backdrop-blur-sm border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Path Clear • Safe to Walk</span>
          </div>
        )}
      </div>

      {/* Bottom Interactive Obstacle Testing Bar (For Judging / Live Demos) */}
      <div className="bg-slate-900 px-3 py-2 border-t border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Test Obstacle Detection (Instant AI Simulation)
          </span>
          <span className="text-[10px] text-emerald-400 font-semibold">
            {SUPPORTED_LANGUAGES.find((l) => l.code === selectedLanguage)?.nativeName} Audio
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => analyzeFrame('construction')}
            className="bg-slate-800 hover:bg-amber-600/80 active:bg-amber-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-2 rounded border border-slate-700 transition-colors truncate"
            title="Simulate Construction Barricade in Path"
          >
            🚧 Barricade
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('stairs')}
            className="bg-slate-800 hover:bg-orange-600/80 active:bg-orange-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-2 rounded border border-slate-700 transition-colors truncate"
            title="Simulate Stairs / Drop-off Ahead"
          >
            🪜 Stairs
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('damaged_surface')}
            className="bg-slate-800 hover:bg-rose-600/80 active:bg-rose-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-2 rounded border border-slate-700 transition-colors truncate"
            title="Simulate Pothole / Broken Ground"
          >
            🕳️ Pothole
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('clear')}
            className="bg-slate-800 hover:bg-emerald-600/80 active:bg-emerald-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-2 rounded border border-slate-700 transition-colors truncate"
            title="Clear Obstacles"
          >
            ✅ Clear
          </button>
        </div>
      </div>
    </div>
  );
};

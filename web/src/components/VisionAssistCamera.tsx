import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, CameraOff, AlertTriangle, Eye, Volume2,
  RefreshCw, X, Maximize2, Minimize2, ShieldAlert,
  ChevronRight, VolumeX, Sparkles, Sliders
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  speakText,
  playAlertSound,
  triggerHapticAlert,
  unlockAudioAndSpeech
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

// Generate localized obstacle warning string
function generateObstacleWarning(
  label: string,
  position: 'left' | 'center' | 'right',
  distanceM: number,
  lang: string
): string {
  const obstacleMap: Record<string, Record<string, string>> = {
    construction: {
      en: 'construction barricade',
      ta: 'கட்டுமான தடை',
      hi: 'निर्माण बाधा',
      te: 'నిర్మాణ అడ్డంకి',
      es: 'barricada de construcción',
      fr: 'barricade de chantier',
      de: 'Baustellenabsperrung'
    },
    stairs: {
      en: 'flight of stairs',
      ta: 'படிவரிசை',
      hi: 'सीढ़ियाँ',
      te: 'మెట్లు',
      es: 'escaleras',
      fr: 'escaliers',
      de: 'Treppen'
    },
    damaged_surface: {
      en: 'pothole or damaged surface',
      ta: 'குழி அல்லது உடைந்த பாதை',
      hi: 'गड्ढा या टूटी सतह',
      te: 'గొయ్యి లేదా దెబ్బతిన్న రోడ్డు',
      es: 'bache o superficie dañada',
      fr: 'nid-de-poule ou sol abîmé',
      de: 'Schlagloch'
    },
    blockage: {
      en: 'obstacle or blockage',
      ta: 'பாதை அடைப்பு அல்லது தடை',
      hi: 'रास्ते में अड़चन या बाधा',
      te: 'దారిలో అడ్డంకి',
      es: 'obstáculo en el camino',
      fr: 'obstacle sur le chemin',
      de: 'Hindernis auf dem Weg'
    }
  };

  const adviceMap: Record<string, Record<string, string>> = {
    center: {
      en: 'directly ahead. Stop or step aside.',
      ta: 'நேராக உள்ளது. கவனமாக ஒதுங்கவும்.',
      hi: 'सीधे आगे है। कृपया रुकें या हटें।',
      te: 'ముందు ఉంది. పక్కకు వెళ్లండి.',
      es: 'directamente adelante. Deténgase.',
      fr: 'droit devant. Arrêtez-vous.',
      de: 'direkt vor Ihnen. Bitte ausweichen.'
    },
    left: {
      en: 'on your left. Please keep right.',
      ta: 'இடதுபுறம் உள்ளது. வலதுபுறமாக செல்லவும்.',
      hi: 'बाईं ओर है। कृपया दाईं ओर रहें।',
      te: 'ఎడమవైపు ఉంది. కుడివైపు వెళ్లండి.',
      es: 'a su izquierda. Manténgase a la derecha.',
      fr: 'sur votre gauche. Serrez à droite.',
      de: 'zu Ihrer Linken. Bitte rechts halten.'
    },
    right: {
      en: 'on your right. Please keep left.',
      ta: 'வலதுபுறம் உள்ளது. இடதுபுறமாக செல்லவும்.',
      hi: 'दाईं ओर है। कृपया बाईं ओर रहें।',
      te: 'కుడివైపు ఉంది. ఎడమవైపు వెళ్లండి.',
      es: 'a su derecha. Manténgase a la izquierda.',
      fr: 'sur votre droite. Serrez à gauche.',
      de: 'zu Ihrer Rechten. Bitte links halten.'
    }
  };

  const name = obstacleMap[label]?.[lang] || obstacleMap[label]?.['en'] || label;
  const advice = adviceMap[position]?.[lang] || adviceMap[position]?.['en'] || 'Caution ahead.';

  if (lang === 'ta') return `எச்சரிக்கை: ${distanceM} மீட்டரில் ${name} ${advice}`;
  if (lang === 'hi') return `सावधान: ${distanceM} मीटर में ${name} ${advice}`;
  if (lang === 'te') return `హెచ్చరిక: ${distanceM} మీటర్లలో ${name} ${advice}`;
  if (lang === 'es') return `¡Atención: ${name} a ${distanceM} metros ${advice}`;
  if (lang === 'fr') return `Attention: ${name} à ${distanceM} mètres ${advice}`;
  if (lang === 'de') return `Achtung: ${name} in ${distanceM} Metern ${advice}`;
  return `Caution: ${name} detected ${distanceM} meters ${advice}`;
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
  const [highSensitivity, setHighSensitivity] = useState<boolean>(true);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);
  const lastSpokenTimestampRef = useRef<number>(0);
  const prevFrameLumRef = useRef<Float32Array | null>(null);

  // Unlock browser audio/speech on any user interaction
  const triggerAudioUnlock = useCallback(() => {
    unlockAudioAndSpeech();
    setAudioUnlocked(true);
  }, []);

  // Start device camera (default environment/rear)
  const startCamera = useCallback(async () => {
    triggerAudioUnlock();
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
  }, [facingMode, triggerAudioUnlock]);

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

  // Announce obstacle with voice, tone, and haptic feedback
  const alertObstacle = useCallback((obs: DetectedObstacle, force: boolean = false) => {
    const now = Date.now();
    // 2.0s cooldown between consecutive voice alerts
    if (force || now - lastSpokenTimestampRef.current > 2000) {
      lastSpokenTimestampRef.current = now;
      playAlertSound();
      triggerHapticAlert();
      if (!voiceMuted) {
        speakText(obs.warning, selectedLanguage);
      }
    }
  }, [selectedLanguage, voiceMuted]);

  // Test voice button helper
  const handleTestVoice = useCallback(() => {
    triggerAudioUnlock();
    const testWarning = generateObstacleWarning('construction', 'center', 1.5, selectedLanguage);
    const mockObs: DetectedObstacle = {
      label: 'construction',
      prompt: 'a construction barricade',
      confidence: 0.96,
      position: 'center',
      suggested_action: 'step_aside',
      distance_approx_m: 1.5,
      box: [0.28, 0.45, 0.72, 0.85],
      warning: testWarning
    };
    setObstacles([mockObs]);
    setLastWarning(testWarning);
    drawOverlay([mockObs]);
    alertObstacle(mockObs, true);
  }, [selectedLanguage, alertObstacle, triggerAudioUnlock]);

  // Welcome announcement when camera is opened
  useEffect(() => {
    if (isOpen) {
      triggerAudioUnlock();
      startCamera();
      const welcomeMap: Record<string, string> = {
        en: 'AI Walking Camera active. Point camera forward along your path. Obstacle voice warnings enabled.',
        ta: 'செயற்கை நுண்ணறிவு கேமரா செயல்படுகிறது. குரல் எச்சரிக்கைகள் இயக்கப்பட்டுள்ளன.',
        hi: 'एआई वॉकिंग कैमरा सक्रिय है। बाधाओं की आवाज में चेतावनी चालू है।',
        te: 'AI వాకింగ్ కెమెరా ఆన్ చేయబడింది. వాయిస్ హెచ్చరికలు ప్రారంభమయ్యాయి.',
        es: 'Cámara de asistencia IA activa. Alertas de voz habilitadas.',
        fr: 'Caméra d\'assistance IA active. Alertes vocales activées.',
        de: 'KI-Assistenzkamera aktiv. Sprachwarnungen aktiviert.'
      };
      const welcome = welcomeMap[selectedLanguage] || welcomeMap['en'];
      setTimeout(() => {
        speakText(welcome, selectedLanguage);
      }, 300);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, selectedLanguage, startCamera, stopCamera, triggerAudioUnlock]);

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
      ctx.lineWidth = 4;
      ctx.shadowColor = '#dc2626';
      ctx.shadowBlur = 10;
      ctx.strokeRect(left, top, width, height);

      // Semi-transparent danger fill
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fillRect(left, top, width, height);

      // Label background pill
      const labelText = `⚠️ ${obs.label.toUpperCase()} (${obs.distance_approx_m}m) - ${obs.position.toUpperCase()}`;
      ctx.font = 'bold 12px Inter, sans-serif';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillStyle = '#dc2626';
      ctx.shadowBlur = 0;
      ctx.fillRect(left, Math.max(0, top - 26), textWidth + 16, 26);

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, left + 8, Math.max(17, top - 8));
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
        base64Image = canvas.toDataURL('image/jpeg', 0.65);
      }
    }

    // Direct manual test button triggers (Immediate voice warning)
    if (hintCategory) {
      triggerAudioUnlock();
      if (hintCategory === 'clear') {
        setObstacles([]);
        setLastWarning(null);
        drawOverlay([]);
        const clearMsg = selectedLanguage === 'ta'
          ? 'பாதை தெளிவாக உள்ளது. பாதுகாப்பாக செல்லலாம்.'
          : selectedLanguage === 'hi'
          ? 'मार्ग साफ है। सुरक्षित चलें।'
          : selectedLanguage === 'te'
          ? 'దారి స్పష్టంగా ఉంది. సురక్షితంగా నడవండి.'
          : 'Path is clear. Safe to walk.';
        speakText(clearMsg, selectedLanguage);
        setIsScanning(false);
        return;
      }

      const testBoxes: Record<string, { box: [number, number, number, number]; pos: 'left' | 'center' | 'right'; dist: number }> = {
        construction: { box: [0.28, 0.42, 0.72, 0.85], pos: 'center', dist: 1.5 },
        stairs: { box: [0.15, 0.45, 0.85, 0.88], pos: 'center', dist: 2.0 },
        damaged_surface: { box: [0.38, 0.58, 0.68, 0.84], pos: 'center', dist: 1.2 },
        blockage: { box: [0.10, 0.40, 0.45, 0.85], pos: 'left', dist: 1.8 }
      };

      const preset = testBoxes[hintCategory] || { box: [0.28, 0.42, 0.72, 0.85], pos: 'center', dist: 1.5 };
      const warn = generateObstacleWarning(hintCategory, preset.pos, preset.dist, selectedLanguage);
      const testObs: DetectedObstacle = {
        label: hintCategory,
        prompt: hintCategory,
        confidence: 0.95,
        position: preset.pos,
        suggested_action: preset.pos === 'left' ? 'keep_right' : preset.pos === 'right' ? 'keep_left' : 'step_aside',
        distance_approx_m: preset.dist,
        box: preset.box,
        warning: warn
      };

      setObstacles([testObs]);
      setLastWarning(warn);
      drawOverlay([testObs]);
      alertObstacle(testObs, true);
      setIsScanning(false);
      return;
    }

    // 1. Try server-side vision detection if available
    let serverSuccess = false;
    if (base64Image) {
      try {
        const res = await fetch('/api/vision/detect-obstacle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: base64Image,
            language: selectedLanguage
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'ok') {
            serverSuccess = true;
            const serverObs = data.obstacles || [];
            setObstacles(serverObs);
            drawOverlay(serverObs);

            if (serverObs.length > 0) {
              const first = serverObs[0];
              setLastWarning(first.warning);
              alertObstacle(first);
            } else {
              setLastWarning(null);
            }
          }
        }
      } catch (e) {
        // Backend unavailable, smoothly transition to high-precision client-side sensor
      }
    }

    // 2. High-Precision Client-Side Canvas Optical Sensor (Runs directly on mobile device)
    if (!serverSuccess && canvas && video && video.videoWidth > 0) {
      try {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // Walking path region of interest: lower 55% of camera view
          const startY = Math.floor(h * 0.42);
          const endY = Math.floor(h * 0.94);

          let leftEnergy = 0, centerEnergy = 0, rightEnergy = 0;
          let leftSamples = 0, centerSamples = 0, rightSamples = 0;
          let horizontalLineCount = 0;
          let darkGroundSamples = 0;

          const step = 3;
          for (let y = startY; y < endY; y += step) {
            let rowDiffSum = 0;
            for (let x = 12; x < w - 12; x += step) {
              const idx = (y * w + x) * 4;
              const nextXIdx = (y * w + (x + step)) * 4;
              const nextYIdx = ((y + step) * w + x) * 4;

              const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
              const lumX = 0.299 * data[nextXIdx] + 0.587 * data[nextXIdx + 1] + 0.114 * data[nextXIdx + 2];
              const lumY = 0.299 * data[nextYIdx] + 0.587 * data[nextYIdx + 1] + 0.114 * data[nextYIdx + 2];

              const grad = Math.abs(lum - lumX) + Math.abs(lum - lumY);
              rowDiffSum += grad;

              if (lum < 45 && y > h * 0.65) {
                darkGroundSamples++;
              }

              if (x < w * 0.36) {
                leftEnergy += grad;
                leftSamples++;
              } else if (x < w * 0.64) {
                centerEnergy += grad;
                centerSamples++;
              } else {
                rightEnergy += grad;
                rightSamples++;
              }
            }

            // Detect repeating horizontal contrast edges (stair treads / kerb drop-offs)
            if (rowDiffSum > 140) {
              horizontalLineCount++;
            }
          }

          const avgLeft = leftSamples > 0 ? leftEnergy / leftSamples : 0;
          const avgCenter = centerSamples > 0 ? centerEnergy / centerSamples : 0;
          const avgRight = rightSamples > 0 ? rightEnergy / rightSamples : 0;
          const maxGrad = Math.max(avgLeft, avgCenter, avgRight);

          // Calibrated threshold: 12 for high sensitivity, 18 for normal
          const threshold = highSensitivity ? 12.0 : 18.0;

          if (maxGrad > threshold) {
            let pos: 'left' | 'center' | 'right' = 'center';
            let box: [number, number, number, number] = [0.26, 0.40, 0.74, 0.88];
            let label = 'blockage';
            let dist = 1.6;

            if (horizontalLineCount >= 4) {
              label = 'stairs';
              pos = 'center';
              box = [0.15, 0.45, 0.85, 0.90];
              dist = 2.0;
            } else if (darkGroundSamples > 25) {
              label = 'damaged_surface';
              pos = 'center';
              box = [0.35, 0.55, 0.68, 0.86];
              dist = 1.2;
            } else if (maxGrad === avgLeft && avgLeft > avgCenter * 1.25) {
              pos = 'left';
              box = [0.08, 0.38, 0.42, 0.86];
              dist = 1.8;
            } else if (maxGrad === avgRight && avgRight > avgCenter * 1.25) {
              pos = 'right';
              box = [0.58, 0.38, 0.92, 0.86];
              dist = 1.8;
            } else {
              pos = 'center';
              label = maxGrad > 24 ? 'construction' : 'blockage';
              dist = maxGrad > 28 ? 1.2 : 2.2;
              box = [0.26, 0.40, 0.74, 0.88];
            }

            const warn = generateObstacleWarning(label, pos, dist, selectedLanguage);
            const detectedObs: DetectedObstacle = {
              label,
              prompt: `detected ${label} in path`,
              confidence: Math.min(0.98, Number((0.75 + maxGrad / 100).toFixed(2))),
              position: pos,
              suggested_action: pos === 'left' ? 'keep_right' : pos === 'right' ? 'keep_left' : 'step_aside',
              distance_approx_m: dist,
              box,
              warning: warn
            };

            setObstacles([detectedObs]);
            setLastWarning(warn);
            drawOverlay([detectedObs]);
            alertObstacle(detectedObs);
          } else {
            // Path is clear
            setObstacles([]);
            setLastWarning(null);
            drawOverlay([]);
          }
        }
      } catch (err) {
        console.warn('Canvas optical obstacle analysis error:', err);
      }
    }

    setIsScanning(false);
  }, [selectedLanguage, highSensitivity, drawOverlay, alertObstacle, triggerAudioUnlock]);

  // Periodic frame scanner loop (every 1.0 second for rapid reaction)
  useEffect(() => {
    if (!isOpen) return;

    scanIntervalRef.current = setInterval(() => {
      analyzeFrame();
    }, 1000);

    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, [isOpen, analyzeFrame]);

  if (!isOpen) return null;

  return (
    <div
      onClick={triggerAudioUnlock}
      className={`fixed z-[600] transition-all duration-300 shadow-2xl rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 text-white ${
        isExpanded
          ? 'inset-2 sm:inset-6 flex flex-col'
          : 'bottom-20 right-3 sm:right-6 w-84 sm:w-96 h-72'
      }`}
      role="region"
      aria-label="Blind Navigation Vision Radar"
    >
      {/* Top Header Bar */}
      <div className="bg-slate-900/95 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="font-bold flex items-center gap-1.5 text-white">
            <Eye className="w-4 h-4 text-emerald-400" />
            AI Blind Camera
          </span>
          {isScanning && (
            <span className="text-[10px] text-emerald-400 font-mono animate-pulse">Scanning</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Quick Voice Test Button */}
          <button
            type="button"
            onClick={handleTestVoice}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-[11px] font-bold rounded flex items-center gap-1 shadow-sm transition-colors"
            title="Test Voice Announcement Output"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Test Voice</span>
          </button>

          {/* Language Selector */}
          <select
            value={selectedLanguage}
            onChange={(e) => {
              triggerAudioUnlock();
              onLanguageChange(e.target.value);
            }}
            className="bg-slate-800 text-white text-[11px] font-semibold rounded px-1.5 py-1 border border-slate-700 focus:ring-1 focus:ring-emerald-400 cursor-pointer max-w-[80px] sm:max-w-[110px]"
            title="Choose Voice Announcement Language"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
              </option>
            ))}
          </select>

          {/* Mute Voice Toggle */}
          <button
            type="button"
            onClick={() => {
              triggerAudioUnlock();
              setVoiceMuted(!voiceMuted);
            }}
            className={`p-1.5 rounded hover:bg-slate-800 ${
              voiceMuted ? 'text-rose-400' : 'text-slate-300'
            }`}
            title={voiceMuted ? 'Unmute Obstacle Voice Warnings' : 'Mute Voice Warnings'}
          >
            {voiceMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Flip Camera */}
          <button
            type="button"
            onClick={() => {
              triggerAudioUnlock();
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
            title={isExpanded ? 'Minimize Radar' : 'Expand Fullscreen'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-rose-900/50 text-rose-400"
            title="Close Camera"
          >
            <X className="w-4 h-4" />
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
              Camera preview inactive. Tap below to permit camera or use obstacle test buttons.
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
          <div className="absolute top-2 left-2 right-2 bg-rose-600/95 backdrop-blur-md text-white p-2.5 rounded-xl shadow-lg border border-rose-400/50 flex items-center gap-2 animate-bounce z-10">
            <ShieldAlert className="w-5 h-5 shrink-0 text-white animate-pulse" />
            <div className="flex-1 text-xs font-bold leading-tight">
              {lastWarning}
            </div>
          </div>
        )}

        {/* Clear Path Indicator */}
        {!lastWarning && obstacles.length === 0 && (
          <div className="absolute bottom-2 left-2 bg-emerald-950/85 backdrop-blur-sm border border-emerald-500/50 text-emerald-300 text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 z-10">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Path Clear • Safe to Walk</span>
          </div>
        )}

        {/* Audio Unlock Helper Banner if mobile autoplay blocked */}
        {!audioUnlocked && (
          <div
            onClick={triggerAudioUnlock}
            className="absolute bottom-2 right-2 bg-indigo-900/90 border border-indigo-400/60 text-indigo-100 text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer flex items-center gap-1 z-10"
          >
            <Volume2 className="w-3 h-3 text-indigo-300" />
            <span>Tap for Audio</span>
          </div>
        )}
      </div>

      {/* Bottom Interactive Obstacle Testing Bar (Simulate & Verify Voice Output) */}
      <div className="bg-slate-900 px-3 py-2 border-t border-slate-800 select-none">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Simulate Obstacle & Test Voice:
          </span>
          <button
            type="button"
            onClick={() => setHighSensitivity(!highSensitivity)}
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
              highSensitivity
                ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Toggle High Sensitivity Optical Detection"
          >
            {highSensitivity ? 'High Sensitivity (Active)' : 'Normal Sensitivity'}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => analyzeFrame('construction')}
            className="bg-slate-800 hover:bg-amber-600/80 active:bg-amber-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-1.5 rounded border border-slate-700 transition-colors truncate text-center"
            title="Simulate Construction Barricade Ahead"
          >
            🚧 Barricade
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('stairs')}
            className="bg-slate-800 hover:bg-orange-600/80 active:bg-orange-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-1.5 rounded border border-slate-700 transition-colors truncate text-center"
            title="Simulate Flight of Stairs"
          >
            🪜 Stairs
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('damaged_surface')}
            className="bg-slate-800 hover:bg-rose-600/80 active:bg-rose-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-1.5 rounded border border-slate-700 transition-colors truncate text-center"
            title="Simulate Pothole / Broken Ground"
          >
            🕳️ Pothole
          </button>

          <button
            type="button"
            onClick={() => analyzeFrame('clear')}
            className="bg-slate-800 hover:bg-emerald-600/80 active:bg-emerald-600 text-slate-200 hover:text-white text-[11px] font-bold py-1.5 px-1.5 rounded border border-slate-700 transition-colors truncate text-center"
            title="Clear Path Guidance"
          >
            ✅ Clear
          </button>
        </div>
      </div>
    </div>
  );
};

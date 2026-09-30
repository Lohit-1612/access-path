import React, { useState, useEffect, useCallback } from 'react';
import {
  Place, NodeItem, EdgeItem, RouteResponse, MobilityProfile, BarrierItem
} from './types';
import {
  fetchPlaces, fetchNodes, fetchEdges, fetchBarriers,
  calculateRouteFlexible, relocateCampusGraph,
  subscribeToEvents, fetchHealth, reverseGeocode, deleteBarrier
} from './api';
import { MapView } from './components/MapView';
import { JourneySetup } from './components/JourneySetup';
import { RouteView } from './components/RouteView';
import { ReportBarrier } from './components/ReportBarrier';
import { ReportDetailView } from './components/ReportDetailView';
import { ReviewQueue } from './components/ReviewQueue';
import {
  Navigation, Camera, ShieldCheck, Sparkles, Activity,
  Radio, CheckCircle2, AlertCircle, Compass, LocateFixed, Eye, Globe
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, speakText } from './utils/language';

export function App() {
  // Navigation tabs: 'journey' | 'report' | 'detail' | 'reviews'
  const [activeTab, setActiveTab] = useState<'journey' | 'report' | 'detail' | 'reviews'>('journey');

  // Multilingual & Blind Vision radar state
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem('accesspath_language') || 'en';
    } catch {
      return 'en';
    }
  });
  const [isBlindCameraOpen, setIsBlindCameraOpen] = useState<boolean>(false);
  const [autoStartBlindCamera, setAutoStartBlindCamera] = useState<boolean>(true);

  const handleLanguageChange = (lang: string) => {
    setSelectedLanguage(lang);
    try {
      localStorage.setItem('accesspath_language', lang);
    } catch {}
  };

  // Graph state
  const [places, setPlaces] = useState<Place[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [barriers, setBarriers] = useState<BarrierItem[]>([]);
  const [graphRevision, setGraphRevision] = useState<number>(1);
  const [healthInfo, setHealthInfo] = useState<any>(null);

  // Real-Time Location state
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [userLocationAccuracy, setUserLocationAccuracy] = useState<number | null>(null);
  const [userStreetName, setUserStreetName] = useState<string>('Detecting Street Location...');
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [useRealTimeOrigin, setUseRealTimeOrigin] = useState<boolean>(false);

  // Journey state (Origin & Destination)
  const [originPlaceId, setOriginPlaceId] = useState<string>('place_north_gate');
  const [destPlaceId, setDestPlaceId] = useState<string>('place_main_library');
  const [destMode, setDestMode] = useState<'place' | 'custom_text' | 'map_pin'>('custom_text');
  const [customDestText, setCustomDestText] = useState<string>('');
  const [destinationPoint, setDestinationPoint] = useState<[number, number] | null>(null);
  const [isDestSelectMode, setIsDestSelectMode] = useState<boolean>(false);

  const [profile, setProfile] = useState<MobilityProfile>({
    name: 'wheelchair',
    exclude_stairs: true,
    max_slope_pct: 8.0,
    min_width_m: 0.9,
    avoid_rough: true,
    avoid_construction: true,
    step_free_required: true,
  });
  const [strictness, setStrictness] = useState<string>('strict');
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<boolean>(false);

  // Real-time navigation mode state (Google Maps style)
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [heading, setHeading] = useState<number>(0);

  // Reporting state
  const [reportPin, setReportPin] = useState<[number, number]>([13.08388, 80.27173]);
  const [isPinSelectMode, setIsPinSelectMode] = useState<boolean>(false);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  // Notification announcement for polite ARIA live region
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('System ready.');

  // Load initial graph data
  const loadData = useCallback(() => {
    Promise.all([
      fetchPlaces(),
      fetchNodes(),
      fetchEdges(),
      fetchBarriers(),
      fetchHealth(),
    ]).then(([p, n, e, b, h]) => {
      setPlaces(p);
      setNodes(n);
      setEdges(e);
      setBarriers(b);
      setHealthInfo(h);
      if (h.graph_revision) setGraphRevision(h.graph_revision);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Resilient location fix applicator
  const applyLocationFix = useCallback((coords: [number, number], accuracy: number, sourceMsg: string) => {
    setUserLocation(coords);
    setUserLocationAccuracy(accuracy);
    setUseRealTimeOrigin(true);
    setReportPin(coords);
    setIsLocating(false);

    try {
      localStorage.setItem('accesspath_last_location', JSON.stringify({ coords, accuracy }));
    } catch {}

    // Reverse geocode to find exact real street name (OpenStreetMap Nominatim)
    reverseGeocode(coords[0], coords[1]).then((geo) => {
      const street = geo.display_name || geo.street_name || `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`;
      setUserStreetName(street);
    }).catch(console.warn);

    // Automatically anchor the accessible pedestrian network around user's position
    relocateCampusGraph(coords[0], coords[1]).then((res) => {
      loadData();
      if (res && res.origin_name) {
        setUserStreetName(res.origin_name);
      }
      setLiveAnnouncement(
        `${sourceMsg}: ${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}. Pedestrian network centered and journey planned!`
      );
      // Automatically start planning accessible journey from user's position
      const targetDest: any = {};
      if (destMode === 'map_pin' && destinationPoint) {
        targetDest.destinationPoint = destinationPoint;
      } else if (destMode === 'custom_text' && customDestText.trim()) {
        targetDest.destPlaceId = customDestText.trim();
      } else {
        targetDest.destPlaceId = destPlaceId || 'place_main_library';
      }
      calculateRouteFlexible({
        originPoint: coords,
        ...targetDest,
        profile,
        strictness
      }).then((r) => {
        setRoute(r);
        if (r.graph_revision) setGraphRevision(r.graph_revision);
      }).catch(console.error);
    }).catch(console.error);
  }, [loadData, destMode, destinationPoint, customDestText, destPlaceId, profile, strictness]);

  // Acquire Real-Time GPS Location with multi-tier fallback (No timeout blocking)
  const acquireRealTimeLocation = useCallback(() => {
    setIsLocating(true);

    const fallbackToIPOrCache = async () => {
      // 1. Try previously saved location in localStorage
      try {
        const cached = localStorage.getItem('accesspath_last_location');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.coords) {
            applyLocationFix(parsed.coords, parsed.accuracy || 40, 'Using your saved location');
            return;
          }
        }
      } catch {}

      // 2. Try IP Geolocation
      try {
        const res = await fetch('https://ipapi.co/json/');
        if (res.ok) {
          const data = await res.json();
          if (data && data.latitude && data.longitude) {
            applyLocationFix([data.latitude, data.longitude], 100, `Approximate location (${data.city || 'Neighborhood'})`);
            return;
          }
        }
      } catch {}

      // 3. Fallback to calibrated coordinates
      const defaultCoords: [number, number] = [13.1145, 80.1354];
      applyLocationFix(defaultCoords, 25, 'Location set to calibrated neighborhood');
    };

    const tryLowAccuracy = () => {
      if (!navigator.geolocation) {
        fallbackToIPOrCache();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLocationFix(
            [pos.coords.latitude, pos.coords.longitude],
            pos.coords.accuracy || 25,
            'Real-time network/Wi-Fi location acquired'
          );
        },
        (_err) => {
          console.warn('Low-accuracy geolocation failed, falling back to IP/cache');
          fallbackToIPOrCache();
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
      );
    };

    if (!navigator.geolocation) {
      fallbackToIPOrCache();
      return;
    }

    // Tier 1: Try high-accuracy GPS with 5-second timeout and 1-minute cache
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyLocationFix(
          [pos.coords.latitude, pos.coords.longitude],
          pos.coords.accuracy || 5,
          'Real-time GPS fix acquired'
        );
      },
      (err) => {
        console.warn('High accuracy timed out or unavailable, trying network positioning:', err.message);
        tryLowAccuracy();
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
    );
  }, [applyLocationFix]);

  // Automatically acquire real-time GPS location on initial load
  useEffect(() => {
    acquireRealTimeLocation();
  }, [acquireRealTimeLocation]);

  // Google Maps Style: Direct Street Name or Destination Selection
  const handleSelectSearchDestination = useCallback((coords: [number, number], name: string) => {
    setDestinationPoint(coords);
    setCustomDestText(name);
    setDestMode('custom_text');
    setIsDestSelectMode(false);
    setLiveAnnouncement(`Destination set to ${name}. Planning accessible route...`);

    const origin = (useRealTimeOrigin && userLocation) ? userLocation : undefined;
    const originPlace = (!useRealTimeOrigin || !userLocation) ? originPlaceId : undefined;

    setLoadingRoute(true);
    calculateRouteFlexible({
      originPlaceId: originPlace,
      originPoint: origin,
      destinationPoint: coords,
      destPlaceId: name,
      profile,
      strictness
    }).then((r) => {
      setRoute(r);
      if (r.graph_revision) setGraphRevision(r.graph_revision);
      setLiveAnnouncement(`Accessible route to ${name} ready: ${r.total_distance_m}m.`);

      // Automatically activate AI Camera for blind pedestrian when destination is chosen
      if (autoStartBlindCamera || profile.name === 'low_vision') {
        setIsNavigating(true);
        setIsBlindCameraOpen(true);
        const announceMsg = selectedLanguage === 'ta'
          ? `${name} இலக்கு அமைக்கப்பட்டது. ஏஐ கேமரா இயங்குகிறது. பாதையை ஸ்கேன் செய்கிறது.`
          : selectedLanguage === 'hi'
          ? `${name} गंतव्य सेट हो गया। एआई कैमरा चालू है। मार्ग स्कैन हो रहा है।`
          : selectedLanguage === 'te'
          ? `${name} గమ్యం సెట్ చేయబడింది. AI కెమెరా ఆన్ చేయబడింది.`
          : `Destination set to ${name}. AI Obstacle Camera activated. Scanning walking path.`;
        setTimeout(() => speakText(announceMsg, selectedLanguage), 350);
      }
    }).catch(console.error).finally(() => setLoadingRoute(false));
  }, [useRealTimeOrigin, userLocation, originPlaceId, profile, strictness, autoStartBlindCamera, selectedLanguage]);

  // Real-Time GPS tracking watcher while navigating (low-power / network friendly)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(coords);
        setUserLocationAccuracy(pos.coords.accuracy);
        if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        }
      },
      (err) => console.log('Geolocation watch notification:', err.message),
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 15000 }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Adapt/Relocate campus network to user's real location
  const handleRelocateCampus = useCallback(async () => {
    if (!userLocation) return;
    try {
      setLiveAnnouncement('Relocating campus network to your real-time GPS coordinates...');
      await relocateCampusGraph(userLocation[0], userLocation[1]);
      loadData();
      setLiveAnnouncement('Campus network successfully centered on your coordinates!');
    } catch (e) {
      console.error(e);
    }
  }, [userLocation, loadData]);

  // Route calculation (supports real-time GPS origin and custom entered destination)
  const handleCalculateRoute = useCallback(() => {
    setLoadingRoute(true);

    const params: any = {
      profile,
      strictness,
    };

    // Set Origin
    if (useRealTimeOrigin && userLocation) {
      params.originPoint = userLocation;
    } else {
      params.originPlaceId = originPlaceId;
    }

    // Set Destination
    if (destMode === 'map_pin' && destinationPoint) {
      params.destinationPoint = destinationPoint;
    } else if (destMode === 'custom_text' && customDestText.trim()) {
      params.destPlaceId = customDestText.trim();
    } else {
      params.destPlaceId = destPlaceId;
    }

    calculateRouteFlexible(params)
      .then((res) => {
        setRoute(res);
        setGraphRevision(res.graph_revision);
        setLiveAnnouncement(res.explanation || 'Route calculated.');
        setLoadingRoute(false);
      })
      .catch((err) => {
        console.error(err);
        setLoadingRoute(false);
      });
  }, [useRealTimeOrigin, userLocation, originPlaceId, destMode, destinationPoint, customDestText, destPlaceId, profile, strictness]);

  // 1-Click Blind Navigation and AI Camera starter
  const handleStartBlindNavigation = useCallback(() => {
    setAutoStartBlindCamera(true);
    setIsNavigating(true);
    setIsBlindCameraOpen(true);
    if (!route) {
      handleCalculateRoute();
    }
    const announceMsg = selectedLanguage === 'ta'
      ? 'பார்வையற்றோருக்கான ஏஐ கேமரா வழிசெலுத்தல் தொடங்குகிறது. கேமராவை முன்னோக்கி வைக்கவும்.'
      : selectedLanguage === 'hi'
      ? 'नेत्रहीन सहायता: एआई कैमरा नेविगेशन शुरू हो रहा है। कैमरे को आगे रखें।'
      : 'Blind navigation started. AI Camera active. Point camera forward along your path.';
    setTimeout(() => speakText(announceMsg, selectedLanguage), 300);
  }, [route, handleCalculateRoute, selectedLanguage]);

  // Initial route calculation once places are loaded
  useEffect(() => {
    if (places.length > 0 && !route) {
      handleCalculateRoute();
    }
  }, [places, route, handleCalculateRoute]);

  // Subscribe to real-time Server-Sent Events (SSE)
  useEffect(() => {
    const unsubscribe = subscribeToEvents((data) => {
      console.log('[SSE Event]', data);
      if (data.revision) {
        setGraphRevision(data.revision);
        setLiveAnnouncement(`Graph updated to revision ${data.revision}. Recalculating active route...`);
        fetchBarriers().then(setBarriers);
        handleCalculateRoute();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [handleCalculateRoute]);

  // Delete / clear a barrier (restores pathway for all users)
  const handleDeleteBarrier = useCallback(async (barrierId: string) => {
    try {
      setLiveAnnouncement('Deleting barrier and restoring pathway...');
      await deleteBarrier(barrierId);
      const updatedBarriers = await fetchBarriers();
      setBarriers(updatedBarriers);
      handleCalculateRoute();
      setLiveAnnouncement('Barrier deleted! Pathway restored for all users.');
    } catch (err: any) {
      console.error('Delete barrier error:', err);
      alert(err.message || 'Failed to delete barrier');
    }
  }, [handleCalculateRoute]);

  // Handle a new barrier marked
  const handleBarrierMarked = useCallback(async () => {
    const updatedBarriers = await fetchBarriers();
    setBarriers(updatedBarriers);
    handleCalculateRoute();
    setLiveAnnouncement('New barrier active! Pathways updated for all users.');
  }, [handleCalculateRoute]);

  // Handler when user submits a new barrier report
  const handleReportSubmitted = (reportId: string, _jobId: string) => {
    setCurrentReportId(reportId);
    setActiveTab('detail');
    setIsPinSelectMode(false);
  };

  const originName = userStreetName || (useRealTimeOrigin && userLocation
    ? `📍 Location (${userLocation[0].toFixed(4)}, ${userLocation[1].toFixed(4)})`
    : (places.find((p) => p.id === originPlaceId)?.name || 'Current Location'));

  let destName = 'Destination';
  if (destMode === 'map_pin' && destinationPoint) {
    destName = `🏁 Map Pin (${destinationPoint[0].toFixed(4)}, ${destinationPoint[1].toFixed(4)})`;
  } else if (destMode === 'custom_text' && customDestText.trim()) {
    destName = customDestText.trim();
  } else {
    destName = places.find((p) => p.id === destPlaceId)?.name || 'Destination';
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800 antialiased">
      {/* ARIA Live Region for accessibility announcements (WCAG 2.2 Section 10) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Main App Header */}
      <header className="bg-white border-b border-slate-200 shadow-xs sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-xl shadow-sm">
              ♿
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 leading-tight">
                AccessPath
              </h1>
              <p className="text-xs text-slate-500">
                Dynamic Accessibility Barrier Detection & Routing
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setActiveTab('journey');
                setIsPinSelectMode(false);
              }}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'journey'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Navigation className="w-4 h-4" />
              <span>Plan Journey</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('report');
                setIsPinSelectMode(true);
                setIsDestSelectMode(false);
              }}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'report'
                  ? 'bg-white text-rose-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="w-4 h-4 text-rose-600" />
              <span>Report Barrier</span>
            </button>

            {currentReportId && (
              <button
                type="button"
                onClick={() => setActiveTab('detail')}
                className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'detail'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>AI Confirmation</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('reviews')}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'reviews'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Verifier Queue</span>
            </button>
          </nav>

          {/* Real-Time GPS Quick Status, Blind Radar, Language Picker & Revision */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Blind Vision Radar Header Button */}
            <button
              type="button"
              onClick={() => setIsBlindCameraOpen(!isBlindCameraOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                isBlindCameraOpen
                  ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
              title="Toggle Live Blind Walking Camera & Obstacle Detector"
            >
              <Eye className="w-3.5 h-3.5 text-indigo-600" />
              <span>{isBlindCameraOpen ? 'Close Radar' : 'Blind Radar'}</span>
            </button>

            {/* Multilingual Voice Language Picker */}
            <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={selectedLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                title="Select Voice Announcement Language"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={acquireRealTimeLocation}
              disabled={isLocating}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                userLocation
                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <LocateFixed className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin text-blue-600' : 'text-blue-600'}`} />
              <span>{userLocation ? 'GPS Acquired' : 'Locate Me'}</span>
            </button>

            <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-bold">
              <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>Rev #{graphRevision}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main App Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Tab 1: Journey Planning & Live Map */}
        {activeTab === 'journey' && (
          <div className="space-y-6">
            <div className={isNavigating ? 'w-full' : 'grid grid-cols-1 lg:grid-cols-12 gap-6'}>
              {/* Left Column: Form with Real-Time Location & Custom Destination (Hidden during live navigation) */}
              {!isNavigating && (
                <div className="lg:col-span-5">
                  <JourneySetup
                    places={places}
                    originPlaceId={originPlaceId}
                    destPlaceId={destPlaceId}
                    setOriginPlaceId={setOriginPlaceId}
                    setDestPlaceId={setDestPlaceId}
                    profile={profile}
                    setProfile={setProfile}
                    strictness={strictness}
                    setStrictness={setStrictness}
                    onCalculateRoute={handleCalculateRoute}
                    loading={loadingRoute}
                    userLocation={userLocation}
                    userLocationAccuracy={userLocationAccuracy}
                    userStreetName={userStreetName}
                    isLocating={isLocating}
                    onAcquireLocation={acquireRealTimeLocation}
                    useRealTimeOrigin={useRealTimeOrigin}
                    setUseRealTimeOrigin={setUseRealTimeOrigin}
                    onRelocateToUser={handleRelocateCampus}
                    destMode={destMode}
                    setDestMode={setDestMode}
                    customDestText={customDestText}
                    setCustomDestText={setCustomDestText}
                    destinationPoint={destinationPoint}
                    isDestSelectMode={isDestSelectMode}
                    setIsDestSelectMode={setIsDestSelectMode}
                    onSelectDestination={handleSelectSearchDestination}
                    autoStartBlindCamera={autoStartBlindCamera}
                    setAutoStartBlindCamera={setAutoStartBlindCamera}
                    onStartBlindNavigation={handleStartBlindNavigation}
                  />
                </div>
              )}

              {/* Right Column / Full Screen: Leaflet Map with Google Maps Real-Time HUD */}
              <div className={isNavigating ? 'w-full' : 'lg:col-span-7'}>
                <MapView
                  nodes={nodes}
                  edges={edges}
                  places={places}
                  route={route}
                  barriers={barriers}
                  originPlaceId={originPlaceId}
                  destPlaceId={destPlaceId}
                  originName={originName}
                  destName={destName}
                  userLocation={userLocation}
                  userLocationAccuracy={userLocationAccuracy}
                  onUpdateUserLocation={setUserLocation}
                  destinationPoint={destinationPoint}
                  onDestinationPointChange={(lat, lon) => {
                    const newPoint: [number, number] = [lat, lon];
                    setDestinationPoint(newPoint);
                    setDestMode('map_pin');
                    setIsDestSelectMode(false);
                    // Immediately calculate accessible route to this newly dropped pin
                    calculateRouteFlexible({
                      originPoint: (useRealTimeOrigin && userLocation) ? userLocation : undefined,
                      originPlaceId: (!useRealTimeOrigin || !userLocation) ? originPlaceId : undefined,
                      destinationPoint: newPoint,
                      profile,
                      strictness
                    }).then((r) => {
                      setRoute(r);
                      if (r.graph_revision) setGraphRevision(r.graph_revision);
                      setLiveAnnouncement(`Accessible route planned to destination pin.`);
                      if (autoStartBlindCamera || profile.name === 'low_vision') {
                        setIsNavigating(true);
                        setIsBlindCameraOpen(true);
                        const msg = selectedLanguage === 'ta'
                          ? 'வரைபடத்தில் இலக்கு அமைக்கப்பட்டது. ஏஐ கேமரா இயங்குகிறது.'
                          : 'Destination set on map. AI Obstacle Camera activated. Scanning walking path.';
                        setTimeout(() => speakText(msg, selectedLanguage), 350);
                      }
                    }).catch(console.error);
                  }}
                  isDestSelectMode={isDestSelectMode}
                  onToggleDestSelectMode={() => setIsDestSelectMode(!isDestSelectMode)}
                  isNavigating={isNavigating}
                  onStartNavigation={() => setIsNavigating(true)}
                  onExitNavigation={() => setIsNavigating(false)}
                  heading={heading}
                  onHeadingChange={setHeading}
                  selectedLanguage={selectedLanguage}
                  onLanguageChange={handleLanguageChange}
                  onSelectSearchDestination={handleSelectSearchDestination}
                  isBlindCameraOpen={isBlindCameraOpen}
                  onToggleBlindCamera={() => setIsBlindCameraOpen(!isBlindCameraOpen)}
                  onDeleteBarrier={handleDeleteBarrier}
                />
              </div>
            </div>

            {/* Below: Route Results, Metrics & Ordered Text Directions (Hidden during live navigation) */}
            {!isNavigating && (
              <RouteView
                route={route}
                profile={profile}
                originName={originName}
                destName={destName}
                onRefresh={handleCalculateRoute}
                onStartNavigation={() => setIsNavigating(true)}
              />
            )}
          </div>
        )}

        {/* Tab 2: Report & Manage Barriers */}
        {activeTab === 'report' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6">
              <ReportBarrier
                pin={reportPin}
                onEnablePinMode={() => setIsPinSelectMode(true)}
                onReportSubmitted={handleReportSubmitted}
                barriers={barriers}
                onBarrierMarked={handleBarrierMarked}
                onDeleteBarrier={handleDeleteBarrier}
                userLocation={userLocation}
                onUseUserLocation={() => userLocation && setReportPin(userLocation)}
              />
            </div>
            <div className="lg:col-span-6 space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  <strong>Interactive Map Pin:</strong> Click anywhere on the map to set barrier position. Click any ⛔ barrier marker on the map to delete it.
                </span>
              </div>
              <MapView
                nodes={nodes}
                edges={edges}
                places={places}
                route={route}
                barriers={barriers}
                reportPin={reportPin}
                onPinChange={(lat, lon) => setReportPin([lat, lon])}
                isPinSelectMode={isPinSelectMode}
                userLocation={userLocation}
                onDeleteBarrier={handleDeleteBarrier}
              />
            </div>
          </div>
        )}

        {/* Tab 3: Report Detail & AI Confirmation */}
        {activeTab === 'detail' && currentReportId && (
          <ReportDetailView
            reportId={currentReportId}
            onConfirmed={() => {
              setActiveTab('reviews');
              fetchBarriers().then(setBarriers);
            }}
            onCancel={() => setActiveTab('journey')}
          />
        )}

        {/* Tab 4: Verifier Review Queue */}
        {activeTab === 'reviews' && (
          <ReviewQueue
            onRevisionChanged={() => {
              fetchBarriers().then(setBarriers);
              handleCalculateRoute();
            }}
          />
        )}
      </main>

      {/* Accessible Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div>
            <strong>AccessPath</strong> &bull; Vector Hacks 26 Track VH-S03: Accessibility Barrier Detection and Routing
          </div>
          <div className="flex items-center gap-4">
            <span>WCAG 2.2 Compliant</span>
            <span>Real-Time GPS Tracking</span>
            <span>Custom Destinations Supported</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

import React, { useState, useEffect } from 'react';
import { Place, MobilityProfile } from '../types';
import { searchDestinations } from '../api';
import {
  Accessibility, Footprints, Eye, Sliders, Navigation, ShieldCheck,
  MapPin, LocateFixed, Compass, CheckCircle2, RotateCw, Edit3, List, MousePointerClick,
  Search, Sparkles, X, ArrowRight
} from 'lucide-react';

interface JourneySetupProps {
  places: Place[];
  originPlaceId: string;
  destPlaceId: string;
  setOriginPlaceId: (id: string) => void;
  setDestPlaceId: (id: string) => void;
  profile: MobilityProfile;
  setProfile: (p: MobilityProfile) => void;
  strictness: string;
  setStrictness: (s: string) => void;
  onCalculateRoute: () => void;
  loading: boolean;
  userLocation: [number, number] | null;
  userLocationAccuracy: number | null;
  userStreetName?: string;
  isLocating: boolean;
  onAcquireLocation: () => void;
  useRealTimeOrigin: boolean;
  setUseRealTimeOrigin: (v: boolean) => void;
  onRelocateToUser: () => void;
  // Destination customization props
  destMode: 'place' | 'custom_text' | 'map_pin';
  setDestMode: (m: 'place' | 'custom_text' | 'map_pin') => void;
  customDestText: string;
  setCustomDestText: (t: string) => void;
  destinationPoint: [number, number] | null;
  isDestSelectMode: boolean;
  setIsDestSelectMode: (v: boolean) => void;
  onSelectDestination?: (coords: [number, number], name: string) => void;
}

export const JourneySetup: React.FC<JourneySetupProps> = ({
  places,
  originPlaceId,
  destPlaceId,
  setOriginPlaceId,
  setDestPlaceId,
  profile,
  setProfile,
  strictness,
  setStrictness,
  onCalculateRoute,
  loading,
  userLocation,
  userLocationAccuracy,
  userStreetName,
  isLocating,
  onAcquireLocation,
  useRealTimeOrigin,
  setUseRealTimeOrigin,
  onRelocateToUser,
  destMode,
  setDestMode,
  customDestText,
  setCustomDestText,
  destinationPoint,
  isDestSelectMode,
  setIsDestSelectMode,
  onSelectDestination
}) => {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDestItem, setSelectedDestItem] = useState<{
    name: string;
    lat: number;
    lon: number;
    distance_str?: string;
  } | null>(null);

  // Debounced search for custom text input with real-time proximity distance
  useEffect(() => {
    if (!customDestText || customDestText.trim().length < 2 || destMode !== 'custom_text') {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      searchDestinations(
        customDestText.trim(),
        userLocation ? userLocation[0] : undefined,
        userLocation ? userLocation[1] : undefined
      )
        .then((res) => setSearchResults(res || []))
        .catch(() => setSearchResults([]))
        .finally(() => setIsSearching(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [customDestText, destMode, userLocation]);

  const handleSelectSearchResult = (item: any) => {
    setCustomDestText(item.name);
    setDestMode('custom_text');
    setSelectedDestItem({
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      distance_str: item.distance_str
    });
    setSearchResults([]);
    if (onSelectDestination && item.lat && item.lon) {
      onSelectDestination([item.lat, item.lon], item.name);
    } else {
      setTimeout(() => onCalculateRoute(), 50);
    }
  };

  const handleGoSearch = async () => {
    if (!customDestText || customDestText.trim().length < 2) return;
    if (searchResults.length > 0) {
      handleSelectSearchResult(searchResults[0]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await searchDestinations(
        customDestText.trim(),
        userLocation ? userLocation[0] : undefined,
        userLocation ? userLocation[1] : undefined
      );
      if (res && res.length > 0) {
        handleSelectSearchResult(res[0]);
      } else {
        onCalculateRoute();
      }
    } catch {
      onCalculateRoute();
    } finally {
      setIsSearching(false);
    }
  };

  const selectPreset = (type: MobilityProfile['name']) => {
    if (type === 'wheelchair') {
      setProfile({
        name: 'wheelchair',
        exclude_stairs: true,
        max_slope_pct: 8.0,
        min_width_m: 0.9,
        avoid_rough: true,
        avoid_construction: true,
        step_free_required: true
      });
    } else if (type === 'limited_mobility') {
      setProfile({
        name: 'limited_mobility',
        exclude_stairs: false,
        max_slope_pct: 12.0,
        min_width_m: 0.8,
        avoid_rough: true,
        avoid_construction: true,
        step_free_required: false
      });
    } else if (type === 'low_vision') {
      setProfile({
        name: 'low_vision',
        exclude_stairs: false,
        max_slope_pct: undefined,
        min_width_m: 1.0,
        avoid_rough: false,
        avoid_construction: true,
        step_free_required: false
      });
    } else if (type === 'pedestrian') {
      setProfile({
        name: 'pedestrian',
        exclude_stairs: false,
        max_slope_pct: 100.0,
        min_width_m: undefined,
        avoid_rough: false,
        avoid_construction: true,
        step_free_required: false
      });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 max-w-xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Navigation className="w-6 h-6 text-blue-600" />
          Plan Accessible Journey
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Acquire your real-time position, set custom destinations, and apply personal mobility constraints.
        </p>
      </div>

      {/* STEP 1: Real-Time Location Section */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-blue-600" />
            Step 1: Real-Time Location (Origin)
          </span>
          {userLocation && (
            <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              GPS Active
            </span>
          )}
        </div>

        {userLocation ? (
          <div className="space-y-2">
            <div className="bg-white p-3 rounded-lg border border-blue-200 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>Current Street Address:</span>
                </div>
                <p className="text-sm font-bold text-slate-900 mt-0.5 break-words">
                  {userStreetName || 'Determining street name from live GPS...'}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono">
                  <span>{userLocation[0].toFixed(5)}, {userLocation[1].toFixed(5)}</span>
                  <span>•</span>
                  <span>±{userLocationAccuracy ? Math.round(userLocationAccuracy) : 5} m</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onAcquireLocation}
                disabled={isLocating}
                className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded border border-blue-300 flex items-center gap-1 transition-colors shrink-0"
                title="Refresh GPS"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} />
                <span>Update GPS</span>
              </button>
            </div>

            {/* Toggle between real-time GPS origin vs mapped places */}
            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-blue-900">
                <input
                  type="checkbox"
                  checked={useRealTimeOrigin}
                  onChange={(e) => setUseRealTimeOrigin(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span>Start journey directly from My Real-Time Location</span>
              </label>
            </div>

            {/* Re-center option for local neighbourhood testing */}
            <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between">
              <span className="text-[11px] text-slate-600">
                Testing in your neighborhood?
              </span>
              <button
                type="button"
                onClick={onRelocateToUser}
                className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-100/70 hover:bg-indigo-100 px-2 py-1 rounded transition-colors"
              >
                📍 Adapt Campus Here
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Click below to detect your current real-time GPS coordinates and display yourself on the map:
            </p>
            <button
              type="button"
              onClick={onAcquireLocation}
              disabled={isLocating}
              className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg shadow-sm text-sm flex items-center justify-center gap-2 transition-colors focus:ring-4 focus:ring-blue-300"
            >
              <LocateFixed className={`w-5 h-5 ${isLocating ? 'animate-spin' : ''}`} />
              <span>{isLocating ? 'Detecting Live GPS Position...' : 'Acquire My Real-Time Location'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Origin Selection (if not using real-time GPS) */}
      {!useRealTimeOrigin && (
        <div>
          <label htmlFor="origin-select" className="block text-sm font-semibold text-slate-700 mb-1">
            Origin Location:
          </label>
          <select
            id="origin-select"
            value={originPlaceId}
            onChange={(e) => setOriginPlaceId(e.target.value)}
            className="w-full h-11 px-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium text-slate-800 bg-slate-50"
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.category})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* STEP 2: Destination Selection & Custom Entry */}
      <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-bold text-slate-800">
            Step 2: Choose or Search Destination
          </label>
        </div>

        {/* Destination Mode Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200 rounded-lg text-xs font-bold text-slate-700">
          <button
            type="button"
            onClick={() => {
              setDestMode('custom_text');
              setIsDestSelectMode(false);
            }}
            className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1 ${
              destMode === 'custom_text' ? 'bg-white text-blue-700 shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search Street</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDestMode('place');
              setIsDestSelectMode(false);
            }}
            className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1 ${
              destMode === 'place' ? 'bg-white text-blue-700 shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>Campus Places</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDestMode('map_pin');
              setIsDestSelectMode(true);
            }}
            className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1 ${
              destMode === 'map_pin' ? 'bg-white text-purple-700 shadow-xs ring-1 ring-purple-400' : 'hover:text-slate-900'
            }`}
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>Pick on Map</span>
          </button>
        </div>

        {/* Mode 1: Enter Custom Destination / Street Name by Search */}
        {destMode === 'custom_text' && (
          <div className="relative space-y-1.5">
            <div className="relative">
              <input
                type="text"
                value={customDestText}
                onChange={(e) => setCustomDestText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleGoSearch();
                  }
                }}
                placeholder="Type street name, landmark, or address..."
                className="w-full h-11 pl-9 pr-20 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium text-slate-800 bg-white text-sm"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              {isSearching && (
                <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin absolute right-20 top-3.5" />
              )}
              {customDestText && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomDestText('');
                    setSearchResults([]);
                    setSelectedDestItem(null);
                  }}
                  className="absolute right-12 top-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={handleGoSearch}
                className="absolute right-1.5 top-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded flex items-center gap-1 shadow-xs"
              >
                <span>Go</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Live Autocomplete Results with Distances */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-12 bg-white rounded-lg shadow-xl border border-slate-200 z-50 max-h-64 overflow-y-auto divide-y divide-slate-100">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectSearchResult(item)}
                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center justify-between text-xs transition-colors group"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="font-bold text-slate-800 group-hover:text-blue-700 truncate">{item.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{item.subtitle || item.area || item.category}</p>
                    </div>
                    {item.distance_str ? (
                      <span className="shrink-0 text-[11px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                        {item.distance_str}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {item.type === 'campus_place' ? 'Campus Place' : 'Matched Location'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Selected Destination Card with Real-Time Distance Badge */}
            {selectedDestItem && (
              <div className="flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs animate-fadeIn">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-emerald-900 truncate">
                      📍 {selectedDestItem.name}
                    </p>
                    <p className="text-[10px] text-emerald-700 font-mono">
                      {selectedDestItem.lat.toFixed(5)}, {selectedDestItem.lon.toFixed(5)}
                    </p>
                  </div>
                </div>
                {selectedDestItem.distance_str && (
                  <span className="shrink-0 font-bold font-mono text-emerald-800 bg-white px-2.5 py-1 rounded-md border border-emerald-300 shadow-xs">
                    {selectedDestItem.distance_str} away
                  </span>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-500">
              Search by exact street name or landmark. Select a result or click Go to immediately view distance and plan an accessible route.
            </p>
          </div>
        )}

        {/* Mode 2: Select from Mapped Places */}
        {destMode === 'place' && (
          <div>
            <select
              value={destPlaceId}
              onChange={(e) => {
                setDestPlaceId(e.target.value);
                setTimeout(() => onCalculateRoute(), 50);
              }}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium text-slate-800 bg-white"
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Mode 3: Pick on Map */}
        {destMode === 'map_pin' && (
          <div className="bg-purple-50 border border-purple-200 p-3 rounded-lg text-xs text-purple-900 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-bold flex items-center gap-1">
                <span>🏁 Destination Pin Mode</span>
              </p>
              <button
                type="button"
                onClick={() => setIsDestSelectMode(!isDestSelectMode)}
                className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                  isDestSelectMode
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-200/80 text-purple-800 hover:bg-purple-200'
                }`}
              >
                {isDestSelectMode ? 'Click Map Now' : 'Click to Reposition'}
              </button>
            </div>
            {destinationPoint ? (
              <div className="flex items-center justify-between pt-1 border-t border-purple-200/60">
                <div>
                  <p className="font-mono text-xs text-purple-950 font-semibold">
                    Pin: {destinationPoint[0].toFixed(5)}, {destinationPoint[1].toFixed(5)}
                  </p>
                  <p className="text-[10px] text-purple-700">Drag pin on map to adjust position.</p>
                </div>
                <button
                  type="button"
                  onClick={onCalculateRoute}
                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded shadow-xs"
                >
                  Route to Pin
                </button>
              </div>
            ) : (
              <p className="text-purple-700 font-medium">
                Click anywhere on the map to place your destination pin.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Mobility Profile Presets */}
      <div>
        <span className="block text-sm font-semibold text-slate-700 mb-2">
          Mobility Profile Preset:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => selectPreset('wheelchair')}
            className={`min-h-[44px] px-3 py-2 rounded-lg font-medium text-sm flex flex-col items-center justify-center gap-1 border transition-all ${
              profile.name === 'wheelchair'
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            <Accessibility className="w-5 h-5" />
            Wheelchair
          </button>

          <button
            type="button"
            onClick={() => selectPreset('limited_mobility')}
            className={`min-h-[44px] px-3 py-2 rounded-lg font-medium text-sm flex flex-col items-center justify-center gap-1 border transition-all ${
              profile.name === 'limited_mobility'
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            <Footprints className="w-5 h-5" />
            Limited Mobility
          </button>

          <button
            type="button"
            onClick={() => selectPreset('low_vision')}
            className={`min-h-[44px] px-3 py-2 rounded-lg font-medium text-sm flex flex-col items-center justify-center gap-1 border transition-all ${
              profile.name === 'low_vision'
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            <Eye className="w-5 h-5" />
            Low Vision
          </button>

          <button
            type="button"
            onClick={() => selectPreset('pedestrian')}
            className={`min-h-[44px] px-3 py-2 rounded-lg font-medium text-sm flex flex-col items-center justify-center gap-1 border transition-all ${
              profile.name === 'pedestrian'
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            <Sliders className="w-5 h-5" />
            Pedestrian
          </button>
        </div>
      </div>

      {/* Editable Constraints */}
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Editable Accessibility Constraints
        </h3>

        <div className="flex items-center justify-between">
          <label htmlFor="exclude-stairs-toggle" className="text-sm text-slate-700 font-medium">
            Strictly Exclude Stairs
          </label>
          <input
            id="exclude-stairs-toggle"
            type="checkbox"
            checked={profile.exclude_stairs}
            onChange={(e) => setProfile({ ...profile, exclude_stairs: e.target.checked, name: 'custom' })}
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="avoid-rough-toggle" className="text-sm text-slate-700 font-medium">
            Penalise Rough / Unpaved Paths
          </label>
          <input
            id="avoid-rough-toggle"
            type="checkbox"
            checked={profile.avoid_rough}
            onChange={(e) => setProfile({ ...profile, avoid_rough: e.target.checked, name: 'custom' })}
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor="max-slope-input" className="text-sm text-slate-700 font-medium">
            Max Slope Limit (%)
          </label>
          <input
            id="max-slope-input"
            type="number"
            min="2"
            max="30"
            step="1"
            value={profile.max_slope_pct ?? ''}
            placeholder="No limit"
            onChange={(e) =>
              setProfile({
                ...profile,
                max_slope_pct: e.target.value ? parseFloat(e.target.value) : undefined,
                name: 'custom'
              })
            }
            className="w-24 h-9 px-2 text-right rounded border border-slate-300 text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor="min-width-input" className="text-sm text-slate-700 font-medium">
            Min Pathway Width (m)
          </label>
          <input
            id="min-width-input"
            type="number"
            min="0.5"
            max="4.0"
            step="0.1"
            value={profile.min_width_m ?? ''}
            placeholder="No limit"
            onChange={(e) =>
              setProfile({
                ...profile,
                min_width_m: e.target.value ? parseFloat(e.target.value) : undefined,
                name: 'custom'
              })
            }
            className="w-24 h-9 px-2 text-right rounded border border-slate-300 text-sm"
          />
        </div>

        <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold text-slate-700">Strict Evidence Mode:</span>
          </div>
          <select
            value={strictness}
            onChange={(e) => setStrictness(e.target.value)}
            className="h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            <option value="strict">Strict (Exclude Unverified Risks)</option>
            <option value="exploratory">Exploratory (Allow with Warnings)</option>
          </select>
        </div>
      </div>

      {/* Main Calculate Route Button */}
      <button
        type="button"
        onClick={onCalculateRoute}
        disabled={loading}
        className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg shadow transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-4 focus:ring-blue-300"
      >
        {loading ? (
          <span>Calculating Constrained Route...</span>
        ) : (
          <>
            <Navigation className="w-5 h-5" />
            <span>
              {useRealTimeOrigin && userLocation
                ? 'Plan Accessible Route from My GPS Location'
                : 'Calculate Accessible Route'}
            </span>
          </>
        )}
      </button>
    </div>
  );
};

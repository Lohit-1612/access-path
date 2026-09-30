import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { NodeItem, EdgeItem, Place, RouteResponse, BarrierItem } from '../types';
import { LiveNavigationHUD } from './LiveNavigationHUD';
import { GoogleMapsSearchBar } from './GoogleMapsSearchBar';
import { VisionAssistCamera } from './VisionAssistCamera';
import { Navigation, Play, Eye } from 'lucide-react';

interface MapViewProps {
  nodes: NodeItem[];
  edges: EdgeItem[];
  places: Place[];
  route: RouteResponse | null;
  barriers: BarrierItem[];
  originPlaceId?: string;
  destPlaceId?: string;
  originName?: string;
  destName?: string;
  reportPin?: [number, number] | null;
  onPinChange?: (lat: number, lon: number) => void;
  isPinSelectMode?: boolean;
  userLocation?: [number, number] | null;
  userLocationAccuracy?: number | null;
  onUpdateUserLocation?: (pos: [number, number]) => void;
  destinationPoint?: [number, number] | null;
  onDestinationPointChange?: (lat: number, lon: number) => void;
  isDestSelectMode?: boolean;
  onToggleDestSelectMode?: () => void;
  isNavigating?: boolean;
  onStartNavigation?: () => void;
  onExitNavigation?: () => void;
  heading?: number;
  onHeadingChange?: (h: number) => void;
  selectedLanguage?: string;
  onLanguageChange?: (lang: string) => void;
  onSelectSearchDestination?: (coords: [number, number], name: string) => void;
  isBlindCameraOpen?: boolean;
  onToggleBlindCamera?: () => void;
  onDeleteBarrier?: (barrierId: string) => void;
}

export const MapView: React.FC<MapViewProps> = ({
  nodes,
  edges,
  places,
  route,
  barriers,
  originPlaceId,
  destPlaceId,
  originName = 'Origin',
  destName = 'Destination',
  reportPin,
  onPinChange,
  isPinSelectMode,
  userLocation,
  userLocationAccuracy,
  onUpdateUserLocation,
  destinationPoint,
  onDestinationPointChange,
  isDestSelectMode,
  onToggleDestSelectMode,
  isNavigating = false,
  onStartNavigation,
  onExitNavigation,
  heading = 0,
  onHeadingChange,
  selectedLanguage = 'en',
  onLanguageChange,
  onSelectSearchDestination,
  isBlindCameraOpen,
  onToggleBlindCamera,
  onDeleteBarrier
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const networkLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const barriersLayerRef = useRef<L.LayerGroup | null>(null);
  const pinMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userAccuracyCircleRef = useRef<L.Circle | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);

  const [isAutoFollow, setIsAutoFollow] = useState<boolean>(true);

  // Initialise map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = userLocation || [13.0833, 80.2707];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 17,
      zoomControl: true,
    });

    // Free OpenStreetMap tiles (No API key required)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    map.on('dragstart', () => setIsAutoFollow(false));
    map.on('zoomstart', () => setIsAutoFollow(false));

    networkLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    barriersLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Click handler for map interactions (Destination placement or Barrier reporting)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (isDestSelectMode && onDestinationPointChange) {
        onDestinationPointChange(e.latlng.lat, e.latlng.lng);
      } else if (isPinSelectMode && onPinChange) {
        onPinChange(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isDestSelectMode, onDestinationPointChange, isPinSelectMode, onPinChange]);

  // Render Network (Edges & Places)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const netLayer = networkLayerRef.current;
    if (!map || !netLayer) return;

    netLayer.clearLayers();

    // 1. Draw all edges
    edges.forEach((edge) => {
      const latlngs = edge.geom_parsed.map(([lon, lat]) => [lat, lon] as [number, number]);
      const isStair = edge.stairs;

      const polyline = L.polyline(latlngs, {
        color: isStair ? '#d97706' : '#94a3b8',
        weight: isStair ? 5 : 3,
        dashArray: isStair ? '6, 6' : undefined,
        opacity: 0.65
      });

      polyline.bindPopup(`
        <div style="font-family: inherit; font-size: 13px;">
          <strong>${edge.name || 'Campus Walkway'}</strong><br/>
          Length: ${edge.length_m} m<br/>
          ${edge.stairs ? '<span style="color:#b45309; font-weight:bold;">⚠️ Contains Stairs (Incompatible for Wheelchair)</span><br/>' : '<span style="color:#059669;">✓ Step-Free Segment</span><br/>'}
          Surface: ${edge.surface} | Width: ${edge.width_m || 'N/A'} m
        </div>
      `);
      polyline.addTo(netLayer);
    });

    // 2. Draw place labels / markers
    places.forEach((place) => {
      const isOrigin = place.id === originPlaceId;
      const isDest = place.id === destPlaceId;

      const badgeColor = isOrigin ? '#16a34a' : isDest ? '#2563eb' : '#475569';
      const labelText = isOrigin ? `START: ${place.name}` : isDest ? `END: ${place.name}` : place.name;

      const customIcon = L.divIcon({
        className: 'custom-place-marker',
        html: `
          <div style="background-color: ${badgeColor}; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.25); white-space: nowrap; transform: translate(-50%, -50%);">
            ${labelText}
          </div>
        `,
        iconSize: [0, 0]
      });

      const marker = L.marker([place.lat, place.lon], { icon: customIcon });
      marker.bindPopup(`<strong>${place.name}</strong><br/>Type: ${place.category}`);
      marker.addTo(netLayer);
    });
  }, [edges, places, originPlaceId, destPlaceId]);

  // Render Barriers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const bLayer = barriersLayerRef.current;
    if (!map || !bLayer) return;

    bLayer.clearLayers();

    barriers.forEach((b) => {
      const isActive = b.status === 'verified_active';
      const isPending = b.status === 'pending';
      const isResolved = b.status === 'resolved';

      if (isResolved) return;

      const markerColor = isActive ? '#dc2626' : isPending ? '#d97706' : '#7c3aed';
      const iconSymbol = isActive ? '⛔' : isPending ? '⚠️' : '❓';

      const icon = L.divIcon({
        className: 'barrier-marker',
        html: `
          <div style="background-color: ${markerColor}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35); transform: translate(-50%, -50%);">
            ${iconSymbol}
          </div>
        `,
        iconSize: [0, 0]
      });

      const marker = L.marker([b.lat, b.lon], { icon });

      const popupDiv = document.createElement('div');
      popupDiv.style.fontFamily = 'inherit';
      popupDiv.style.fontSize = '13px';
      popupDiv.style.minWidth = '200px';

      popupDiv.innerHTML = `
        <div style="font-weight: 800; color: ${markerColor}; text-transform: uppercase; font-size: 13px; margin-bottom: 2px;">
          ${iconSymbol} ${b.category.replace('_', ' ')}
        </div>
        <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">
          Status: <strong style="color:${markerColor};">${isActive ? 'Verified Active Barrier' : isPending ? 'Pending Inspection (Unverified)' : b.status}</strong> • ${b.freshness_hours}h ago
        </div>
        ${isPending ? '<div style="background:#fef3c7; color:#92400e; padding:4px 6px; border-radius:4px; font-size:11px; font-weight:600; margin-bottom:6px;">⚠️ Unverified community report (Provisional avoidance active)</div>' : ''}
        ${b.is_stale ? '<div style="color:#dc2626; font-weight:bold; font-size:11px; margin-bottom:4px;">⚠️ Stale Evidence (>24h)</div>' : ''}
        ${b.notes ? `<div style="font-size: 12px; color: #334155; margin-bottom: 8px; background: #f8fafc; padding: 6px; border-radius: 6px; border: 1px solid #e2e8f0;">${b.notes}</div>` : ''}
        ${b.image_url ? `<img src="${b.image_url}" alt="Barrier" style="width: 100%; border-radius: 6px; margin-bottom: 8px; max-height: 120px; object-fit: cover;"/>` : ''}
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          <button id="clear-report-btn-${b.id}" style="width: 100%; padding: 6px 10px; background-color: #2563eb; color: white; border: none; border-radius: 6px; font-weight: 700; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: background 0.2s;">
            <span>📢 Report Pathway Cleared</span>
          </button>
          <button id="del-barrier-btn-${b.id}" style="width: 100%; padding: 5px 8px; background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: background 0.2s;">
            <span>✓ Confirm Resolution (Verifier)</span>
          </button>
        </div>
      `;

      const clearBtn = popupDiv.querySelector(`#clear-report-btn-${b.id}`);
      if (clearBtn) {
        clearBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const { reportBarrierCleared } = await import('../api');
          await reportBarrierCleared(b.id, 'Reported cleared by citizen on map', 'reporter');
          alert('Clearance reported! A campus verifier will inspect and confirm final restoration.');
          map.closePopup();
        });
      }

      const delBtn = popupDiv.querySelector(`#del-barrier-btn-${b.id}`);
      if (delBtn && onDeleteBarrier) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.confirm(`Verify and confirm resolution of this ${b.category.replace('_', ' ')} barrier? The pathway will immediately become accessible for all users.`)) {
            onDeleteBarrier(b.id);
            map.closePopup();
          }
        });
      }

      marker.bindPopup(popupDiv);
      marker.addTo(bLayer);
    });
  }, [barriers, onDeleteBarrier]);

  // Render Calculated Route
  useEffect(() => {
    const map = mapInstanceRef.current;
    const rLayer = routeLayerRef.current;
    if (!map || !rLayer) return;

    rLayer.clearLayers();

    if (route && route.status === 'ok' && route.geometry && route.geometry.features) {
      const allCoords: [number, number][] = [];

      route.geometry.features.forEach((feature) => {
        const coords = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
        allCoords.push(...coords);

        const routeLine = L.polyline(coords, {
          color: '#2563eb', // Vibrant Accessible Blue
          weight: 7,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round'
        });
        routeLine.addTo(rLayer);
      });

      // Fit map bounds to route if available
      if (allCoords.length > 0) {
        map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
      }
    }
  }, [route]);

  // Render Report Pin Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (reportPin) {
      if (!pinMarkerRef.current) {
        const pinIcon = L.divIcon({
          className: 'custom-pin-marker',
          html: `
            <div style="background-color: #ef4444; color: white; width: 36px; height: 36px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg) translate(-25%, -25%); display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
              <span style="transform: rotate(45deg); font-weight: bold; font-size: 18px;">📍</span>
            </div>
          `,
          iconSize: [0, 0]
        });

        pinMarkerRef.current = L.marker(reportPin, { icon: pinIcon, draggable: true }).addTo(map);
        pinMarkerRef.current.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          if (onPinChange) onPinChange(pos.lat, pos.lng);
        });
      } else {
        pinMarkerRef.current.setLatLng(reportPin);
      }
    } else if (pinMarkerRef.current) {
      pinMarkerRef.current.remove();
      pinMarkerRef.current = null;
    }
  }, [reportPin, onPinChange]);

  // Render Real-Time GPS User Location Marker & Camera Tracking
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userLocation) {
      // 1. Google Maps Navigation Puck (When Navigating) vs Standard Beacon (When Planning)
      const currentIcon = isNavigating
        ? L.divIcon({
            className: 'gmaps-nav-puck',
            html: `
              <div style="position: relative; width: 48px; height: 48px; transform: translate(-50%, -50%); pointer-events: none;">
                <!-- Directional FOV Cone/Beam -->
                <div style="position: absolute; top: -20px; left: 6px; width: 36px; height: 38px; background: linear-gradient(to top, rgba(37, 99, 235, 0.45), transparent); clip-path: polygon(50% 100%, 0 0, 100% 0); transform-origin: 50% 100%; transform: rotate(${heading || 0}deg);"></div>
                <!-- Pulsing outer GPS halo -->
                <div style="position: absolute; top: 0; left: 0; width: 48px; height: 48px; background: rgba(37, 99, 235, 0.28); border-radius: 50%; animation: pulse 1.6s infinite;"></div>
                <!-- 3D Navigation Disc with Directional Arrowhead -->
                <div style="position: absolute; top: 9px; left: 9px; width: 30px; height: 30px; background: #1d4ed8; border: 3px solid white; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; transform: rotate(${heading || 0}deg); transition: transform 0.15s ease-out;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
                </div>
              </div>
            `,
            iconSize: [0, 0]
          })
        : L.divIcon({
            className: 'user-live-gps-marker',
            html: `
              <div style="position: relative; width: 34px; height: 34px; transform: translate(-50%, -50%);">
                <div style="position: absolute; width: 34px; height: 34px; background: rgba(37, 99, 235, 0.35); border-radius: 50%; animation: pulse 1.8s infinite;"></div>
                <div style="position: absolute; top: 6px; left: 6px; width: 22px; height: 22px; background: #2563eb; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px;">
                  ●
                </div>
              </div>
            `,
            iconSize: [0, 0]
          });

      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker(userLocation, { icon: currentIcon, zIndexOffset: 1000 }).addTo(map);
        userMarkerRef.current.bindPopup(
          '<div style="font-family: inherit; font-size: 13px;">' +
          '<strong style="color: #2563eb;">📍 Your Real-Time GPS Location</strong><br/>' +
          `Latitude: ${userLocation[0].toFixed(5)}<br/>` +
          `Longitude: ${userLocation[1].toFixed(5)}<br/>` +
          `<span style="color: #64748b; font-size: 11px;">Accuracy: ±${Math.round(userLocationAccuracy || 5)} m</span><br/>` +
          '<span style="color: #059669; font-weight: bold;">Active Navigation Origin</span>' +
          '</div>'
        );
      } else {
        userMarkerRef.current.setIcon(currentIcon);
        userMarkerRef.current.setLatLng(userLocation);
      }

      // 2. Draw accuracy radius circle
      if (!userAccuracyCircleRef.current) {
        userAccuracyCircleRef.current = L.circle(userLocation, {
          radius: userLocationAccuracy || 15,
          color: '#2563eb',
          weight: 1.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        userAccuracyCircleRef.current.setLatLng(userLocation);
        userAccuracyCircleRef.current.setRadius(userLocationAccuracy || 15);
      }

      // 3. Camera Auto-Follow Behavior
      if (isNavigating) {
        if (isAutoFollow) {
          map.panTo(userLocation, { animate: true, duration: 0.5 });
        }
      } else {
        map.flyTo(userLocation, 17, { duration: 1.0 });
      }
    } else {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      if (userAccuracyCircleRef.current) {
        userAccuracyCircleRef.current.remove();
        userAccuracyCircleRef.current = null;
      }
    }
  }, [userLocation, userLocationAccuracy, isNavigating, heading, isAutoFollow]);

  // Render Custom Destination Pin
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (destinationPoint) {
      const destIcon = L.divIcon({
        className: 'custom-destination-marker',
        html: `
          <div style="background-color: #7c3aed; color: white; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 800; border: 2.5px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.35); white-space: nowrap; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 4px;">
            <span>🏁</span>
            <span>Destination</span>
          </div>
        `,
        iconSize: [0, 0]
      });

      if (!destMarkerRef.current) {
        destMarkerRef.current = L.marker(destinationPoint, { icon: destIcon, draggable: true, zIndexOffset: 990 }).addTo(map);
        destMarkerRef.current.bindPopup(`<strong>🏁 ${destName || 'Custom Destination'}</strong><br/>Drag to reposition or click anywhere on map.`);
        destMarkerRef.current.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          if (onDestinationPointChange) onDestinationPointChange(pos.lat, pos.lng);
        });
      } else {
        destMarkerRef.current.setIcon(destIcon);
        destMarkerRef.current.setLatLng(destinationPoint);
      }

      // If userLocation and destinationPoint both exist and no route yet, fit bounds
      if (userLocation && !route) {
        map.fitBounds(L.latLngBounds([userLocation, destinationPoint]), { padding: [60, 60] });
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
  }, [destinationPoint, userLocation, route, onDestinationPointChange, destName]);

  const [localBlindCameraOpen, setLocalBlindCameraOpen] = useState<boolean>(false);
  const effectiveBlindCameraOpen = isBlindCameraOpen !== undefined ? isBlindCameraOpen : localBlindCameraOpen;
  const toggleBlindCamera = onToggleBlindCamera || (() => setLocalBlindCameraOpen((prev) => !prev));

  const handleCenterOnUser = () => {
    setIsAutoFollow(true);
    if (userLocation && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo(userLocation, isNavigating ? 18 : 17, { duration: 0.8 });
    }
  };

  return (
    <div className={`relative w-full ${isNavigating ? 'h-[640px]' : 'h-[520px]'} rounded-2xl overflow-hidden shadow-2xl border border-slate-300 transition-all duration-300 ${isDestSelectMode ? 'cursor-crosshair ring-2 ring-purple-500' : ''}`}>
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Floating Google Maps Style Destination & Street Search Bar */}
      {!isNavigating && onSelectSearchDestination && (
        <div className="absolute top-3 left-3 z-[450] max-w-[calc(100%-140px)] sm:max-w-md pointer-events-auto">
          <GoogleMapsSearchBar
            onSelectDestination={onSelectSearchDestination}
            currentDestName={destName}
            userLocation={userLocation || null}
          />
        </div>
      )}

      {/* Floating Quick Action Map Controls (Top-Right) */}
      {!isNavigating && (
        <div className="absolute top-3 right-3 z-[450] flex flex-col gap-2 pointer-events-auto">
          {/* Blind Vision Radar Button */}
          <button
            type="button"
            onClick={toggleBlindCamera}
            className={`px-3 py-2 rounded-lg shadow-md border text-xs font-bold flex items-center gap-1.5 transition-all ${
              effectiveBlindCameraOpen
                ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                : 'bg-white/95 hover:bg-white text-indigo-700 hover:text-indigo-900 border-slate-200'
            }`}
            title="Toggle Live Blind Walking Camera & Obstacle Detector"
          >
            <Eye className="w-4 h-4 text-indigo-600" />
            <span className="hidden sm:inline">Blind Radar</span>
          </button>

          {userLocation && (
            <button
              type="button"
              onClick={handleCenterOnUser}
              className="bg-white/95 hover:bg-white text-blue-700 hover:text-blue-900 px-3 py-2 rounded-lg shadow-md border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all focus:ring-2 focus:ring-blue-400"
              title="Center map on your real-time GPS location"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
              <span className="hidden sm:inline">Center on Me</span>
            </button>
          )}

          {onToggleDestSelectMode && (
            <button
              type="button"
              onClick={onToggleDestSelectMode}
              className={`px-3 py-2 rounded-lg shadow-md border text-xs font-bold flex items-center gap-1.5 transition-all ${
                isDestSelectMode
                  ? 'bg-purple-600 text-white border-purple-700 ring-2 ring-purple-300'
                  : 'bg-white/95 hover:bg-white text-purple-700 hover:text-purple-900 border-slate-200'
              }`}
              title="Click anywhere on map to drop destination pin"
            >
              <span>🏁</span>
              <span className="hidden sm:inline">{isDestSelectMode ? 'Click Map Now...' : 'Drop Pin'}</span>
            </button>
          )}
        </div>
      )}

      {/* Floating "Start Live Navigation" Button (Google Maps Style) */}
      {!isNavigating && route && route.status === 'ok' && onStartNavigation && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[420] pointer-events-auto">
          <button
            type="button"
            onClick={onStartNavigation}
            className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-sm sm:text-base px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-2.5 border-2 border-white transition-all transform hover:scale-105 active:scale-95 animate-pulse"
          >
            <Navigation className="w-5 h-5 fill-white" />
            <span>Start Live Navigation</span>
          </button>
        </div>
      )}

      {/* Map Legend Overlay (Shown only when not navigating to prevent clutter) */}
      {!isNavigating && (
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm p-3 rounded-lg shadow-md border border-slate-200 z-[400] text-xs space-y-1.5 pointer-events-auto hidden sm:block">
          <div className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-1">
            Accessibility Map Legend
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1.5 bg-blue-600 rounded"></div>
            <span className="text-slate-700 font-medium">Accessible Selected Route</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 border-t-2 border-dashed border-amber-600"></div>
            <span className="text-slate-700">Flight of Stairs (18 Steps)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-600 border border-white"></div>
            <span className="text-slate-700 font-medium">You Are Here (Live GPS)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">🏁</span>
            <span className="text-slate-700 font-medium">Destination Point</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">⛔</span>
            <span className="text-slate-700 font-medium">Verified Barrier (Detour)</span>
          </div>
        </div>
      )}

      {isDestSelectMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-purple-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-semibold z-[400] flex items-center gap-2 animate-bounce">
          <span>🏁 Click anywhere on the map to set your destination</span>
        </div>
      )}

      {isPinSelectMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-rose-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-semibold z-[400] flex items-center gap-2 animate-bounce">
          <span>📍 Click anywhere on map to position barrier pin</span>
        </div>
      )}

      {/* FULL GOOGLE MAPS NAVIGATION HUD OVERLAY */}
      {isNavigating && route && (
        <LiveNavigationHUD
          route={route}
          originName={originName}
          destName={destName}
          userLocation={userLocation || null}
          onUpdateUserLocation={onUpdateUserLocation || (() => {})}
          onExitNavigation={onExitNavigation || (() => {})}
          isAutoFollow={isAutoFollow}
          onToggleAutoFollow={handleCenterOnUser}
          heading={heading}
          onHeadingChange={onHeadingChange || (() => {})}
          selectedLanguage={selectedLanguage}
          onLanguageChange={onLanguageChange}
          isBlindCameraOpen={effectiveBlindCameraOpen}
          onToggleBlindCamera={toggleBlindCamera}
        />
      )}

      {/* LIVE BLIND NAVIGATION VISION ASSIST CAMERA RADAR */}
      <VisionAssistCamera
        isOpen={effectiveBlindCameraOpen}
        onClose={toggleBlindCamera}
        selectedLanguage={selectedLanguage || 'en'}
        onLanguageChange={onLanguageChange || (() => {})}
      />
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Navigation, X, Building, Compass, Sparkles } from 'lucide-react';

interface SearchResultItem {
  id: string;
  name: string;
  subtitle?: string;
  area?: string;
  category: string;
  lat: number;
  lon: number;
  distance_m?: number;
  distance_str?: string;
  type: string;
}

interface GoogleMapsSearchBarProps {
  onSelectDestination: (coords: [number, number], name: string) => void;
  currentDestName?: string;
  userLocation: [number, number] | null;
}

export const GoogleMapsSearchBar: React.FC<GoogleMapsSearchBarProps> = ({
  onSelectDestination,
  currentDestName,
  userLocation
}) => {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounced search with user location proximity
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        let url = `/api/places/search?q=${encodeURIComponent(query.trim())}`;
        if (userLocation) {
          url += `&lat=${userLocation[0]}&lon=${userLocation[1]}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setResults(data || []);
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('Search query error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query, userLocation]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (item: SearchResultItem) => {
    onSelectDestination([item.lat, item.lon], item.name);
    setQuery(item.name);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md pointer-events-auto">
      {/* Floating Google Maps Style Search Card */}
      <div className="bg-white/98 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200/90 flex items-center px-3.5 py-2.5 transition-all focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
        <Search className="w-5 h-5 text-slate-400 shrink-0 mr-2.5" />

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder="Search destination, street, or landmark..."
          className="w-full bg-transparent text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none"
        />

        {isLoading && (
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2 shrink-0"></div>
        )}

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown List with Google Maps Distances */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-[500] max-h-80 overflow-y-auto divide-y divide-slate-100">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-blue-50/70 transition-colors group"
            >
              <div className="w-9 h-9 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0 text-slate-600 group-hover:text-blue-600 transition-colors">
                {item.type === 'campus_place' ? (
                  <Building className="w-4 h-4" />
                ) : (
                  <MapPin className="w-4 h-4" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800 truncate group-hover:text-blue-700">
                  {item.name}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {item.subtitle || item.area || 'Accessible Location'}
                </div>
              </div>

              {/* Exact Distance Badge (Google Maps Style) */}
              {item.distance_str && (
                <div className="flex flex-col items-end shrink-0 ml-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 group-hover:bg-blue-600 group-hover:text-white text-blue-700 text-xs font-bold font-mono transition-colors">
                    {item.distance_str}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">away</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

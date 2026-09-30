import React, { useState } from 'react';
import { submitReport, markBarrier } from '../api';
import { BarrierItem } from '../types';
import {
  Camera, Upload, MapPin, Sparkles, AlertCircle, ArrowRight,
  ShieldAlert, Trash2, CheckCircle2, LocateFixed, Eye, ListFilter
} from 'lucide-react';

interface ReportBarrierProps {
  pin: [number, number];
  onEnablePinMode: () => void;
  onReportSubmitted: (reportId: string, jobId: string) => void;
  barriers?: BarrierItem[];
  onBarrierMarked?: () => void;
  onDeleteBarrier?: (barrierId: string) => void;
  userLocation?: [number, number] | null;
  onUseUserLocation?: () => void;
}

export const ReportBarrier: React.FC<ReportBarrierProps> = ({
  pin,
  onEnablePinMode,
  onReportSubmitted,
  barriers = [],
  onBarrierMarked,
  onDeleteBarrier,
  userLocation,
  onUseUserLocation
}) => {
  const [subTab, setSubTab] = useState<'mark' | 'active'>('mark');
  const [category, setCategory] = useState('construction');
  const [notes, setNotes] = useState('Obstacle blocking pedestrian pathway.');
  const [selectedSample, setSelectedSample] = useState<string>('construction_east_path.jpg');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [markingActive, setMarkingActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const sampleImages = [
    { key: 'construction_east_path.jpg', label: 'East Footpath Construction Barricade' },
    { key: 'stairs_flight.jpg', label: 'Stairway Flight (18 Stone Steps)' },
    { key: 'pothole_path.jpg', label: 'Damaged Surface / Broken Pavement' },
    { key: 'clear_accessible_path.jpg', label: 'Clear Accessible Walkway' }
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadedFile(file);
      setSelectedSample('');
    }
  };

  const handleSelectSample = (sampleKey: string) => {
    setSelectedSample(sampleKey);
    setUploadedFile(null);
    if (sampleKey.includes('construction')) setCategory('construction');
    else if (sampleKey.includes('stair')) setCategory('stairs');
    else if (sampleKey.includes('pothole')) setCategory('damaged_surface');
  };

  // Direct 1-Click Barrier Marking (Active for all other users)
  const handleInstantMark = async () => {
    setMarkingActive(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await markBarrier({
        category,
        lat: pin[0],
        lon: pin[1],
        notes
      });
      setSuccessMsg(`Barrier marked! Pathway around (${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}) is now blocked for all users.`);
      if (onBarrierMarked) onBarrierMarked();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to mark barrier.');
    } finally {
      setMarkingActive(false);
    }
  };

  // Multi-stage AI Inference Pipeline Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('lat', pin[0].toString());
      formData.append('lon', pin[1].toString());
      formData.append('accuracy_m', '4.0');
      formData.append('notes', notes);

      if (uploadedFile) {
        formData.append('image', uploadedFile);
      } else if (selectedSample) {
        formData.append('sample_key', selectedSample);
      }

      const res = await submitReport(formData);
      onReportSubmitted(res.report_id, res.job_id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit barrier report.');
    } finally {
      setSubmitting(false);
    }
  };

  const activeBarriers = barriers.filter(b => b.status !== 'resolved');

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 max-w-xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Camera className="w-6 h-6 text-rose-600" />
          Pathway Barriers & Hazards
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Mark barriers that other users should avoid, or delete cleared barriers to reopen accessible routes.
        </p>
      </div>

      {/* Sub Tabs: Mark New vs View/Delete Active */}
      <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-lg text-xs font-bold">
        <button
          type="button"
          onClick={() => setSubTab('mark')}
          className={`py-2 px-3 rounded-md transition-all flex items-center justify-center gap-1.5 ${
            subTab === 'mark'
              ? 'bg-white text-rose-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
          <span>Mark Barrier</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('active')}
          className={`py-2 px-3 rounded-md transition-all flex items-center justify-center gap-1.5 ${
            subTab === 'active'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ListFilter className="w-3.5 h-3.5 text-blue-600" />
          <span>Active Barriers ({activeBarriers.length})</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* TAB 1: MARK BARRIER */}
      {subTab === 'mark' && (
        <div className="space-y-4">
          {/* Barrier Category */}
          <div>
            <label htmlFor="cat-select" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Observed Barrier Type:
            </label>
            <select
              id="cat-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 text-sm font-semibold bg-slate-50 text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-none"
            >
              <option value="construction">🚧 Construction / Excavation / Barricade</option>
              <option value="stairs">🪜 Staircase / Steps without Ramp</option>
              <option value="damaged_surface">🕳️ Pothole / Broken Surface / Damaged</option>
              <option value="blockage">⛔ Blocked Pathway / Parked Vehicles / Debris</option>
              <option value="missing_ramp">♿ Missing Curb Ramp</option>
              <option value="steep_slope">⚠️ Steep Slope / Excessive Incline</option>
            </select>
          </div>

          {/* Pin Location on Map */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase">Barrier Pin Location</span>
              <p className="font-mono text-xs text-slate-800 font-bold mt-0.5">
                {pin[0].toFixed(5)}, {pin[1].toFixed(5)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {userLocation && onUseUserLocation && (
                <button
                  type="button"
                  onClick={onUseUserLocation}
                  className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                  title="Snap pin to your live GPS coordinates"
                >
                  <LocateFixed className="w-3.5 h-3.5" />
                  <span>My GPS</span>
                </button>
              )}
              <button
                type="button"
                onClick={onEnablePinMode}
                className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-rose-500" />
                <span>Pick on Map</span>
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Description / Notes:
            </label>
            <textarea
              id="notes-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 text-xs font-medium bg-slate-50 text-slate-800 focus:ring-2 focus:ring-rose-500 focus:outline-none"
              placeholder="Describe obstruction width, hazard, or conditions..."
            />
          </div>

          {/* Action 1: Instant Mark for all users */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleInstantMark}
              disabled={markingActive}
              className="w-full min-h-[46px] bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-4 focus:ring-rose-300 text-sm"
            >
              <ShieldAlert className="w-4 h-4 text-white" />
              <span>{markingActive ? 'Activating Barrier on Map...' : '🚨 Mark Barrier Now (Active for All Users)'}</span>
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-1">
              Immediately blocks this pathway on the shared map so all pedestrian routes avoid it.
            </p>
          </div>

          {/* Section: Optional Photo Evidence & AI Detection */}
          <details className="pt-2 border-t border-slate-200">
            <summary className="text-xs font-bold text-slate-600 cursor-pointer hover:text-slate-900 py-1">
              Optional: Attach Photo & Run AI Barrier Detection
            </summary>
            <form onSubmit={handleSubmit} className="mt-3 space-y-3">
              {/* Benchmark Sample Images */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Select Benchmark Photo:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {sampleImages.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      onClick={() => handleSelectSample(s.key)}
                      className={`p-2 text-left rounded-lg text-xs font-medium border transition-all ${
                        selectedSample === s.key
                          ? 'bg-blue-50 text-blue-700 border-blue-500 ring-1 ring-blue-200 font-bold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload Input */}
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-3 text-center hover:bg-slate-50 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  id="file-upload"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center justify-center gap-0.5 text-slate-600"
                >
                  <Upload className="w-5 h-5 text-slate-400" />
                  <span className="text-xs font-semibold text-blue-600 hover:underline">
                    Upload photo from camera / file
                  </span>
                  <span className="text-[10px] text-slate-400">JPG, PNG, WebP (EXIF stripped)</span>
                </label>
                {uploadedFile && (
                  <p className="mt-1 text-xs font-semibold text-emerald-600">
                    Selected: {uploadedFile.name}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[42px] bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>{submitting ? 'Running AI Detection...' : 'Submit with AI Photo Verification'}</span>
              </button>
            </form>
          </details>
        </div>
      )}

      {/* TAB 2: ACTIVE BARRIERS LIST (DELETE & MANAGE) */}
      {subTab === 'active' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Active barriers marked by you and other users. Clicking <strong>Delete</strong> clears the barrier and restores the accessible route for everyone.
          </p>

          {activeBarriers.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-lg border border-slate-200">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No Active Barriers</p>
              <p className="text-xs text-slate-400 mt-0.5">All pathways are clear and accessible.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {activeBarriers.map((b) => (
                <div
                  key={b.id}
                  className="bg-white border border-slate-200 rounded-lg p-3 shadow-xs flex items-start justify-between gap-3 hover:border-slate-300 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800">
                        {b.category.replace('_', ' ')}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {b.freshness_hours}h ago
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        Active
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-slate-800 mt-1">
                      {b.notes || 'Pathway obstruction'}
                    </p>

                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      📍 {b.lat.toFixed(5)}, {b.lon.toFixed(5)}
                    </p>
                  </div>

                  {onDeleteBarrier && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete and clear this ${b.category.replace('_', ' ')} barrier? The pathway will immediately become accessible for all users.`)) {
                          onDeleteBarrier(b.id);
                        }
                      }}
                      className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-900 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                      title="Clear barrier and reopen pathway"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

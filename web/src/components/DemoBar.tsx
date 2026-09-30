import React, { useState } from 'react';
import { Play, RotateCcw, AlertTriangle, ShieldCheck, CheckCheck, XCircle } from 'lucide-react';
import { submitReport, patchReport, submitReview, resetDemo, calculateRoute } from '../api';
import { MobilityProfile } from '../types';

interface DemoBarProps {
  onStepExecuted: () => void;
  setOriginPlaceId: (id: string) => void;
  setDestPlaceId: (id: string) => void;
  setProfile: (p: MobilityProfile) => void;
}

export const DemoBar: React.FC<DemoBarProps> = ({
  onStepExecuted,
  setOriginPlaceId,
  setDestPlaceId,
  setProfile
}) => {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [executing, setExecuting] = useState<boolean>(false);
  const [demoReportId, setDemoReportId] = useState<string | null>(null);

  // 1-Click Reset
  const handleReset = async () => {
    setExecuting(true);
    await resetDemo();
    setActiveStep(0);
    setDemoReportId(null);
    setOriginPlaceId('place_north_gate');
    setDestPlaceId('place_main_library');
    setProfile({
      name: 'wheelchair',
      exclude_stairs: true,
      max_slope_pct: 8.0,
      min_width_m: 0.9,
      avoid_rough: true,
      avoid_construction: true,
      step_free_required: true
    });
    setExecuting(false);
    onStepExecuted();
  };

  // Demo Step 1: Standard Route with Stairs (500m)
  const runStep1 = () => {
    setOriginPlaceId('place_north_gate');
    setDestPlaceId('place_main_library');
    setProfile({
      name: 'pedestrian',
      exclude_stairs: false,
      max_slope_pct: 100.0,
      avoid_rough: false,
      avoid_construction: true,
      step_free_required: false
    });
    setActiveStep(1);
    onStepExecuted();
  };

  // Demo Step 2: Wheelchair Profile selects 650m Step-Free Route B
  const runStep2 = () => {
    setOriginPlaceId('place_north_gate');
    setDestPlaceId('place_main_library');
    setProfile({
      name: 'wheelchair',
      exclude_stairs: true,
      max_slope_pct: 8.0,
      min_width_m: 0.9,
      avoid_rough: true,
      avoid_construction: true,
      step_free_required: true
    });
    setActiveStep(2);
    onStepExecuted();
  };

  // Demo Step 3: Report East Footpath Blockage & Confirm AI Bounding Boxes
  const runStep3 = async () => {
    setExecuting(true);
    try {
      const formData = new FormData();
      formData.append('category', 'construction');
      formData.append('lat', '13.08388');
      formData.append('lon', '80.27173');
      formData.append('accuracy_m', '3.5');
      formData.append('notes', 'Major roadwork barricade on East Footpath tree walkway.');
      formData.append('sample_key', 'construction_east_path.jpg');

      const res = await submitReport(formData);
      setDemoReportId(res.report_id);

      // Confirm and associate edge
      await patchReport(res.report_id, {
        corrected_category: 'construction',
        affected_edge_ids: ['e_east_blocked_segment_fwd', 'e_east_blocked_segment_rev'],
        extent: 'complete',
        direction: 'both',
        notes: 'East Footpath walkway completely blocked by excavator',
        expected_version: 1
      });

      setActiveStep(3);
      onStepExecuted();
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  };

  // Demo Step 4: Verifier Accepts Report -> Live Reroute to 720m (+70m detour)
  const runStep4 = async () => {
    if (!demoReportId) {
      alert('Please click Step 3 first to report the barrier.');
      return;
    }
    setExecuting(true);
    try {
      await submitReview(demoReportId, {
        action: 'verify',
        reason: 'Confirmed active excavation work. East Footpath closed.',
        expected_version: 2,
        actor_name: 'Dr. Sarah Miller (Campus Verifier)'
      });
      setActiveStep(4);
      onStepExecuted();
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  };

  // Demo Step 5: Verifier Resolves Clearance -> Route Restores to 650m
  const runStep5 = async () => {
    if (!demoReportId) return;
    setExecuting(true);
    try {
      await submitReview(demoReportId, {
        action: 'resolve',
        reason: 'Work completed; barrier removed and footpath inspected.',
        expected_version: 3,
        actor_name: 'Dr. Sarah Miller (Campus Verifier)'
      });
      setActiveStep(5);
      onStepExecuted();
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  };

  // Demo Step 6: Block All Step-Free Alternatives -> Honest "No Route"
  const runStep6 = async () => {
    setExecuting(true);
    try {
      // Block Route B
      const repB = await submitReport((() => {
        const fd = new FormData();
        fd.append('category', 'construction');
        fd.append('lat', '13.08388');
        fd.append('lon', '80.27173');
        return fd;
      })());
      await patchReport(repB.report_id, {
        affected_edge_ids: ['e_east_blocked_segment_fwd', 'e_east_blocked_segment_rev'],
        extent: 'complete',
        direction: 'both',
        expected_version: 1
      });
      await submitReview(repB.report_id, { action: 'verify', reason: 'Route B blocked', expected_version: 2 });

      // Block Route C
      const repC = await submitReport((() => {
        const fd = new FormData();
        fd.append('category', 'construction');
        fd.append('lat', '13.08412');
        fd.append('lon', '80.26938');
        return fd;
      })());
      await patchReport(repC.report_id, {
        affected_edge_ids: ['e_ramptop_mid_fwd', 'e_ramptop_mid_rev'],
        extent: 'complete',
        direction: 'both',
        expected_version: 1
      });
      await submitReview(repC.report_id, { action: 'verify', reason: 'Route C blocked', expected_version: 2 });

      setActiveStep(6);
      onStepExecuted();
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="bg-slate-900 text-white p-3 border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-xs uppercase tracking-wider">
            Vector Hacks 26
          </span>
          <span className="text-xs font-semibold text-slate-300 hidden md:inline">
            5-Minute Demonstration Walkthrough (VH-S03 Page 13):
          </span>
        </div>

        {/* Step Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={runStep1}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 1 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            1. Shortest 500m (Stairs)
          </button>

          <button
            type="button"
            onClick={runStep2}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 2 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            2. Wheelchair 650m
          </button>

          <button
            type="button"
            onClick={runStep3}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 3 ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            3. Report Barrier + AI
          </button>

          <button
            type="button"
            onClick={runStep4}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 4 ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            4. Verify → Detour 720m
          </button>

          <button
            type="button"
            onClick={runStep5}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 5 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            5. Resolve → Restore 650m
          </button>

          <button
            type="button"
            onClick={runStep6}
            disabled={executing}
            className={`min-h-[36px] px-2.5 py-1 rounded font-bold transition-colors ${
              activeStep === 6 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            6. Block All → No Route
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={executing}
            className="min-h-[36px] px-2.5 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 font-semibold flex items-center gap-1 ml-1"
            title="Reset database to seed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo</span>
          </button>
        </div>
      </div>
    </div>
  );
};

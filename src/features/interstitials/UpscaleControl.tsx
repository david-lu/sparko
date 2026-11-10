import { useId } from 'react';
import { ImageUpscale, RotateCcw, X } from 'lucide-react';
import { comfyStepProgress } from '../../../shared/comfy-progress';
import { isGenerating, isUpscaling, type Interstitial } from '../../../shared/interstitials';
import type { InterstitialController } from './InterstitialController';
import { upscaleLabel, upscaleSource } from './upscale';

/** Optional 2K pass for an existing render. Progress stays inside the button and a reserved status line. */
export default function UpscaleControl({ item, controller, connected }: { item: Interstitial; controller: InterstitialController; connected: boolean }) {
  const id = useId();
  const source = upscaleSource(item), ready = !('error' in source);
  // A finished or failed job for an earlier render does not describe this one; a running job always shows.
  const job = item.upscale && (isUpscaling(item.upscale) || ready && item.upscale.sourceAssetId === source.assetId) ? item.upscale : undefined;
  const active = isUpscaling(job), upscaled = ready && !!source.result.upscaled;
  const unavailable = !ready ? source.error : isGenerating(item) ? 'Wait for the current generation to finish.' : !connected ? 'Comfy Cloud is not connected.' : undefined;
  const progress = job?.phase === 'rendering' ? comfyStepProgress(job.progressDetails) : job?.phase === 'loading' ? job.progress : undefined;
  const status = job ? upscaleLabel(job) : unavailable
    ?? (upscaled ? '2K video ready in the Upscaled tab. Upscaling again replaces it.' : 'Sends the complete render and its prompt to MiniMax H3-Regenerate-2K.');
  const recheck = !active && job?.phase === 'error' && !!job.requestId;
  return <div className="field interstitial-upscale">
    <div className="interstitial-upscale-actions">
      <button type="button" className="button full-width" aria-describedby={`${id}-status`} disabled={active || !!unavailable} onClick={() => void controller.upscale(item.id)}>
        <span className="status-icon">{active ? <span className="spinner"/> : <ImageUpscale size={14}/>}</span>
        {active ? `Upscaling to 2K${progress === undefined ? '…' : ` · ${Math.round(progress * 100)}%`}` : upscaled ? 'Upscale to 2K again' : 'Upscale to 2K'}
      </button>
      {/* One reserved slot: cancel while running, or check a failed job's result without paying again. */}
      <button type="button" className="icon-button small interstitial-upscale-secondary" data-visible={active || recheck} disabled={!active && !recheck}
        aria-label={active ? 'Cancel 2K upscale' : 'Check 2K result again'} title={active ? 'Cancel 2K upscale' : recheck ? 'Check the submitted 2K job again without starting a new one' : undefined}
        onClick={() => void (active ? controller.cancelUpscale(item.id) : controller.resumeUpscale(item.id))}>
        {active ? <X size={13}/> : <RotateCcw size={13}/>}
      </button>
    </div>
    <p id={`${id}-status`} className="hint interstitial-upscale-status" role="status" data-error={job?.phase === 'error' || undefined}>{status}</p>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import ContentIssues from '../../shared/ContentIssues';
import { downloadAsset } from './assetExports';
import type { LibraryAsset } from './types';
import './asset-volume.css';

export default function AssetDownload({ asset, label = 'Download' }: { asset: LibraryAsset; label?: string }) {
  const operation = useRef<AbortController | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setBusy(false); setError(''); return () => { operation.current?.abort(); operation.current = null; }; }, [asset.assetId]);
  const download = async () => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('');
    try {
      await downloadAsset(asset, controller.signal);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to export this asset.'); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  };
  return <span className="asset-download"><button type="button" className="text-button" aria-label={label} disabled={busy} aria-busy={busy} onClick={() => void download()}>
    <span className="status-icon">{busy ? <span className="spinner"/> : <Download size={12}/>}</span>Download
  </button><span className="asset-download-error"><ContentIssues label="Download errors" issues={error ? [{ key: 'download', title: 'Download failed', message: error }] : []}/></span></span>;
}

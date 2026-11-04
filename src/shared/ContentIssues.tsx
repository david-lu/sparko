import { CircleAlert, X } from 'lucide-react';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import './content-issues.css';

export type ContentIssue = { key: string; title: string; message: string; side?: 'start' | 'end' };

/** Always reserves its space. Details use the top layer, without moving nearby controls. */
export default function ContentIssues({ issues, label, className = '' }: { issues: ContentIssue[]; label: string; className?: string }) {
  const id = useId();
  return <span className={`content-issues ${className}`} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
    {!!issues.length && <>
      <button type="button" className="content-issue-button" aria-label={label} aria-haspopup="dialog" title={`${label}: ${issues[0].message}`} popoverTarget={id}><CircleAlert size={14} aria-hidden /></button>
      {createPortal(<div id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className="content-issues-popover" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
        <header><strong id={`${id}-title`}>{label}</strong><button type="button" className="icon-button small" aria-label="Close error details" popoverTarget={id} popoverTargetAction="hide"><X size={14} /></button></header>
        {issues.map(issue => <section key={issue.key}><strong>{issue.title}</strong><p>{issue.message}</p></section>)}
      </div>, document.body)}
    </>}
  </span>;
}

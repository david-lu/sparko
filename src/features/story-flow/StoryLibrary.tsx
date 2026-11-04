import { ChevronRight, Folder, FolderPlus, GripVertical, Image, Music, Plus, Search, Upload, Video } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { generationBusy, newAssetGeneration, type MediaKind } from '../../../shared/asset-generation';
import { isGenerating } from '../../../shared/interstitials';
import type { StoryEditor, LibrarySelection } from './useStoryEditor';
import { assets } from '../project/assets';
import { droppedFiles, fileEntries, type LibraryFile } from '../project/libraryFiles';
import type { LibraryAsset } from '../project/types';
import { LIBRARY_MOVE_TYPE, readLibraryMove, showLibraryDragImage, startLibraryDrag, type LibraryItem, type LibraryMoveSelection } from './libraryDrag';
import './library.css';
import ModalBackdrop from '../../shared/ModalBackdrop';
import { assetUsage } from '../project/assetUsage';
import AssetThumbnail from '../project/AssetThumbnail';
import LibraryContextMenu from './LibraryContextMenu';
import LibraryFolderDialog from './LibraryFolderDialog';
import { downloadAsset } from '../project/assetExports';
import { assetVolume } from '../project/assetVolume';

const folderDragType = 'application/x-sparko-folder';
type MenuTarget = LibrarySelection | { type: 'folder'; id: string } | { type: 'background'; folderId?: string };
type FolderDialog = { mode: 'create'; parentId?: string } | { mode: 'rename'; id: string; name: string };
export default function StoryLibrary({ editor }: { editor: StoryEditor }) {
  const input = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), menuTrigger = useRef<HTMLElement | null>(null), importDestination = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [folderId, setFolderId] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [dropping, setDropping] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null), [submenu, setSubmenu] = useState(false);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const folderTrigger = useRef<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState<LibrarySelection | null>(null);
  const [removing, setRemoving] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [dropFolder, setDropFolder] = useState<string>();
  const draggedFolder = useRef<string | undefined>(undefined), selectionAnchor = useRef<LibrarySelection | null>(null);
  const dragThumbnails = useRef<HTMLDivElement>(null);
  const project = editor.projects.getSnapshot().project, library = project?.library ?? [], folders = project?.libraryFolders ?? [], generations = project?.assetGenerations ?? [];
  const selected = editor.librarySelection;
  const selections = editor.librarySelections.filter(s => s.type === 'asset' ? library.some(a => a.assetId === s.id) : s.type === 'generation' ? generations.some(g => g.id === s.id) : false);
  const isSelected = (type: LibrarySelection['type'], id: string) => selections.some(s => s.type === type && s.id === id);
  const clearSelection = () => { editor.setSelected([]); editor.setSelectedEdge(null); editor.jobs.select(null); selectionAnchor.current = null; };
  const menuTarget = menu?.target;
  const menuAsset = menuTarget?.type === 'asset' ? library.find(a => a.assetId === menuTarget.id) : undefined;
  const menuGeneration = menuTarget?.type === 'generation' ? generations.find(g => g.id === menuTarget.id) : undefined;
  const menuFolder = menuTarget?.type === 'folder' ? folders.find(f => f.id === menuTarget.id) : undefined;
  const menuJob = menuTarget?.type === 'job' ? editor.items.find(i => i.id === menuTarget.id) : undefined;
  const menuOutput = menuAsset ?? library.find(a => a.assetId === menuGeneration?.selectedAssetId);
  const destination = menuFolder?.id ?? (menu?.target.type === 'background' ? menu.target.folderId : undefined);
  const deletedGeneration = generations.find(g => deleting?.type === 'generation' && g.id === deleting.id);
  const deletedAsset = library.find(a => deleting?.type === 'asset' && a.assetId === deleting.id);
  const deleteIds = deletedGeneration ? deletedGeneration.versions.map(v => v.assetId) : deletedAsset ? [deletedAsset.assetId] : [];
  const usages = project && deleting ? assetUsage({ ...project, assetGenerations: generations.filter(g => g.id !== deletedGeneration?.id) }, deleteIds) : [];
  const remove = async () => {
    if (!deleting || usages.length || removing) return;
    setRemoving(true);
    try {
      if (deletedGeneration && generationBusy(deletedGeneration)) {
        await editor.assetJobs.cancel(deletedGeneration.id);
        const current = editor.projects.getSnapshot().project?.assetGenerations?.find(g => g.id === deletedGeneration.id);
        if (current?.phase !== 'cancelled') { setDeleteError(current?.error || 'Unable to cancel this generation. Check its result before deleting.'); return; }
      }
      const current = editor.projects.getSnapshot().project;
      if (!current || current.id !== project?.id || assetUsage({ ...current, assetGenerations: current.assetGenerations?.filter(g => g.id !== deletedGeneration?.id) }, deleteIds).length) return;
      editor.projects.editAssets(p => ({ ...p, library: p.library?.filter(a => !deleteIds.includes(a.assetId)), assetGenerations: p.assetGenerations?.filter(g => g.id !== deletedGeneration?.id) }));
      editor.setSelected([]); setDeleting(null); setMessage('Asset deleted. Undo restores it.');
    } finally { setRemoving(false); }
  };
  useEffect(() => setDeleteError(''), [deleting]);
  useEffect(() => { setFolderId(undefined); setMessage(''); setDeleting(null); setMenu(null); setFolderDialog(null); importDestination.current = undefined; }, [project?.id]);
  useEffect(() => {
    const end = () => { setDropping(false); setDropFolder(undefined); draggedFolder.current = undefined; };
    end(); selectionAnchor.current = null;
    window.addEventListener('dragend', end, true); window.addEventListener('drop', end, true);
    return () => { window.removeEventListener('dragend', end, true); window.removeEventListener('drop', end, true); };
  }, [project?.id]);
  const importFiles = async (entries: LibraryFile[] | Promise<LibraryFile[]>, target?: string) => {
    if (busy) return; setBusy(true); setMessage('Reading files…');
    try { const added = await editor.projects.importAssets(await entries, target, setMessage); setMessage(`${added.length} assets imported`); if (added[0]) editor.selectLibrary({ type: 'asset', id: added[0].assetId }); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setBusy(false); }
  };
  const create = (kind: MediaKind, target: string | undefined) => {
    const generation = newAssetGeneration(kind, target);
    editor.projects.editAssets(p => ({ ...p, assetGenerations: [...p.assetGenerations ?? [], generation] }));
    editor.selectLibrary({ type: 'generation', id: generation.id }); setFolderId(target); setMenu(null);
    if (target) setCollapsed(old => new Set([...old].filter(id => id !== target)));
  };
  const openFolderDialog = (dialog: FolderDialog) => {
    folderTrigger.current = menu ? menuTrigger.current : document.activeElement as HTMLElement;
    setMenu(null); setFolderDialog(dialog);
  };
  const newFolder = (parentId: string | undefined) => openFolderDialog({ mode: 'create', parentId });
  const saveFolder = (name: string) => {
    if (!folderDialog) return;
    if (folderDialog.mode === 'rename') {
      editor.projects.editAssets(p => ({ ...p, libraryFolders: p.libraryFolders?.map(f => f.id === folderDialog.id ? { ...f, name } : f) }));
    } else {
      const folder = { id: crypto.randomUUID(), name, parentId: folderDialog.parentId };
      editor.projects.editAssets(p => ({ ...p, libraryFolders: [...p.libraryFolders ?? [], folder] })); setFolderId(folder.id);
      if (folder.parentId) setCollapsed(old => new Set([...old].filter(id => id !== folder.parentId)));
    }
    setFolderDialog(null);
  };
  const run = (action: () => void | Promise<unknown>) => { setMenu(null); void Promise.resolve().then(action).catch(e => setMessage(e instanceof Error ? e.message : 'Unable to complete this action.')); };
  const importFromMenu = (directory: boolean, target: string | undefined) => {
    importDestination.current = target; setMenu(null); (directory ? folderInput : input).current?.click();
  };
  const editImage = (asset: LibraryAsset) => {
    const draft = newAssetGeneration('image', asset.folderId); draft.name = `${asset.name} edit`.slice(0, 1000);
    draft.settings.references = [{ assetId: asset.assetId, name: asset.name, kind: 'image' }];
    editor.projects.editAssets(p => ({ ...p, assetGenerations: [...p.assetGenerations ?? [], draft] }));
    editor.selectLibrary({ type: 'generation', id: draft.id }); setFolderId(draft.folderId); setMenu(null);
  };
  const removeFolder = () => {
    if (!menuFolder) return;
    const { id, parentId } = menuFolder;
    editor.projects.editAssets(p => ({ ...p, libraryFolders: p.libraryFolders?.filter(f => f.id !== id).map(f => f.parentId === id ? { ...f, parentId } : f),
      library: p.library?.map(a => a.folderId === id ? { ...a, folderId: parentId } : a), assetGenerations: p.assetGenerations?.map(g => g.folderId === id ? { ...g, folderId: parentId } : g) }));
    setFolderId(parentId); setMenu(null); setMessage('Folder removed; its assets were kept. Undo restores it.');
  };
  const canMoveFolder = (id: string, target?: string) => {
    let parent = target; const seen = new Set<string>();
    while (parent) { if (parent === id || seen.has(parent)) return false; seen.add(parent); parent = folders.find(f => f.id === parent)?.parentId; }
    return true;
  };
  const moveToFolder = (data: DataTransfer, target?: string) => {
    const draggedFolder = data.getData(folderDragType);
    if (draggedFolder) {
      if (!canMoveFolder(draggedFolder, target)) { setMessage('A folder cannot contain itself.'); return; }
      editor.projects.editAssets(p => ({ ...p, libraryFolders: p.libraryFolders?.map(f => f.id === draggedFolder ? { ...f, parentId: target } : f) })); return;
    }
    const items = readLibraryMove(data), assetIds = new Set(items.filter(i => i.type === 'asset').map(i => i.id)), generationIds = new Set(items.filter(i => i.type === 'generation').map(i => i.id));
    if (!items.length) return;
    editor.projects.editAssets(p => ({ ...p, library: p.library?.map(a => assetIds.has(a.assetId) || a.generationId && generationIds.has(a.generationId) ? { ...a, folderId: target } : a),
      assetGenerations: p.assetGenerations?.map(g => generationIds.has(g.id) ? { ...g, folderId: target } : g) }));
    editor.selectLibrary(items);
    setFolderId(target);
    if (target) setCollapsed(old => new Set([...old].filter(id => id !== target)));
    setMessage(`${items.length} asset${items.length === 1 ? '' : 's'} moved to ${folders.find(f => f.id === target)?.name ?? 'the library root'}.`);
  };
  const drop = (event: DragEvent, target?: string) => {
    event.preventDefault(); event.stopPropagation(); setDropping(false); setDropFolder(undefined);
    if (event.dataTransfer.types.includes('Files')) void importFiles(droppedFiles(event.dataTransfer), target);
    else moveToFolder(event.dataTransfer, target);
  };
  const accepts = (event: DragEvent, target?: string, background = false) => {
    const types = event.dataTransfer.types, files = types.includes('Files');
    if (!types.some(t => ['Files', LIBRARY_MOVE_TYPE, folderDragType].includes(t))) return;
    event.preventDefault(); event.stopPropagation();
    const folder = draggedFolder.current || event.dataTransfer.getData(folderDragType);
    const allowed = files ? !busy : !folder || canMoveFolder(folder, target);
    event.dataTransfer.dropEffect = allowed ? files ? 'copy' : 'move' : 'none';
    setDropping(allowed && background); setDropFolder(allowed && !background ? target : undefined);
  };
  const leaveFolder = (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolder(undefined); };
  const matches = (name: string, kind: string) => name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === kind || filter === 'video' && kind === 'generated');
  const icon = (kind: string) => kind === 'image' ? <Image size={17}/> : kind === 'audio' ? <Music size={17}/> : <Video size={17}/>;
  const visibleSelections = (parent?: string, depth = 0): LibrarySelection[] => depth > 50 ? [] : [
    ...(!query && filter === 'all' ? folders.filter(f => f.parentId === parent && !collapsed.has(f.id)).flatMap(f => visibleSelections(f.id, depth + 1)) : []),
    ...library.filter(a => !a.generationId && (query || filter !== 'all' || a.folderId === parent) && matches(a.name, a.kind)).map(a => ({ type: 'asset' as const, id: a.assetId })),
    ...generations.filter(g => (query || filter !== 'all' || g.folderId === parent) && matches(g.name, g.kind)).map(g => ({ type: 'generation' as const, id: g.id })),
  ];
  const choose = (selection: LibrarySelection, event?: MouseEvent) => {
    setFolderId(selection.type === 'asset' ? library.find(a => a.assetId === selection.id)?.folderId : generations.find(g => g.id === selection.id)?.folderId);
    const same = (item: LibrarySelection, other: LibrarySelection | null) => item.type === other?.type && item.id === other.id;
    const additive = event?.metaKey || event?.ctrlKey;
    if (event?.shiftKey && selectionAnchor.current) {
      const visible = visibleSelections(), start = visible.findIndex(s => same(s, selectionAnchor.current)), end = visible.findIndex(s => same(s, selection));
      if (start >= 0 && end >= 0) {
        const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1), next = additive ? [...selections.filter(s => !range.some(r => same(s, r))), ...range] : range;
        editor.selectLibrary([...next.filter(s => !same(s, selection)), selection]); return;
      }
    }
    selectionAnchor.current = selection;
    editor.selectLibrary(additive ? isSelected(selection.type, selection.id) ? selections.filter(s => !same(s, selection)) : [...selections, selection] : selection);
  };
  const startAssetDrag = (event: DragEvent, selection: LibraryMoveSelection, payload: LibraryItem) => {
    const items = isSelected(selection.type, selection.id) ? selections.filter((s): s is LibraryMoveSelection => s.type !== 'job') : [selection];
    // Keep the Inspector's current reference inputs available while dragging an unselected asset.
    startLibraryDrag(event, payload, items, items.length > 1 ? [...dragThumbnails.current?.children ?? []] : undefined);
  };
  const selectUnused = (target?: string) => {
    if (!project) return;
    const scope = new Set<string>(target ? [target] : []);
    for (let i = 0; i < folders.length; i++) for (const f of folders) if (!target || f.parentId && scope.has(f.parentId)) scope.add(f.id);
    const inside = (id?: string) => !target || !!id && scope.has(id);
    const unused: LibrarySelection[] = [
      ...library.filter(a => !a.generationId && inside(a.folderId) && !assetUsage(project, [a.assetId]).length).map(a => ({ type: 'asset' as const, id: a.assetId })),
      ...generations.filter(g => inside(g.folderId) && !assetUsage({ ...project, assetGenerations: generations.filter(other => other.id !== g.id) }, g.versions.map(v => v.assetId)).length).map(g => ({ type: 'generation' as const, id: g.id })),
    ];
    editor.selectLibrary(unused); selectionAnchor.current = unused[0] ?? null; setFolderId(target); setQuery(''); setFilter('all');
    setCollapsed(old => new Set([...old].filter(id => !scope.has(id)))); setMenu(null);
    setMessage(`${unused.length} unused asset${unused.length === 1 ? '' : 's'} selected.`);
  };
  const selectJob = (id: string) => { const node = editor.graph?.nodes.find(n => n.interstitialId === id); if (node) editor.select(node.id, null); else editor.selectLibrary({ type: 'job', id }); };
  const openMenu = (target: MenuTarget, trigger: HTMLElement, x: number, y: number) => {
    if (target.type === 'folder') { clearSelection(); setFolderId(target.id); }
    else if (target.type === 'background') clearSelection();
    else if (target.type === 'job') selectJob(target.id);
    else choose(target);
    menuTrigger.current = trigger; setMenu({ x, y, target }); setSubmenu(false);
  };
  const contextMenu = (event: MouseEvent<HTMLElement>, target: MenuTarget) => {
    event.preventDefault(); event.stopPropagation();
    const r = event.currentTarget.getBoundingClientRect();
    openMenu(target, event.currentTarget, Number.isFinite(event.clientX) && event.clientX ? event.clientX : r.left + 8, Number.isFinite(event.clientY) && event.clientY ? event.clientY : r.top + 8);
  };
  const row = (a: LibraryAsset, depth: number) => <button key={a.assetId} style={{ paddingLeft: depth * 12 + 6 }} className={isSelected('asset', a.assetId) ? 'selected' : ''}
    aria-label={`Library asset ${a.name}`} aria-pressed={isSelected('asset', a.assetId)} data-asset-id={a.assetId} data-library-type="asset" data-library-id={a.assetId} draggable
    onClick={e => choose({ type: 'asset', id: a.assetId }, e)} onDoubleClick={() => { if (a.kind === 'video' || a.kind === 'generated') void editor.addAsset(a.assetId); }}
    onContextMenu={e => contextMenu(e, { type: 'asset', id: a.assetId })}
    onDragStart={e => startAssetDrag(e, { type: 'asset', id: a.assetId }, { assetId: a.assetId })}>
    <AssetThumbnail asset={a} kind={a.kind} name={a.name}/>
    <span className="library-asset-name"><strong>{a.name}</strong><small>{a.kind === 'generated' ? 'Video · Generated' : a.kind}{a.duration ? ` · ${a.duration.toFixed(1)}s` : ''} · {project && assetUsage(project, [a.assetId]).length ? 'Used' : 'Unused'}</small></span><GripVertical size={12}/>
  </button>;
  const tree = (parent?: string, depth = 0): ReactNode => depth > 50 ? null : <>
    {!query && filter === 'all' && folders.filter(f => f.parentId === parent).map(f => <div key={f.id}>
      <button className={`library-folder ${folderId === f.id ? 'selected' : ''} ${dropFolder === f.id ? 'is-drop-target' : ''}`} style={{ paddingLeft: depth * 12 + 4 }} aria-label={`Folder ${f.name}`} aria-expanded={!collapsed.has(f.id)} data-library-type="folder" data-library-id={f.id} draggable
        onClick={() => { clearSelection(); setFolderId(f.id); setCollapsed(old => { const next = new Set(old); next.has(f.id) ? next.delete(f.id) : next.add(f.id); return next; }); }}
        onDragStart={e => { e.stopPropagation(); draggedFolder.current = f.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(folderDragType, f.id); showLibraryDragImage(e); }} onDragEnter={e => accepts(e, f.id)} onDragOver={e => accepts(e, f.id)} onDragLeave={leaveFolder} onDrop={e => drop(e, f.id)}
        onContextMenu={e => contextMenu(e, { type: 'folder', id: f.id })}>
        <ChevronRight size={12} style={{ transform: collapsed.has(f.id) ? '' : 'rotate(90deg)' }}/><Folder size={15}/><span>{f.name}</span>
      </button>{!collapsed.has(f.id) && tree(f.id, depth + 1)}
    </div>)}
    {library.filter(a => !a.generationId && (query || filter !== 'all' || a.folderId === parent) && matches(a.name, a.kind)).map(a => row(a, depth))}
    {generations.filter(g => (query || filter !== 'all' || g.folderId === parent) && matches(g.name, g.kind)).map(g => <button key={g.id} style={{ paddingLeft: depth * 12 + 6 }}
      className={isSelected('generation', g.id) ? 'selected' : ''} aria-label={`Library generation ${g.name}`} aria-pressed={isSelected('generation', g.id)}
      data-library-type="generation" data-library-id={g.id} draggable onDragStart={e => startAssetDrag(e, { type: 'generation', id: g.id }, { generationId: g.id, ...(g.selectedAssetId ? { assetId: g.selectedAssetId } : {}) })} onContextMenu={e => contextMenu(e, { type: 'generation', id: g.id })} onClick={e => choose({ type: 'generation', id: g.id }, e)}>
      <AssetThumbnail asset={library.find(a => a.assetId === g.selectedAssetId)} kind={g.kind} name={g.name}/>
      <span className="library-asset-name"><strong>{g.name}</strong><small>{g.kind} · {generationBusy(g) ? g.phase === 'queued' ? 'Queued' : 'Generating…' : g.phase}</small></span>{generationBusy(g) ? <span className="spinner"/> : <GripVertical size={12}/>}
    </button>)}
    {!parent && editor.items.filter(isGenerating).filter(i => matches(i.label, 'video')).map(i => <button key={i.id} aria-label={`Generating video ${i.label}`} data-library-type="job" data-library-id={i.id} onClick={() => selectJob(i.id)} onContextMenu={e => contextMenu(e, { type: 'job', id: i.id })}>
      <AssetThumbnail asset={library.find(a => a.assetId === (i.previousResult ?? i.result)?.assetId)} kind="video" name={i.label}/><span className="library-asset-name"><strong>{i.label}</strong><small>Video · {i.phase}</small></span><span className="spinner"/></button>)}
  </>;
  return <section className={`story-library asset-library ${dropping ? 'is-dropping' : ''}`} aria-label="Asset library" tabIndex={0}
    onClick={e => { if (!(e.target as HTMLElement).closest('button,input,select,textarea,a,label,dialog,[role="menu"]')) { setFolderId(undefined); clearSelection(); } }}
    onKeyDown={e => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,dialog,[role="menu"]')) return;
      if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') {
        e.preventDefault(); e.stopPropagation(); const row = target.closest<HTMLElement>('[data-library-type]'), trigger = row ?? e.currentTarget, r = trigger.getBoundingClientRect();
        openMenu(row ? { type: row.dataset.libraryType, id: row.dataset.libraryId } as MenuTarget : { type: 'background' }, trigger, r.left + 8, r.top + 8);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selections.length === 1 && selected && selected.type !== 'job') { e.preventDefault(); e.stopPropagation(); setDeleting(selected); }
    }}
    onDragOver={e => accepts(e, undefined, true)} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropping(false); setDropFolder(undefined); } }} onDrop={e => drop(e, undefined)}
    onContextMenu={e => { if (!(e.target as HTMLElement).closest('button,input,select,textarea,label,dialog,[role="menu"]')) contextMenu(e, { type: 'background' }); }}>
    <div className="library-toolbar"><label className="library-search"><Search size={13}/><input aria-label="Search library" placeholder="Search assets" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <button className="icon-button" aria-label="Import assets" disabled={busy} onClick={() => importFromMenu(false, folderId)}>{busy ? <span className="spinner"/> : <Upload size={15}/>}</button>
      <button className="icon-button" aria-label="New folder" onClick={() => newFolder(folderId)}><FolderPlus size={15}/></button>
      <button className="icon-button" aria-label="Library menu" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); openMenu({ type: 'background', folderId }, e.currentTarget, r.left, r.bottom); }}><Plus size={15}/></button>
    </div>
    <input ref={input} hidden multiple type="file" accept="image/*,video/*,audio/*,.mkv" aria-label="Import library assets" onChange={e => { void importFiles(fileEntries([...e.target.files ?? []]), importDestination.current); e.target.value = ''; }}/>
    <input ref={folderInput} hidden multiple type="file" {...{ webkitdirectory: '' }} aria-label="Import library folder" onChange={e => { void importFiles(fileEntries([...e.target.files ?? []]), importDestination.current); e.target.value = ''; }}/>
    <select className="library-filter" aria-label="Library category" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All assets</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option></select>
    <div className="library-items library-media">{tree()}{!library.length && !generations.length && !folders.length && <p className="hint">Drop media here or create a generation.</p>}</div>
    <div className="library-feedback" role="status" title={message}>{message}</div>
    <p className="library-footer">{selections.length > 1 ? `${selections.length} assets selected · Drag to move` : `Drop files or folders here · ${library.filter(a => !a.generationId).length + generations.length} assets`}</p>
    <div hidden aria-hidden="true" ref={dragThumbnails} data-library-drag-sources>
      {selections.length > 1 && selections.slice(0, 4).map(selection => {
        const generation = selection.type === 'generation' ? generations.find(g => g.id === selection.id) : undefined;
        const asset = library.find(a => a.assetId === (generation ? generation.selectedAssetId : selection.id));
        return <AssetThumbnail key={`${selection.type}:${selection.id}`} asset={asset} kind={generation?.kind ?? asset?.kind ?? 'image'} name={generation?.name ?? asset?.name ?? ''} eager/>;
      })}
    </div>
    {menu && <LibraryContextMenu x={menu.x} y={menu.y} label={menu.target.type === 'background' ? 'Library actions' : menuFolder ? 'Folder actions' : menuJob ? 'Video generation actions' : menuGeneration ? 'Generation actions' : 'Asset actions'}
      onClose={() => setMenu(null)} restoreFocus={() => { const trigger = menuTrigger.current?.isConnected ? menuTrigger.current : input.current?.closest<HTMLElement>('.asset-library'); trigger?.focus({ preventScroll: true }); }}>
      {menu.target.type === 'background' && <>
        <button role="menuitem" disabled={busy} onClick={() => importFromMenu(false, destination)}>Import files…</button>
        <button role="menuitem" disabled={busy} onClick={() => importFromMenu(true, destination)}>Import folder…</button>
        <button role="menuitem" onClick={() => newFolder(destination)}>New folder</button>
        <button role="menuitem" onClick={() => selectUnused(destination)}>Select unused assets</button>
        <div role="separator"/>
        <button role="menuitem" aria-haspopup="menu" aria-expanded={submenu} onClick={() => setSubmenu(!submenu)} onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); const button = e.currentTarget; setSubmenu(true); requestAnimationFrame(() => button.parentElement?.querySelector<HTMLButtonElement>('[role=menu] button')?.focus()); } }}>Create generation <ChevronRight size={14}/></button>
        {submenu && <div role="menu" aria-label="Create generation" onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); (e.currentTarget.previousElementSibling as HTMLElement)?.focus(); setSubmenu(false); } }}>{(['image', 'video', 'audio'] as const).map(kind => <button key={kind} role="menuitem" onClick={() => create(kind, destination)}>{icon(kind)}{kind[0].toUpperCase() + kind.slice(1)}</button>)}</div>}
      </>}
      {menuFolder && <>
        <button role="menuitem" onClick={() => { setCollapsed(old => { const next = new Set(old); next.has(menuFolder.id) ? next.delete(menuFolder.id) : next.add(menuFolder.id); return next; }); setMenu(null); }}>{collapsed.has(menuFolder.id) ? 'Expand folder' : 'Collapse folder'}</button>
        <button role="menuitem" onClick={() => openFolderDialog({ mode: 'rename', id: menuFolder.id, name: menuFolder.name })}>Rename folder…</button>
        <div role="separator"/>
        <button role="menuitem" onClick={() => newFolder(menuFolder.id)}>New subfolder</button>
        <button role="menuitem" disabled={busy} onClick={() => importFromMenu(false, menuFolder.id)}>Import files here…</button>
        <button role="menuitem" disabled={busy} onClick={() => importFromMenu(true, menuFolder.id)}>Import folder here…</button>
        <button role="menuitem" onClick={() => selectUnused(menuFolder.id)}>Select unused assets</button>
        <div role="separator"/><button role="menuitem" onClick={removeFolder}>Remove folder (keep assets)</button>
      </>}
      {(menuAsset || menuGeneration) && <>
        <button role="menuitem" onClick={() => { if (menu.target.type === 'asset' || menu.target.type === 'generation') choose(menu.target); setMenu(null); }}>Open in Inspector</button>
        {menuOutput && <>
          {(menuOutput.kind === 'video' || menuOutput.kind === 'generated') && <button role="menuitem" onClick={() => run(() => editor.addAsset(menuOutput.assetId))}>Add to timeline</button>}
          {menuOutput.kind === 'image' && <button role="menuitem" onClick={() => editImage(menuGeneration ? { ...menuOutput, folderId: menuGeneration.folderId } : menuOutput)}>Edit image</button>}
          <button role="menuitem" onClick={() => run(() => downloadAsset({ ...menuOutput, volume: assetVolume(library, menuOutput.assetId) }))}>Download{menuGeneration ? ' selected version' : ''}</button>
        </>}
        {menuGeneration && generationBusy(menuGeneration) && <button role="menuitem" onClick={() => run(() => editor.assetJobs.cancel(menuGeneration.id))}>Cancel generation</button>}
        {menuGeneration?.requestId && ['error', 'cancelled'].includes(menuGeneration.phase) && <button role="menuitem" onClick={() => run(() => editor.assetJobs.resume(menuGeneration.id))}>Check result</button>}
        <div role="separator"/>
        <button role="menuitem" onClick={() => {
          const name = window.prompt(menuGeneration ? 'Rename generation' : 'Rename asset', menuGeneration?.name ?? menuAsset?.name)?.trim();
          if (name) { if (menuGeneration) editor.assetJobs.edit(menuGeneration.id, { name: name.slice(0, 1000) }); else if (menuAsset) editor.projects.editAssets(p => ({ ...p, library: p.library?.map(a => a.assetId === menuAsset.assetId ? { ...a, name: name.slice(0, 1000) } : a) })); }
          setMenu(null);
        }}>{menuGeneration ? 'Rename generation…' : 'Rename asset…'}</button>
        <button role="menuitem" onClick={() => { if (menu.target.type === 'asset' || menu.target.type === 'generation') setDeleting(menu.target); setMenu(null); }}>{menuGeneration ? 'Delete generation…' : 'Delete asset…'}</button>
      </>}
      {menuJob && <>
        <button role="menuitem" onClick={() => { selectJob(menuJob.id); setMenu(null); }}>Open in Inspector</button>
        {isGenerating(menuJob) && <button role="menuitem" onClick={() => run(() => editor.jobs.cancel(menuJob.id))}>Cancel generation</button>}
      </>}
    </LibraryContextMenu>}
    {folderDialog && <LibraryFolderDialog initialName={folderDialog.mode === 'rename' ? folderDialog.name : undefined} onSubmit={saveFolder} onCancel={() => setFolderDialog(null)}
      restoreFocus={() => { const trigger = folderTrigger.current?.isConnected ? folderTrigger.current : input.current?.closest<HTMLElement>('.asset-library'); trigger?.focus({ preventScroll: true }); }}/>}
    {deleting && <ModalBackdrop labelledBy="delete-asset-title" onCancel={() => setDeleting(null)}><div className="project-card asset-delete-dialog"><h2 id="delete-asset-title">Delete {deletedGeneration?.name ?? deletedAsset?.name ?? 'asset'}?</h2>
      {usages.length ? <><p>This asset is being used. Remove or replace these uses before deleting it:</p><ul>{usages.map((use, i) => <li key={i}><strong>{use.owner}</strong> — {use.role}</li>)}</ul></> : <p>This removes the asset from this project. Undo can restore it.</p>}
      <div className="library-feedback" role="status">{deleteError}</div>
      <div className="close-project-actions"><button className="button" autoFocus disabled={removing} onClick={() => setDeleting(null)}>{usages.length ? 'Keep asset' : 'Cancel'}</button><button className="button danger" style={{ minWidth: 110 }} disabled={!!usages.length || removing} onClick={() => void remove()}>{removing ? 'Deleting…' : 'Delete asset'}</button></div>
    </div></ModalBackdrop>}
  </section>;
}

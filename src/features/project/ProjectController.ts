import type { MediaInfo, MediaSource } from '../../media/media';
import { MediaEngine } from '../../media/MediaEngine';
import { canPlaySourceVideo, prepareSourceVideo } from '../../media/prepareVideo';
import type { InterstitialController } from '../interstitials/InterstitialController';
import { assets } from './assets';
import { clearActiveProject, deleteSavedProject, forgetRecentFile, listRecentFiles, listSavedProjects, readActiveProject, readAsset, readProject, rememberRecentFile, storageError, writeProject, type RecentFile } from './database';
import { activeFlows, projectFlows, withFlows, assetIds, emptyAnalysis, type AnalysisState, type Asset, type Project } from './types';
import { TIMELINE_FPS } from '../../../shared/constants';
import { maxCrossfadeFrames, savedCrossfadeFrames } from '../player/preferences';
import { groupCallResponse, lockCallResponseStructure, migrateDefaultAnswerLabels, removeAnswer, responseInterstitialIds, type CallResponseFlow } from '../call-response/model';
import { createCallResponseDraft } from '../call-response/draft';
import { frameTime, type Interstitial } from '../../../shared/interstitials';
import { ProjectHistory } from './ProjectHistory';
// Open/save must remain available in an already-open tab after a deployment
// removes old hashed chunks. Load archive support with the application.
import { packProject, unpackProject } from './archive';
import { freshId, migrateFades, migrateGraph, removeNodes, type StoryGraph, type StoryNode } from '../story-flow/model';
import { collectLibrary } from './library';

type State = { project: Project | null; source: MediaSource | null; subtitle: { name: string; url: string } | null;
  busy: boolean; message: string; progress: number | null; error: string | null;
  undoLabel: string | null; redoLabel: string | null; historyRevision: number; activationRevision: number;
  savedProjects: { id: string; name: string; updatedAt: number }[]; savedProjectId: string | null;
  recentFiles: RecentFile[]; fileName: string | null; dirty: boolean };

/** Owns project persistence and portable snapshots; media and job controllers stay independent. */
export class ProjectController {
  private storyDuration=0;
  initializeStoryFlow(duration:number) {
    const project=this.state.project;if(!project?.source.assetId)return;
    this.storyDuration=duration;
    const graph=migrateGraph(project,duration);
    this.interstitials.setStoryGraph(graph,project.source.assetId,duration);
    if(!project.storyFlow || JSON.stringify(project.storyFlow)!==JSON.stringify(graph)){
      this.switching=true;
      try { this.interstitials.setCallResponses([]); this.save({...project,storyFlow:graph,callResponse:undefined,callResponses:undefined},false); }
      finally{this.switching=false;}
    }
    else if (!project.library?.find(item => item.assetId === project.source.assetId)?.duration) this.save(project, false);
  }
  updateStoryFlow(graph:StoryGraph,added:Interstitial[]=[]) {
    const project=this.state.project;if(!project||this.operation)return;
    this.switching=true;
    try {
      added.forEach(item=>this.interstitials.ensureItem(item));
      for(const node of graph.nodes)if(node.interstitialId)this.interstitials.rename(node.interstitialId,node.name);
      this.interstitials.setStoryGraph(graph,project.source.assetId,this.storyDuration);
      this.save({...project,storyFlow:graph,callResponse:undefined,callResponses:undefined,interstitials:this.interstitials.getSnapshot().items,updatedAt:Date.now()});
    } finally{this.switching=false;}
  }
  async removeStoryNodes(ids:string[]) {
    const project=this.state.project,graph=project?.storyFlow;if(!project||!graph)return;
    const next=removeNodes(graph,ids);if(next===graph)return;
    return this.task('Removing clips',async signal=>{
      this.switching=true;
      try {
        const itemIds=graph.nodes.filter(n=>ids.includes(n.id)).flatMap(n=>n.interstitialId?[n.interstitialId]:[]);
        if(!await this.interstitials.removeMany(itemIds,signal))throw new Error('A running generation could not be cancelled. Try removing the clip again.');
        this.interstitials.setStoryGraph(next,project.source.assetId!,this.storyDuration);
        this.save({...project,storyFlow:next,interstitials:this.interstitials.getSnapshot().items,updatedAt:Date.now()});
      }finally{this.switching=false;}
    });
  }
  async importVideos(files:File[],position?:{x:number;y:number}) {
    const initial=this.state.project;if(!initial?.storyFlow||!files.length)return;
    return this.task('Importing videos',async signal=>{
      if(initial.storyFlow!.nodes.length+files.length>1000)throw new Error('A project can contain up to 1,000 clips.');
      const pending:Asset[]=[],nodes:StoryNode[]=[];
      for(const [index,file] of files.entries()){
        if(!file.type.startsWith('video/')&&!/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name))throw new Error('Drop video files onto the timeline.');
        signal.throwIfAborted();this.update({message:`Importing ${file.name} (${index+1}/${files.length})`,progress:index/files.length});
        const blob=await prepareSourceVideo(file,signal,progress=>this.update({message:`Preparing ${file.name}`,progress:(index+progress)/files.length}));
        const info=await this.validateVideo(blob,signal),asset:Asset={id:freshId(),name:file.name,blob};pending.push(asset);
        let originalAssetId:string|undefined;if(blob!==file){originalAssetId=freshId();pending.push({id:originalAssetId,name:file.name,blob:file});}
        nodes.push({id:freshId(),name:file.name,kind:'source',source:{assetId:asset.id,originalAssetId,duration:info.duration,inFrame:0,outFrame:Math.max(1,Math.floor(info.duration*TIMELINE_FPS))},x:0,y:0,crossfadeStart:0,crossfadeEnd:0,loopCount:0});
      }
      signal.throwIfAborted();const current=this.state.project!;
      const graph=current.storyFlow!,origin=position??{x:40,y:Math.max(90,...graph.nodes.map(n=>n.y))+145};
      nodes.forEach((node,index)=>{node.x=origin.x;node.y=origin.y+index*145;});
      const next:StoryGraph={...graph,entryId:graph.entryId||nodes[0].id,nodes:[...graph.nodes,...nodes]};
      const firstSource=!current.source.assetId?nodes[0]:undefined;
      const project={...current,storyFlow:next,source:firstSource?{name:firstSource.name,assetId:firstSource.source!.assetId,originalAssetId:firstSource.source!.originalAssetId}:current.source,updatedAt:Date.now()};
      await this.writes;signal.throwIfAborted();
      await writeProject(project,pending,false,signal);
      await Promise.all(nodes.map(node=>assets.open(node.source!.assetId)));
      signal.throwIfAborted();
      if(firstSource){this.storyDuration=firstSource.source!.duration!;this.update({source:await this.openSource(project)});}
      this.interstitials.setStoryGraph(next,project.source.assetId,this.storyDuration);
      this.save(project);return nodes.map(node=>node.id);
    });
  }
  private state: State = { project: null, source: null, subtitle: null, busy: false, message: '', progress: null, error: null,
    undoLabel: null, redoLabel: null, historyRevision: 0, activationRevision: 0, savedProjects: [], savedProjectId: null,
    recentFiles: [], fileName: null, dirty: false };
  private fileHandle: FileSystemFileHandle | null = null;
  private revision = 0;
  private draftId = (() => {
    try {
      const existing = localStorage.getItem('sparko:draft-id');
      if (existing?.startsWith('draft:')) return existing;
      const id = `draft:${crypto.randomUUID()}`; localStorage.setItem('sparko:draft-id', id); return id;
    } catch { return `draft:${crypto.randomUUID()}`; }
  })();
  private history = new ProjectHistory();
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private switching = false;
  private writes: Promise<void> = Promise.resolve();
  private operation: AbortController | null = null;
  constructor(private interstitials: InterstitialController) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  clearError() { this.update({ error: null }); }
  private save(project: Project, record = true) {
    project = { ...project, library: collectLibrary(project, this.storyDuration || undefined) };
    if (record && this.state.project?.id === project.id) this.history.record(this.state.project, project);
    this.revision++;
    this.update({ project, dirty: this.state.dirty || record, undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel });
    this.writes = this.writes.catch(() => undefined).then(() => writeProject(project));
    void this.writes.catch(error => this.update({ error: storageError(error) }));
  }
  async init(defaultSource: MediaSource) {
    this.unsubscribe ??= this.interstitials.subscribe(() => {
      const project = this.state.project;
      if (!project || this.switching || project.interstitials === this.interstitials.getSnapshot().items) return;
      this.save({ ...project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() });
    });
    await this.task('Loading projects', async signal => {
      const active = await readActiveProject();
      for (const id of [defaultSource.id, 'default:episode_mock.mp4']) {
        const previous = await readProject(id);
        if (previous && previous.saved === undefined) {
          if (previous.interstitials.length || projectFlows(previous).length || previous.subtitle || previous.analysis.result || previous.analysis.instructions)
            await writeProject({ ...previous, id: `project:${crypto.randomUUID()}`, saved: true, updatedAt: Date.now() });
          await writeProject({ ...previous, saved: false });
        }
      }
      if (active && active.id !== defaultSource.id && active.id !== 'default:episode_mock.mp4' && active.saved === undefined && !active.id.startsWith('draft:'))
        await writeProject({ ...active, saved: true });
      signal.throwIfAborted();
      this.update({ savedProjects: await listSavedProjects(), recentFiles: await listRecentFiles() });
    });
  }
  private async activate(project: Project, signal: AbortSignal, pendingAssets: Asset[] = [], savedProjectId: string | null = null, workingId = this.draftId) {
    signal.throwIfAborted();
    this.storyDuration = 0;
    project = { ...project, id: workingId, saved: false, crossfadeFrames: project.crossfadeFrames ?? savedCrossfadeFrames(),storyFlow:project.storyFlow?migrateFades(project.storyFlow):undefined };
    const renamedClips = new Map<string, { before: string; after: string }>();
    if (projectFlows(project).length) project = withFlows(project, projectFlows(project).map(flow => {
      const grouped = migrateDefaultAnswerLabels(groupCallResponse(flow));
      for (const scene of grouped.scenes) {
        const previous = flow.scenes.find(previous => previous.id === scene.id);
        if (scene.interstitialId && previous && previous.label !== scene.label) renamedClips.set(scene.interstitialId, { before: previous.label, after: scene.label });
      }
      if (!flow.interstitial) grouped.interstitial.time = project.interstitials.find(item => grouped.scenes.some(scene => scene.interstitialId === item.id))?.time ?? grouped.interstitial.time;
      return grouped;
    }));
    project = { ...project, interstitials: project.interstitials.map(item => {
      const rename = renamedClips.get(item.id);
      return rename && item.label === rename.before ? { ...item, label: rename.after } : item;
    }) };
    ({ project, pendingAssets } = await this.prepareSource(project, pendingAssets, signal));
    ({ project, pendingAssets } = await this.prepareGraphSources(project,pendingAssets,signal));
    await this.prepareGenerated(project, pendingAssets, signal);
    project = { ...project, interstitials: project.interstitials.map(item => ({ ...item, groupId: projectFlows(project).find(flow => flow.scenes.some(scene => scene.interstitialId === item.id))?.interstitial.id, phase: ['preparing', 'uploading'].includes(item.phase) ? 'draft' : item.phase })) };
    this.update({ message: 'Saving prepared project', progress: null });
    await this.writes;
    await writeProject(project, pendingAssets, true, signal);
    await Promise.all((project.library ?? []).map(item => assets.open(item.assetId)));
    const source=await this.openSource(project);
    const subtitle = project.subtitle ? { name: project.subtitle.name, url: (await assets.open(project.subtitle.assetId)).url } : null;
    // Restore retained renders before publishing the timeline, including failed/cancelled retries.
    await Promise.all([...new Set([...project.storyFlow?.nodes.flatMap(n=>n.source?[n.source.assetId]:[])??[],...project.storyFlow?.templates.flatMap(t=>t.nodes.flatMap(n=>n.source?[n.source.assetId]:[]))??[],...project.interstitials.flatMap(item => [item.previousResult?.assetId, item.previousResult?.fullAssetId, item.result?.assetId, item.result?.fullAssetId]), ...projectFlows(project).flatMap(flow => flow.scenes.map(scene => scene.clip.assetId))]
      .filter((id): id is string => !!id))].map(id => assets.open(id)));
    signal.throwIfAborted();
    this.switching = true;
    this.revision = 0;
    this.history.clear();
    this.fileHandle = null;
    this.update({ project, source, subtitle, error: null, dirty: false, undoLabel: null, redoLabel: null,
      savedProjectId, fileName: null, historyRevision: this.state.historyRevision + 1,activationRevision:this.state.activationRevision+1 });
    this.interstitials.load(project.id, project.interstitials, project.callResponse ? responseInterstitialIds(project.callResponse) : [], projectFlows(project));
    this.interstitials.setCallResponses(activeFlows(project));
    this.interstitials.setStoryGraph(project.storyFlow,project.source.assetId,this.storyDuration);
    assets.releaseExcept(new Set(assetIds(project)));
    this.switching = false;
    this.save({ ...project, interstitials: this.interstitials.getSnapshot().items }, false);
  }
  private async prepareSource(project: Project, pendingAssets: Asset[], signal: AbortSignal) {
    if(project.storyFlow&&!project.source.assetId&&!project.source.url)return {project,pendingAssets};
    const previousSourceId = project.source.assetId;
    let original = pendingAssets.find(asset => asset.id === project.source.assetId);
    if (!original && project.source.assetId) {
      original = await readAsset(project.source.assetId);
      if (!original) throw new Error('The source video is missing from local storage.');
    }
    if (!original) {
      if (!project.source.url) throw new Error('The source video cannot be located.');
      this.update({ message: 'Downloading source video', progress: null });
      original = await assets.fetch(project.source.url, project.source.name, signal, (received, total) => {
        if (!signal.aborted) this.update({ progress: total ? received / total : null });
      });
      pendingAssets = [...pendingAssets, original];
    }
    this.update({ message: 'Checking video playback', progress: null });
    let restoredOriginal = false;
    if (project.source.originalAssetId && project.source.originalAssetId !== original.id) {
      const retained = pendingAssets.find(asset => asset.id === project.source.originalAssetId) ?? await readAsset(project.source.originalAssetId);
      const playable = retained && await canPlaySourceVideo(retained.blob, signal).catch(() => { signal.throwIfAborted(); return false; });
      if (retained && playable) { original = retained; restoredOriginal = true; }
    }
    const blob = restoredOriginal ? original.blob : await prepareSourceVideo(original.blob, signal, progress => {
      if (!signal.aborted) this.update({ message: 'Preparing 24 fps video', progress });
    });
    signal.throwIfAborted();
    let working = original;
    if (blob !== original.blob) {
      working = { id: crypto.randomUUID(), name: `${project.source.name.replace(/\.[^.]+$/, '')}.24fps.mp4`, blob };
      pendingAssets = [...pendingAssets, working];
    }
    if (working.id !== previousSourceId) project = withFlows(project, projectFlows(project).map(flow => ({ ...flow, scenes: flow.scenes.map(scene => scene.clip.assetId === previousSourceId
      ? { ...scene, clip: { ...scene.clip, assetId: working.id } } : scene) })));
    if(working.id!==previousSourceId&&project.storyFlow)project={...project,storyFlow:{...project.storyFlow,nodes:project.storyFlow.nodes.map(n=>n.source&&n.source.assetId===previousSourceId?{...n,source:{...n.source,assetId:working.id}}:n),templates:project.storyFlow.templates.map(t=>({...t,nodes:t.nodes.map(n=>n.source&&n.source.assetId===previousSourceId?{...n,source:{...n.source,assetId:working.id}}:n)}))}};
    if (working.id !== previousSourceId) project = { ...project, library: project.library?.map(item => item.assetId === previousSourceId ? { ...item, assetId: working.id } : item) };
    return { project: { ...project, source: { ...project.source, assetId: working.id,
      originalAssetId: restoredOriginal ? undefined : project.source.originalAssetId ?? (working !== original ? original.id : undefined) }, updatedAt: Date.now() }, pendingAssets };
  }
  private async prepareGenerated(project: Project, pendingAssets: Asset[], signal: AbortSignal) {
    const generated = [...new Set([...(project.library ?? []).filter(item => item.kind === 'generated').map(item => item.assetId), ...project.interstitials.flatMap(item => [item.result?.assetId, item.result?.fullAssetId, item.previousResult?.assetId, item.previousResult?.fullAssetId]),
      ...projectFlows(project).flatMap(flow => flow.scenes.filter(scene => !scene.draft).map(scene => scene.clip.assetId))])]
      .filter((id): id is string => !!id && id !== project.source.assetId && id !== project.source.originalAssetId);
    if (!generated.length) return;
    const get = async (id: string) => pendingAssets.find(asset => asset.id === id) ?? await readAsset(id);
    // The canvas samples each asset's timestamps and scales it to the source
    // dimensions. Import validates decoding without encoding another copy.
    for (const [index, id] of generated.entries()) {
      signal.throwIfAborted();
      const asset = await get(id); if (!asset) throw new Error('An interstitial video is missing.');
      this.update({ message: `Checking interstitial ${index + 1} of ${generated.length}`, progress: index / generated.length });
      if (!await canPlaySourceVideo(asset.blob, signal)) throw new Error(`This browser cannot decode ${asset.name}.`);
    }
    signal.throwIfAborted();
  }
  private async prepareGraphSources(project:Project,pendingAssets:Asset[],signal:AbortSignal){
    let graph=project.storyFlow;if(!graph)return {project,pendingAssets};
    const ids=[...new Set([...graph.nodes.flatMap(node=>node.source?[node.source.assetId]:[]), ...(project.library ?? []).filter(item => item.kind === 'video').map(item => item.assetId)])].filter(id => id !== project.source.assetId);
    for(const [index,id] of ids.entries()){
      signal.throwIfAborted();const original=pendingAssets.find(asset=>asset.id===id)??await readAsset(id);if(!original)throw new Error('An imported video is missing.');
      this.update({message:`Checking video ${index+1} of ${ids.length}`,progress:index/ids.length});
      const blob=await prepareSourceVideo(original.blob,signal,progress=>this.update({message:`Preparing ${original.name}`,progress}));
      const info=await this.validateVideo(blob,signal),working=blob===original.blob?original:{id:freshId(),name:original.name,blob};
      if(working!==original)pendingAssets=[...pendingAssets,working];
      project = { ...project, library: project.library?.map(item => item.assetId === id ? { ...item, assetId: working.id, duration: info.duration, originalAssetId: item.originalAssetId ?? (working !== original ? original.id : undefined) } : item) };
      graph={...graph,nodes:graph.nodes.map(n=>n.source?.assetId===id?{...n,source:{...n.source,assetId:working.id,duration:info.duration,originalAssetId:n.source.originalAssetId??(working!==original?original.id:undefined)}}:n)};
    }
    return {project:{...project,storyFlow:graph},pendingAssets};
  }
  private create(source: MediaSource): Project {
    return { id: source.id, name: source.name.replace(/\.[^.]+$/, ''), source: { name: source.name, url: source.url },
      updatedAt: Date.now(), crossfadeFrames: savedCrossfadeFrames(), interstitials: [], subtitle: null, analysis: emptyAnalysis() };
  }
  private async openSource(project:Project):Promise<MediaSource|null>{
    if(!project.source.assetId)return null;
    const {asset,url}=await assets.open(project.source.assetId);
    return {id:project.id,name:project.source.name,url,assetId:asset.id,file:new File([asset.blob],project.source.name,{type:asset.blob.type})};
  }
  async newProject(){
    await this.task('Creating project',async signal=>{
      const project:Project={id:this.draftId,name:'Untitled project',source:{name:'Untitled project'},updatedAt:Date.now(),interstitials:[],subtitle:null,analysis:emptyAnalysis(),library:[],
        storyFlow:{version:1,entryId:'',nodes:[],edges:[],templates:[]}};
      await this.activate(project,signal);
    });
  }
  async openDefault(source: MediaSource) {
    await this.task('Opening sample video', async signal => {
      if (!source.url) throw new Error('The sample video is unavailable on this server.');
      await this.activate(this.create(source), signal, [], null, source.id);
    });
  }
  async openSavedProject(id: string) {
    return this.task('Opening saved project', async signal => {
      const project = await readProject(id);
      if (!project || project.saved === false || (!project.saved && project.id.startsWith('draft:'))) throw new Error('Saved project not found.');
      await this.activate(project, signal, [], id);
      return true;
    });
  }
  async deleteSavedProject(id: string) {
    return this.task('Deleting saved project', async signal => {
      signal.throwIfAborted(); await deleteSavedProject(id);
      this.update({ savedProjectId: this.state.savedProjectId === id ? null : this.state.savedProjectId,
        savedProjects: await listSavedProjects() });
      return true;
    });
  }
  getFileHandle() { return this.fileHandle; }
  async openProjectFile(handle: FileSystemFileHandle) {
    return this.task('Opening project file', async signal => {
      const permissionHandle = handle as FileSystemFileHandle & { requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState> };
      if (permissionHandle.requestPermission && await permissionHandle.requestPermission({ mode: 'read' }) !== 'granted')
        throw new Error('Permission to read this project file was not granted.');
      const file = await handle.getFile();
      if (!/\.sparko$/i.test(file.name)) throw new Error('Choose a Sparko project file.');
      await this.restoreArchive(file, signal);
      this.fileHandle = handle;
      await rememberRecentFile(handle);
      this.update({ fileName: handle.name, dirty: false, recentFiles: await listRecentFiles() });
      return true;
    });
  }
  async saveToFile(handle: FileSystemFileHandle) {
    return this.task('Saving project file', async signal => {
      // Open the writer while the Save click still has user activation.
      const writer = await handle.createWritable();
      const revision = this.revision;
      try {
        const archive = await this.buildArchive(signal, handle.name.replace(/\.sparko$/i, ''));
        signal.throwIfAborted();
        await writer.write(archive.blob);
        await writer.close();
      } catch (error) { await writer.abort().catch(() => undefined); throw error; }
      this.fileHandle = handle;
      await rememberRecentFile(handle);
      this.update({ fileName: handle.name, dirty: this.revision !== revision, savedProjectId: null, recentFiles: await listRecentFiles() });
      return true;
    });
  }
  async removeRecentFile(id: string, deleteFromDisk = false) {
    return this.task(deleteFromDisk ? 'Deleting project file' : 'Removing recent project', async signal => {
      const item = this.state.recentFiles.find(item => item.id === id);
      if (!item) throw new Error('Recent project not found.');
      signal.throwIfAborted();
      if (deleteFromDisk) {
        const removable = item.handle as FileSystemFileHandle & { remove?: () => Promise<void> };
        if (!removable.remove) throw new Error('This browser cannot delete the file. Delete it in your file manager or remove it from Recent.');
        await removable.remove();
      }
      await forgetRecentFile(id);
      if (this.fileHandle && await this.fileHandle.isSameEntry(item.handle)) this.fileHandle = null;
      this.update({ recentFiles: await listRecentFiles(), fileName: this.fileHandle?.name ?? null });
      return true;
    });
  }
  async openSampleProject(url: string) {
    await this.task('Downloading sample project', signal => this.loadSampleProject(url, signal));
  }
  updateCallResponse(callResponse: CallResponseFlow) {
    if (this.operation) return;
    callResponse = lockCallResponseStructure(callResponse);
    callResponse = groupCallResponse({ ...callResponse, scenes: callResponse.scenes.map(scene => scene.clip.kind !== 'video' && !scene.interstitialId
      ? { ...scene, interstitialId: `call-response-${scene.id}` } : scene) });
    this.switching = true;
    try {
      this.interstitials.setCallResponse(callResponse);
      this.interstitials.rename(callResponse.interstitial.id, callResponse.interstitial.label);
      for (const answer of callResponse.interaction.answers) {
        const previous = projectFlows(this.state.project).find(flow => flow.interstitial.id === callResponse.interstitial.id)?.interaction.answers.find(item => item.id === answer.id);
        const scene = callResponse.scenes.find(scene => scene.id === answer.sceneId);
        if (previous && (previous.label !== answer.label || previous.sceneId !== answer.sceneId) && scene?.interstitialId) this.interstitials.rename(scene.interstitialId, answer.label);
      }
    }
    finally { this.switching = false; }
    if (this.state.project) {
      const project = withFlows({ ...this.state.project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() },
        [...projectFlows(this.state.project).filter(flow => flow.interstitial.id !== callResponse.interstitial.id), callResponse].sort((a, b) => a.interstitial.time - b.interstitial.time));
      this.interstitials.setCallResponses(activeFlows(project)); this.save(project);
    }
  }
  async addCallResponse(time: number, duration: number) {
    return this.task('Creating call-response interstitial', async () => {
      const project = this.state.project;
      if (!project?.source.assetId) return;
      const totalFrames = Math.floor(duration * TIMELINE_FPS);
      if (totalFrames < 78) throw new Error('A call-response interstitial needs at least 3.25 seconds of source video.');
      const anchor = Math.max(39, Math.min(totalFrames - 39, Math.round(frameTime(time, TIMELINE_FPS) * TIMELINE_FPS))) / TIMELINE_FPS;
      const pin: Interstitial = { id: crypto.randomUUID(), label: 'Untitled', time: anchor, kind: 'call-response',
        method: 'comfy', phase: 'draft', prompt: '', start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false };
      const flow = createCallResponseDraft(pin, project.source.assetId, duration).flow;
      this.switching = true;
      try {
        this.interstitials.ensureItem(pin);
        this.interstitials.setCallResponse(flow);
        const next = withFlows({ ...project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() },
          [...projectFlows(project), flow].sort((left, right) => left.interstitial.time - right.interstitial.time));
        this.interstitials.setCallResponses(activeFlows(next));
        this.save(next);
        this.interstitials.select(pin.id);
        return pin;
      } finally { this.switching = false; }
    });
  }
  endHistoryGroup() { this.history.endGroup(); }
  async removeAnswer(id: string, groupId?: string) {
    return this.task('Removing answer', async signal => {
      const project = this.state.project, flow = projectFlows(project).find(flow => !groupId || flow.interstitial.id === groupId);
      if (!project || !flow) return false;
      const next = removeAnswer(flow, id);
      if (next === flow) return false;
      const ids = flow.scenes.filter(scene => !next.scenes.some(remaining => remaining.id === scene.id))
        .flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []);
      let removed = false;
      this.switching = true;
      try {
        removed = await this.interstitials.removeMany(ids, signal);
        if (removed) this.interstitials.setCallResponse(next);
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save(withFlows({ ...this.state.project,
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() },
          projectFlows(project).map(group => group.interstitial.id === flow.interstitial.id && removed ? next : group)));
      }
      if (!removed && !signal.aborted) throw new Error('Could not remove the answer because its generation job could not be cancelled. Try again.');
      return removed;
    });
  }
  undo() { return this.restoreHistory('undo'); }
  redo() { return this.restoreHistory('redo'); }
  private async restoreHistory(direction: 'undo' | 'redo') {
    if (this.operation || !this.history.target(direction)) return;
    await this.task(direction === 'undo' ? 'Undoing edit' : 'Redoing edit', async signal => {
      const target = this.history.target(direction), project = this.state.project;
      if (!target || !project) return;
      const subtitle = target.subtitle ? { name: target.subtitle.name, url: (await assets.open(target.subtitle.assetId)).url } : null;
      signal.throwIfAborted();
      let restored = false;
      this.switching = true;
      try {
        await this.interstitials.restoreEdits(target.interstitials, target.callResponse, signal);
        this.interstitials.setCallResponses(activeFlows({ ...project, callResponse: target.callResponse, callResponses: target.callResponses, interstitials: this.interstitials.getSnapshot().items }));
        restored = true; this.history.commit(direction);
        this.update({ subtitle, historyRevision: this.state.historyRevision + 1 });
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save({ ...this.state.project,
          ...(restored ? { callResponse: target.callResponse, callResponses: target.callResponses, storyFlow: target.storyFlow, library: target.library, subtitle: target.subtitle, crossfadeFrames: target.crossfadeFrames } : {}),
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() }, false);
      }
      this.interstitials.setStoryGraph(this.state.project?.storyFlow,this.state.project?.source.assetId,this.storyDuration);
    });
  }
  async removeCallResponse(groupId?: string) {
    return this.task('Removing call-response interstitial', async signal => {
      const project = this.state.project;
      const flow = projectFlows(project).find(flow => !groupId || flow.interstitial.id === groupId);
      if (!project || !flow) return false;
      const ids = [flow.interstitial.id, ...flow.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : [])];
      let removed = false;
      this.switching = true;
      try {
        removed = await this.interstitials.removeMany(ids, signal);
        if (removed) this.interstitials.setCallResponses(activeFlows(project).filter(group => group.interstitial.id !== flow.interstitial.id));
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save({ ...this.state.project,
          callResponse: removed ? projectFlows(project).find(group => group.interstitial.id !== flow.interstitial.id) : project.callResponse,
          callResponses: removed ? projectFlows(project).filter(group => group.interstitial.id !== flow.interstitial.id) : projectFlows(project),
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() });
      }
      if (!removed && !signal.aborted) throw new Error('Could not remove the call-response interstitial because a generation job could not be cancelled. Try again.');
      return removed;
    });
  }
  private async loadSampleProject(url: string, signal: AbortSignal) {
    this.update({ message: 'Downloading sample project', progress: null });
    const archive = await assets.fetch(url, 'sample.sparko', signal, (received, total) => {
      if (!signal.aborted) this.update({ progress: total ? received / total : null });
    });
    await this.restoreArchive(archive.blob, signal);
  }
  private async task<T>(message: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.operation) return;
    const operation = new AbortController(); this.operation = operation;
    this.update({ busy: true, message, progress: null, error: null });
    try { return await work(operation.signal); }
    catch (error) { if (!operation.signal.aborted) this.update({ error: storageError(error) }); }
    finally { this.operation = null; this.update({ busy: false, message: '', progress: null }); }
  }
  cancel() { this.operation?.abort(); }
  async closeProject(discardChanges = false) {
    if (this.state.dirty && !discardChanges) return false;
    return this.task('Closing project', async signal => {
      await this.writes;
      signal.throwIfAborted();
      await clearActiveProject();
      this.switching = true;
      try {
        this.fileHandle = null;
        this.revision = 0;
        this.history.clear();
        this.update({ project: null, source: null, subtitle: null, savedProjectId: null, fileName: null,
          dirty: false, undoLabel: null, redoLabel: null, historyRevision: this.state.historyRevision + 1 });
        this.interstitials.load('', []);
        assets.releaseExcept(new Set());
      } finally { this.switching = false; }
      return true;
    });
  }
  async openVideo(file: File) {
    await this.task('Saving video locally', async signal => {
      if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) throw new Error('Choose a video file.');
      const id = `file:${file.name}:${file.size}:${file.lastModified}`;
      const asset = { id: crypto.randomUUID(), name: file.name, blob: file };
      const project = { ...this.create({ id, name: file.name, url: '' }), source: { name: file.name, assetId: asset.id } };
      await this.activate(project, signal, [asset]);
    });
  }
  updateAnalysis(analysis: AnalysisState, record = true) {
    if (this.state.project) this.save({ ...this.state.project, analysis, updatedAt: Date.now() }, record);
  }
  setCrossfadeFrames(value: number) {
    const project = this.state.project;
    if (!project || this.state.busy || !Number.isFinite(value)) return;
    const frames = Math.max(2, Math.min(maxCrossfadeFrames, Math.round(value / 2) * 2));
    if (project.crossfadeFrames !== frames) this.save({ ...project, crossfadeFrames: frames, updatedAt: Date.now() });
  }
  async setSubtitle(file: File) {
    const projectId = this.state.project?.id; if (!projectId) return;
    try {
      if (file.size > 8 * 1024 ** 2 || !(await file.text()).replace(/^\uFEFF/, '').startsWith('WEBVTT')) throw new Error('Use a valid WebVTT (.vtt) subtitle file up to 8 MB.');
      const asset = await assets.save(new Blob([file], { type: 'text/vtt' }), file.name);
      const opened = await assets.open(asset.id);
      if (this.state.project?.id !== projectId) return;
      this.update({ subtitle: { name: file.name, url: opened.url } });
      this.save({ ...this.state.project, subtitle: { name: file.name, assetId: asset.id }, updatedAt: Date.now() });
    } catch (error) { this.update({ error: storageError(error) }); }
  }
  async exportProject(): Promise<{ blob: Blob; name: string } | undefined> {
    return this.task('Collecting project assets', signal => this.buildArchive(signal));
  }
  private async buildArchive(signal: AbortSignal, fileName?: string): Promise<{ blob: Blob; name: string }> {
      if (!this.state.project) throw new Error('Create or open a project first.');
      const snapshot = structuredClone(this.state.project);
      if (fileName) snapshot.name = fileName;
      signal.throwIfAborted();
      if (!snapshot.source.assetId&&!snapshot.storyFlow) throw new Error('Wait for the source video to finish preparing.');
      if (snapshot.interstitials.some(item => item.result && (!item.result.assetId || item.phase !== 'ready'))) throw new Error('An interstitial result has not finished loading. Finish loading or retry the interstitial before exporting.');
      const stored: Asset[] = [];
      for (const id of assetIds(snapshot)) {
        const asset = await readAsset(id); signal.throwIfAborted();
        if (!asset) throw new Error('An asset is missing. Export was cancelled to avoid an incomplete project.'); stored.push(asset);
      }
      const blob = await packProject(snapshot, stored, signal, (message, progress) => this.update({ message, progress }));
      signal.throwIfAborted();
      return { blob, name: `${snapshot.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'project'}.sparko` };
  }
  private async validateVideo(blob: Blob, signal: AbortSignal) {
    const url = URL.createObjectURL(blob), engine = new MediaEngine({ id: 'validate', name: 'Project video', url, file: new File([blob], 'video.mp4') });
    try { signal.throwIfAborted(); const info = await engine.inspect(); signal.throwIfAborted(); return info; }
    finally { engine.dispose(); URL.revokeObjectURL(url); }
  }
  async importProject(file: File) {
    await this.task('Reading project', signal => this.restoreArchive(file, signal));
  }
  private async restoreArchive(file: Blob, signal: AbortSignal) {
    const imported = await unpackProject(file, signal, (message, progress) => this.update({ message, progress }));
    this.update({ message: 'Checking project media', progress: null });
    const byId = new Map(imported.assets.map(asset => [asset.id, asset]));
    const source = imported.project.source.assetId?await this.validateVideo(byId.get(imported.project.source.assetId)!.blob, signal):undefined;
      const clipInfo = new Map<string,MediaInfo>(source?[[imported.project.source.assetId!, source]]:[]);
      for (const scene of projectFlows(imported.project).flatMap(flow => flow.scenes)) {
        let info = clipInfo.get(scene.clip.assetId);
        if (!info) { info = await this.validateVideo(byId.get(scene.clip.assetId)!.blob, signal); clipInfo.set(scene.clip.assetId, info); }
        if (scene.clip.outFrame / TIMELINE_FPS > info.duration + 1 / info.fps) throw new Error('A scene clip extends beyond its media.');
      }
    for(const node of [...imported.project.storyFlow?.nodes??[],...imported.project.storyFlow?.templates.flatMap(t=>t.nodes)??[]]){
      if(!node.source)continue;
      let info=clipInfo.get(node.source.assetId);
      if(!info){info=await this.validateVideo(byId.get(node.source.assetId)!.blob,signal);clipInfo.set(node.source.assetId,info);}
      if(node.source.outFrame/TIMELINE_FPS>info.duration+1/info.fps)throw new Error('A story clip extends beyond its source media.');
    }
    for(const item of imported.project.library??[]){
      if(item.kind==='subtitle')continue;
      let info=clipInfo.get(item.assetId);
      if(!info){info=await this.validateVideo(byId.get(item.assetId)!.blob,signal);clipInfo.set(item.assetId,info);}
      if((item.outFrame??0)/TIMELINE_FPS>info.duration+1/info.fps)throw new Error('A library clip extends beyond its media.');
      item.duration=info.duration;
    }
    for (const item of imported.project.interstitials) {
      if (!imported.project.storyFlow&&source&&item.time > source.duration + Math.max(1 / source.fps, 1 / TIMELINE_FPS)) throw new Error('An interstitial anchor lies outside the source video.');
      for (const result of [item.result, item.previousResult]) {
        if (!result) continue;
        const info = await this.validateVideo(byId.get(result.assetId!)!.blob, signal);
        if (result.start + result.duration > info.duration + 1 / info.fps) throw new Error('An interstitial asset is shorter than its saved scene boundaries.');
      }
    }
    if (imported.project.subtitle) {
      const blob = byId.get(imported.project.subtitle.assetId)!.blob;
      if (blob.size > 8 * 1024 ** 2 || !(await blob.text()).replace(/^\uFEFF/, '').startsWith('WEBVTT')) throw new Error('The project subtitle asset is invalid.');
    }
    signal.throwIfAborted(); await this.activate(imported.project, signal, imported.assets);
  }
  dispose() { this.cancel(); this.unsubscribe?.(); this.unsubscribe = undefined; }
}

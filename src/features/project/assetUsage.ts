import type { Project } from './types';

export type AssetUse = { owner: string; role: string };
/** Include editable inputs and submitted render provenance, not just timeline footage. */
export function assetUsage(project: Project, ids: string[]): AssetUse[] {
  const wanted = new Set(ids), uses: AssetUse[] = [];
  const add = (id: string | undefined, owner: string, role: string) => { if (id && wanted.has(id) && !uses.some(u => u.owner === owner && u.role === role)) uses.push({ owner, role }); };
  for (const node of project.storyFlow?.nodes ?? []) { add(node.source?.assetId, node.name, 'Timeline footage'); add(node.source?.originalAssetId, node.name, 'Original timeline footage'); }
  for (const item of project.interstitials) {
    const node = project.storyFlow?.nodes.find(n => n.interstitialId === item.id), owner = node?.name ?? item.label;
    for (const [settings, prefix] of [[item, ''], [item.generationSettings, 'Submitted ']] as const) {
      for (const ref of settings?.imageReferences ?? []) add(ref.assetId, owner, `${prefix}image input`);
      add(settings?.startVideoAsset?.assetId, owner, `${prefix}start video input`);
      add(settings?.endVideoAsset?.assetId, owner, `${prefix}end video input`);
    }
    for (const result of [item.result, item.previousResult]) {
      add(result?.assetId, owner, node ? 'Timeline generated footage' : 'Generated output');
      add(result?.fullAssetId, owner, 'Full generated output');
      add(result?.reference?.before?.assetId, owner, 'Rendered start reference');
      add(result?.reference?.after?.assetId, owner, 'Rendered end reference');
    }
    add(item.requestReference?.before?.assetId, owner, 'Submitted start reference');
    add(item.requestReference?.after?.assetId, owner, 'Submitted end reference');
  }
  for (const g of project.assetGenerations ?? []) {
    for (const ref of g.settings.references) add(ref.assetId, g.name, `${g.kind} generation input`);
    for (const ref of g.submitted?.references ?? []) add(ref.assetId, g.name, 'Submitted generation input');
    for (const version of g.versions) for (const ref of version.settings.references) add(ref.assetId, g.name, 'Saved version input');
  }
  for (const template of project.storyFlow?.templates ?? []) {
    for (const node of template.nodes) add(node.source?.assetId, template.name, 'Template footage');
    for (const settings of Object.values(template.settings)) {
      for (const ref of settings.imageReferences ?? []) add(ref.assetId, template.name, 'Template image input');
      add(settings.startVideoAsset?.assetId, template.name, 'Template start input'); add(settings.endVideoAsset?.assetId, template.name, 'Template end input');
    }
  }
  for (const flow of project.callResponses ?? (project.callResponse ? [project.callResponse] : [])) for (const scene of flow.scenes) add(scene.clip.assetId, scene.label, 'Timeline footage');
  add(project.subtitle?.assetId, 'Project subtitles', 'Subtitle track');
  add(project.source.originalAssetId, 'Project source', 'Original playback source');
  if (!uses.length) add(project.source.assetId, 'Project source', 'Playback source');
  return uses;
}

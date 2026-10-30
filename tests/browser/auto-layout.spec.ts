import { test, expect, type Page } from './fixtures';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const inspect=(page:Page)=>page.locator('.story-scroll').evaluate(el=>{
  const view=el.getBoundingClientRect(),boxes=[...el.querySelectorAll('.story-clip')].map(n=>n.getBoundingClientRect());
  return {heights:boxes.map(b=>b.height),inside:boxes.every(b=>b.left>=view.left&&b.right<=view.right&&b.top>=view.top&&b.bottom<=view.bottom),
    overlaps:boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)).length};
});

for(const width of [1440,390])for(const mixed of [false,true])test(`cleanup separates ${mixed?'mixed routes and groups':'disconnected clips'} at ${width}px and survives Fit all`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:1000});await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();
  await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);
  const bytes=await page.evaluate(async(mixed)=>{
    const {readActiveProject,readAsset}=await import('/src/features/project/database.ts' as string),{packProject}=await import('/src/features/project/archive.ts' as string);
    const project=await readActiveProject(),original=project.storyFlow.nodes[0];
    project.storyFlow={version:1,entryId:'clip-0',templates:[],nodes:Array.from({length:12},(_,i)=>({...original,id:`clip-${i}`,name:`Clip ${i+1}`,x:0,y:0,source:{...original.source,outFrame:24*(1+i%4)}})),
      edges:mixed?[[0,1],[1,2],[3,4],[4,3]].map(([from,to],i)=>({id:`edge-${i}`,from:`clip-${from}`,to:`clip-${to}`,event:'next',label:'Next',values:[],crossfade:.25,points:i===0?[{id:'old-bend',x:-30000,y:40000}]:undefined})):[],
      groups:mixed?[{id:'group',name:'Loose footage',color:'blue',nodeIds:['clip-6','clip-8','clip-10']}]:[]};
    const archive=await packProject(project,[await readAsset(project.source.assetId)],new AbortController().signal,()=>{});return [...new Uint8Array(await archive.arrayBuffer())];
  },mixed);
  await page.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'Overlapping clips.sparko',mimeType:'application/zip',buffer:Buffer.from(bytes)});
  await expect(page.locator('.story-clip')).toHaveCount(12);const original=(await saved(page)).storyFlow;
  expect((await inspect(page)).overlaps).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Auto layout',exact:true}).click();
  await expect.poll(async()=>(await inspect(page)).overlaps).toBe(0);expect((await inspect(page)).inside).toBe(true);
  expect((await inspect(page)).heights).toEqual(Array(12).fill(76));
  const cleaned=(await saved(page)).storyFlow;
  expect(cleaned.nodes.map(({x,y,...n}:any)=>n)).toEqual(original.nodes.map(({x,y,...n}:any)=>n));
  expect(cleaned.edges.map(({points,...e}:any)=>e)).toEqual(original.edges.map(({points,...e}:any)=>e));expect(cleaned.groups).toEqual(original.groups);
  await page.getByRole('button',{name:'Fit all',exact:true}).click();expect((await inspect(page)).overlaps).toBe(0);expect((await inspect(page)).inside).toBe(true);
  await page.screenshot({path:`test-results/auto-layout-${mixed?'mixed':'loose'}-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await saved(page)).storyFlow.nodes).toEqual(original.nodes);
  // Context-menu cleanup uses the same layout and clears stale wire bend bounds.
  await page.locator('.story-scroll').click({button:'right',position:{x:15,y:15}});await page.getByRole('menuitem',{name:/Clean up layout/}).click();
  await expect.poll(async()=>(await inspect(page)).overlaps).toBe(0);expect((await inspect(page)).inside).toBe(true);
  expect((await saved(page)).storyFlow.nodes).toEqual(cleaned.nodes);expect(errors).toEqual([]);
});

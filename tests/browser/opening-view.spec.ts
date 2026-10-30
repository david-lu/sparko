import {test,expect,type Page} from './fixtures';

const canvasState=(page:Page)=>page.locator('.story-scroll').evaluate(el=>{
  const view=el.getBoundingClientRect(),nodes=[...el.querySelectorAll<HTMLElement>('.story-clip')];
  return {camera:(el as HTMLElement).style.backgroundPosition,zoom:document.querySelector('.story-zoom')!.textContent,
    inside:nodes.every(n=>{const r=n.getBoundingClientRect();return r.left>=view.left&&r.right<=view.right&&r.top>=view.top&&r.bottom<=view.bottom;}),
    heights:nodes.map(n=>n.getBoundingClientRect().height)};
});

for(const width of [1440,390])test(`opening and reopening fit every clip and start paused at the first frame (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);
  const bytes=await page.evaluate(async()=>{
    const {readActiveProject,readAsset}=await import('/src/features/project/database.ts' as string),{packProject}=await import('/src/features/project/archive.ts' as string);
    const project=await readActiveProject(),original=project.storyFlow.nodes[0];
    project.storyFlow={version:1,entryId:'opening',templates:[],nodes:[
      {...original,id:'later',name:'Later clip',x:2200,y:1150},
      {...original,id:'opening',name:'Opening clip',x:-800,y:-450,source:{...original.source,inFrame:24,outFrame:72}},
      {...original,id:'loose',name:'Separate clip',x:-1500,y:800}
    ],edges:[{id:'route',from:'opening',to:'later',event:'next',label:'Next',values:[],crossfade:0,points:[{id:'bend',x:3200,y:-900}]}]};
    const archive=await packProject(project,[await readAsset(project.source.assetId)],new AbortController().signal,()=>{});
    return [...new Uint8Array(await archive.arrayBuffer())];
  });
  const file={name:'Opening view.sparko',mimeType:'application/zip',buffer:Buffer.from(bytes)};
  const check=async()=>{
    await expect(page.locator('.story-clip')).toHaveCount(3);
    await expect.poll(async()=>(await canvasState(page)).inside).toBe(true);
    expect((await canvasState(page)).heights).toEqual([76,76,76]);
    const first=page.locator('[data-node-id=opening]');await expect(first.locator('.story-playhead')).toBeVisible();
    await expect(first.locator('.story-filmstrip')).toHaveAttribute('aria-valuenow','0');await expect(page.getByRole('button',{name:'Play video',exact:true})).toBeVisible();
    expect(await first.locator('.story-playhead').evaluate(el=>(el as HTMLElement).style.left)).toBe('0%');
    const point=page.locator('[data-reroute-id=bend]');await expect(point).toBeVisible();
    expect(await point.evaluate(el=>{const p=el.getBoundingClientRect(),r=el.closest('.story-scroll')!.getBoundingClientRect();return p.x>=r.x&&p.right<=r.right&&p.y>=r.y&&p.bottom<=r.bottom;})).toBe(true);
  };
  await page.getByLabel('Choose project file',{exact:true}).setInputFiles(file);await check();
  const initial=await canvasState(page),later=page.getByRole('slider',{name:'Scrub Later clip',exact:true});
  await later.focus();await page.keyboard.press('Shift+ArrowRight');await expect(later).toHaveAttribute('aria-valuenow','1');
  await page.getByRole('button',{name:'Zoom in story',exact:true}).click();await page.locator('.story-scroll').hover();await page.mouse.wheel(-500,-300);
  await expect.poll(async()=>(await canvasState(page)).camera).not.toBe(initial.camera);
  const beforeEdit=await canvasState(page);await page.getByLabel('Clip name',{exact:true}).fill('Edited later clip');await page.getByLabel('Clip name',{exact:true}).press('Enter');
  expect((await canvasState(page)).camera).toBe(beforeEdit.camera);await expect(page.getByRole('slider',{name:'Scrub Edited later clip',exact:true})).toHaveAttribute('aria-valuenow','1');
  await page.getByLabel('Choose project file',{exact:true}).setInputFiles(file);await check();
  expect((await canvasState(page)).zoom).toBe(initial.zoom);
  await page.screenshot({path:`test-results/opening-view-${width}.png`,fullPage:true});
});

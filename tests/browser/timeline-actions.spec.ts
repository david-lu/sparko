import { openGenerationTimeline, closeGenerationTimeline, setVideoReference, fitAll, test, expect, type Page } from './fixtures';

const open=async(page:Page)=>{await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);await expect(page.locator('.story-playhead')).toBeVisible();};
const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});

for(const width of [1440,390]) {
  test(`existing interstitials replace transitions, cancel, and undo at ${width}px`,{tag:width===1440?'@flaky':[]},async({page})=>{
    await page.setViewportSize({width,height:1000});await open(page);
    await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
    const canvas=page.locator('.story-scroll');await canvas.click({button:'right',position:{x:12,y:12}});await page.getByRole('menuitem',{name:'Add video',exact:true}).click();
    await page.getByLabel('Video prompt',{exact:true}).fill('Keep this existing draft');
    await setVideoReference(page, 'start', true);await fitAll(page);
    const initial=await saved(page),connection=initial.storyFlow.edges[0],node=initial.storyFlow.nodes.at(-1);
    const toolbar=await page.locator('.story-toolbar').boundingBox(),status=await page.locator('.story-status').boundingBox(),bounds=await canvas.boundingBox();
    const title=page.locator(`[data-node-id="${node.id}"] .story-clip-title`),transition=page.locator('.story-crossfade');
    const drag=async()=>{const a=(await title.boundingBox())!,b=(await transition.boundingBox())!;await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});};
    await drag();await expect(page.locator('.story-edge.drop-target')).toHaveAttribute('data-edge-id',connection.id);await expect(page.locator('.story-status')).toContainText('replace transition');
    expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.locator('.story-status').boundingBox()).toEqual(status);
    await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.story-edge.drop-target')).toHaveCount(0);expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);
    await drag();await expect(page.locator('.story-transition-drop-label')).toBeVisible();await page.mouse.up();
    await expect(page.locator('.story-edge')).toHaveCount(2);await expect(page.locator('.story-edge.drop-target')).toHaveCount(0);
    const after=await saved(page);expect(after.storyFlow.nodes).toHaveLength(3);expect(after.interstitials).toEqual(initial.interstitials);
    expect(after.storyFlow.edges.map((e:any)=>[e.from,e.to])).toEqual([[connection.from,node.id],[node.id,connection.to]]);
    await openGenerationTimeline(page);
    await expect(page.getByRole('button',{name:`Start reference: ${initial.storyFlow.nodes[0].name}`,exact:true})).toBeVisible();
    await expect(page.getByRole('checkbox',{name:'Reference end video',exact:true})).not.toBeChecked();
    await closeGenerationTimeline(page);
    expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);expect(await canvas.boundingBox()).toEqual(bounds);
    await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);
    await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await saved(page)).storyFlow).toEqual(after.storyFlow);
    await fitAll(page);
    await page.locator('.story-edge-hit').first().press('Enter');await expect(page.getByLabel('Video crossfade duration',{exact:true})).toHaveValue('0.75');
    await page.locator('.story-edge-hit').last().press('Enter');await expect(page.getByLabel('Video crossfade duration',{exact:true})).toHaveValue('0');
    await title.click();await setVideoReference(page, 'end', true);
    await openGenerationTimeline(page); await page.getByRole('spinbutton',{name:'end_range',exact:true}).fill('1.625'); await closeGenerationTimeline(page);
    await page.locator('.story-edge-hit').last().press('Enter');await expect(page.getByLabel('Video crossfade duration',{exact:true})).toHaveValue('1.208');
    await page.getByLabel('Video crossfade duration',{exact:true}).fill('0.5');
    await title.click();await openGenerationTimeline(page); await page.getByRole('spinbutton',{name:'end_range',exact:true}).fill('2'); await closeGenerationTimeline(page);
    await page.locator('.story-edge-hit').last().press('Enter');await expect(page.getByLabel('Video crossfade duration',{exact:true})).toHaveValue('0.5');
    await expect(page.locator('.connection-fade-control').filter({has:page.getByLabel('Video crossfade duration',{exact:true})})).not.toContainText('Automatic:');
    await expect(page.getByLabel('Audio crossfade duration',{exact:true})).toHaveValue('1.5');
  });

  test(`context menus follow the pointer and insert templates at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});await open(page);
    const canvas=page.locator('.story-scroll'),toolbar=page.locator('.story-toolbar');
    await expect(toolbar.locator('summary')).toHaveCount(0);
    const bounds=(await canvas.boundingBox())!,before=await toolbar.boundingBox();
    for(const corner of ['top-left','bottom-right']){
      const point=await canvas.evaluate((el,corner)=>{
        const r=el.getBoundingClientRect(),x=corner==='top-left'?r.left+12:r.right-12;
        // Docked panels can clip the bottom of the canvas on narrow screens.
        const top=Math.max(0,r.top)+12,bottom=Math.min(innerHeight,r.bottom)-12;
        for(let y=corner==='top-left'?top:bottom;y>=top&&y<=bottom;y+=corner==='top-left'?8:-8){
          if(el.contains(document.elementFromPoint(x,y)))return {x,y};
        }
        throw new Error('No visible timeline point');
      },corner);
      await page.mouse.click(point.x,point.y,{button:'right'});
      const menu=page.locator('.story-context-menu');await expect(menu).toBeVisible();const r=(await menu.boundingBox())!;
      expect(r.x).toBeCloseTo(Math.max(8,Math.min(point.x,width-r.width-8)),0);
      expect(r.y).toBeCloseTo(Math.max(8,Math.min(point.y,1000-r.height-8)),0);
      await page.getByRole('menuitem',{name:'Add template',exact:true}).click();await expect(page.getByRole('menu',{name:'Add template',exact:true})).toBeVisible();
      await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(canvas).toBeFocused();
    }
    await canvas.click({button:'right',position:{x:12,y:12}});await page.getByRole('menuitem',{name:'Add template',exact:true}).click();
    await page.getByRole('menuitem',{name:'Question & response',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(5);
    expect(await toolbar.boundingBox()).toEqual(before);expect(await canvas.boundingBox()).toEqual(bounds);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);
    await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await fitAll(page);
    const connection=(await saved(page)).storyFlow.edges[0];await page.locator('.story-crossfade').click({button:'right'});
    await page.getByRole('menuitem',{name:'Add template',exact:true}).click();await page.getByRole('menuitem',{name:'Question & response',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(6);
    const graph=(await saved(page)).storyFlow;expect(graph.edges.some((e:any)=>e.from===connection.from&&e.to===connection.to)).toBe(false);expect(graph.edges.filter((e:any)=>e.to===connection.to)).toHaveLength(2);
  });
}

import { fitAll, test, expect, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const open=async(page:Page)=>{await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const drag=async(page:Page,from:{x:number;y:number},to:{x:number;y:number},release=true)=>{
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});if(release)await page.mouse.up();
};

for(const width of [1440,390])test(`draw and cut tools complete one action, cancel cleanly, and keep the layout stable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});await open(page);
  const draw=page.getByRole('button',{name:'Draw group tool',exact:true}),cut=page.getByRole('button',{name:'Cut tool',exact:true});
  const canvas=page.locator('.story-scroll'),bounds=(await canvas.boundingBox())!,toolbar=await page.locator('.story-toolbar').boundingBox(),stage=await page.locator('.video-stage').boundingBox(),status=await page.locator('.story-status').boundingBox(),before=(await saved(page)).storyFlow;
  await draw.click();await expect(draw).toHaveAttribute('aria-pressed','true');
  await drag(page,{x:bounds.x+60,y:bounds.y+15},{x:bounds.x+260,y:bounds.y+80},false);
  await expect(page.locator('.story-group-drawing')).toBeVisible();expect((await saved(page)).storyFlow).toEqual(before);
  expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);expect(await page.locator('.story-status').boundingBox()).toEqual(status);
  await page.screenshot({path:`test-results/drawing-group-${width}.png`,fullPage:true});
  await page.mouse.up();await expect(draw).toHaveAttribute('aria-pressed','false');await expect(page.locator('.story-group-drawing')).toHaveCount(0);await expect(page.locator('.story-group')).toHaveCount(1);
  const created=(await saved(page)).storyFlow;expect(created.nodes).toEqual(before.nodes);expect(created.edges).toEqual(before.edges);expect(created.groups[0].nodeIds).toEqual([]);expect(created.groups[0].bounds).toBeDefined();
  expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.locator('.video-stage').boundingBox()).toEqual(stage);expect(await page.locator('.story-status').boundingBox()).toEqual(status);
  await draw.click();await drag(page,{x:bounds.x+70,y:bounds.y+100},{x:bounds.x+250,y:bounds.y+180},false);await page.keyboard.press('Escape');await page.mouse.up();
  await expect(draw).toHaveAttribute('aria-pressed','false');expect((await saved(page)).storyFlow).toEqual(created);await expect(page.locator('.story-group-drawing')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-group')).toHaveCount(0);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-group')).toHaveCount(1);
  await draw.click();await cut.click();await expect(draw).toHaveAttribute('aria-pressed','false');await expect(cut).toHaveAttribute('aria-pressed','true');
  const film=(await page.locator('.story-filmstrip').boundingBox())!;await page.mouse.click(film.x+film.width/2,film.y+film.height/2);
  await expect(page.locator('.story-clip')).toHaveCount(2);await expect(cut).toHaveAttribute('aria-pressed','false');await expect(page.locator('.story-cut-preview,.story-cut-surface')).toHaveCount(0);
  await fitAll(page);await page.locator('.story-filmstrip').last().click();await expect(page.locator('.story-clip')).toHaveCount(2);
  await cut.click();await page.keyboard.press('Escape');await expect(cut).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('drawn frames move, resize, accept selected clips, retain empty membership and survive reload',async({page})=>{
  await open(page);const before=(await saved(page)).storyFlow,canvas=(await page.locator('.story-scroll').boundingBox())!;
  await page.getByRole('button',{name:'Draw group tool',exact:true}).click();await drag(page,{x:canvas.x+80,y:canvas.y+20},{x:canvas.x+280,y:canvas.y+85});
  const frame=page.locator('.story-group'),header=frame.locator('.story-group-header');let graph=(await saved(page)).storyFlow,original=graph.groups[0];
  let box=(await header.boundingBox())!;await drag(page,{x:box.x+40,y:box.y+13},{x:box.x+90,y:box.y+33});
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].bounds.x).not.toBe(original.bounds.x);expect(graph.nodes).toEqual(before.nodes);
  const moved=graph.groups[0],resize=(await frame.locator('.story-group-resize').boundingBox())!;
  await drag(page,{x:resize.x+5,y:resize.y+5},{x:resize.x+65,y:resize.y+35});
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].bounds.width).toBeGreaterThan(moved.bounds.width);expect(graph.groups[0].bounds.height).toBeGreaterThan(moved.bounds.height);
  await header.click({button:'right'});await expect(page.getByRole('menuitem',{name:'Draw group',exact:true})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'Rename group',exact:true}).click();await page.getByLabel('Group name',{exact:true}).fill('Opening');await page.getByLabel('Group name',{exact:true}).press('Enter');
  await header.click({button:'right'});await page.getByRole('menuitem',{name:'Change color',exact:true}).click();await page.getByRole('menuitemradio',{name:'Purple',exact:true}).click();expect((await saved(page)).storyFlow.groups[0].color).toBe('purple');
  await page.locator('.story-clip-title').click();await header.click({button:'right'});await page.getByRole('menuitem',{name:'Add selected clips',exact:true}).click();
  expect((await saved(page)).storyFlow.groups[0].nodeIds).toEqual([before.nodes[0].id]);expect((await saved(page)).storyFlow.edges).toEqual(before.edges);
  await header.click({button:'right'});await page.getByRole('menuitem',{name:'Fit to contents',exact:true}).click();expect((await saved(page)).storyFlow.groups[0].bounds).toBeUndefined();
  await page.getByRole('button',{name:`Remove ${before.nodes[0].name} from group`,exact:true}).click();
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].nodeIds).toEqual([]);expect(graph.groups[0].bounds).toBeDefined();expect(graph.nodes).toEqual(before.nodes);
  await page.getByText('File',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloading,buffer=await readFile((await download.path())!);
  await page.reload();await page.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'Groups.sparko',mimeType:'application/zip',buffer});
  await expect(page.locator('.story-group')).toHaveCount(1);expect((await saved(page)).storyFlow.groups).toEqual(graph.groups);const restoredNodes=(await saved(page)).storyFlow.nodes;
  await page.locator('.story-group-header').click({button:'right'});await page.getByRole('menuitem',{name:/Remove group/}).click();
  await expect(page.locator('.story-group')).toHaveCount(0);expect((await saved(page)).storyFlow.nodes).toEqual(restoredNodes);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-group')).toHaveCount(1);
  await page.locator('.story-group-header').focus();await page.keyboard.press('Enter');await page.keyboard.press('Delete');await expect(page.locator('.story-group')).toHaveCount(0);await expect(page.locator('.story-clip')).toHaveCount(1);
});

test('drawing encloses complete clips and right-click groups the selection without changing connections',async({page})=>{
  await open(page);await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await fitAll(page);
  const original=(await saved(page)).storyFlow,first=page.locator('.story-clip').first(),box=(await first.boundingBox())!;
  await page.getByRole('button',{name:'Draw group tool',exact:true}).click();
  // Reverse drawing direction also encloses the whole first clip.
  await drag(page,{x:box.x+box.width+18,y:box.y+box.height+25},{x:box.x-18,y:box.y-38});
  let graph=(await saved(page)).storyFlow;expect(graph.groups[0].nodeIds).toEqual([original.nodes[0].id]);expect(graph.nodes).toEqual(original.nodes);expect(graph.edges).toEqual(original.edges);
  await page.locator('.story-group-header').click({button:'right'});await page.getByRole('menuitem',{name:/Remove group/}).click();
  await first.locator('.story-clip-title').click();await page.locator('.story-clip-title').last().click({modifiers:['Shift']});await first.click({button:'right'});
  await page.getByRole('menuitem',{name:/Group selection/}).click();graph=(await saved(page)).storyFlow;
  expect(graph.groups[0].nodeIds).toEqual(original.nodes.map((n:any)=>n.id));expect(graph.nodes).toEqual(original.nodes);expect(graph.edges).toEqual(original.edges);
  await first.locator('.story-clip-title').click({button:'right'});await page.getByRole('menuitem',{name:'Remove from group',exact:true}).click();
  expect((await saved(page)).storyFlow.groups[0].nodeIds).toEqual([original.nodes[1].id]);expect((await saved(page)).storyFlow.edges).toEqual(original.edges);
});

import { fitAll, test, expect, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const open=async(page:Page)=>{await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled(); await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const drag=async(page:Page,from:{x:number;y:number},to:{x:number;y:number},release=true)=>{
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});if(release)await page.mouse.up();
};

const groupSelection=async(page:Page,target=page.locator('.story-clip').first())=>{await target.click({button:'right'});await page.getByRole('menuitem',{name:/Group selection/}).click();};

for(const width of [1440,390])test(`there is no draw tool; the cut tool completes one action, cancels cleanly and keeps the layout stable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});await open(page);
  await expect(page.getByRole('button',{name:'Draw group tool',exact:true})).toHaveCount(0);
  const cut=page.getByRole('button',{name:'Cut tool',exact:true}),layout=()=>Promise.all(['.story-scroll','.story-toolbar','.video-stage','.story-status'].map(s=>page.locator(s).boundingBox()));
  const before=await layout(),graph=(await saved(page)).storyFlow,bounds=before[0]!;
  // Dragging empty canvas selects; it never creates a group.
  await drag(page,{x:bounds.x+60,y:bounds.y+40},{x:bounds.x+200,y:bounds.y+90});
  await expect(page.locator('.story-group')).toHaveCount(0);expect((await saved(page)).storyFlow).toEqual(graph);
  await page.screenshot({path:`test-results/timeline-toolbar-${width}.png`,fullPage:true});
  await cut.click();await expect(cut).toHaveAttribute('aria-pressed','true');
  const film=(await page.locator('.story-filmstrip').boundingBox())!;await page.mouse.click(film.x+film.width/2,film.y+film.height/2);
  await expect(page.locator('.story-clip')).toHaveCount(2);await expect(cut).toHaveAttribute('aria-pressed','false');await expect(page.locator('.story-cut-preview,.story-cut-surface')).toHaveCount(0);
  expect(await layout()).toEqual(before);
  await fitAll(page);await page.locator('.story-filmstrip').last().click();await expect(page.locator('.story-clip')).toHaveCount(2);
  await cut.click();await page.keyboard.press('Escape');await expect(cut).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('group frames move, resize, keep their frame when emptied and survive reload',async({page})=>{
  await open(page);const before=(await saved(page)).storyFlow;
  await groupSelection(page);
  const frame=page.locator('.story-group'),header=frame.locator('.story-group-header');await expect(frame).toHaveCount(1);
  let graph=(await saved(page)).storyFlow;expect(graph.groups[0].nodeIds).toEqual([before.nodes[0].id]);expect(graph.groups[0].bounds).toBeUndefined();
  let box=(await header.boundingBox())!;await drag(page,{x:box.x+40,y:box.y+13},{x:box.x+90,y:box.y+33});
  graph=(await saved(page)).storyFlow;expect(graph.nodes[0].x).not.toBe(before.nodes[0].x);expect(graph.edges).toEqual(before.edges);
  const fitted=(await frame.boundingBox())!,resize=(await frame.locator('.story-group-resize').boundingBox())!;
  await drag(page,{x:resize.x+5,y:resize.y+5},{x:resize.x+65,y:resize.y+35});
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].bounds).toBeDefined();
  const resized=(await frame.boundingBox())!;expect(resized.width).toBeGreaterThan(fitted.width);expect(resized.height).toBeGreaterThan(fitted.height);
  await header.click({button:'right'});await expect(page.getByRole('menuitem',{name:/Draw group/})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'Rename group',exact:true}).click();await page.getByLabel('Group name',{exact:true}).fill('Opening');await page.getByLabel('Group name',{exact:true}).press('Enter');
  await header.click({button:'right'});await page.getByRole('menuitem',{name:'Change color',exact:true}).click();await page.getByRole('menuitemradio',{name:'Purple',exact:true}).click();expect((await saved(page)).storyFlow.groups[0].color).toBe('purple');
  const headerBox=(await header.boundingBox())!,playhead=(await page.locator('.story-playhead>span').boundingBox())!;
  expect(headerBox.y+headerBox.height).toBeLessThan(playhead.y);
  await header.click({button:'right'});await page.getByRole('menuitem',{name:'Fit to contents',exact:true}).click();expect((await saved(page)).storyFlow.groups[0].bounds).toBeUndefined();
  const clips=(await saved(page)).storyFlow.nodes;
  await header.click();await page.getByRole('button',{name:`Remove ${before.nodes[0].name} from group`,exact:true}).click();
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].nodeIds).toEqual([]);expect(graph.groups[0].bounds).toBeDefined();expect(graph.nodes).toEqual(clips);
  await page.getByText('File',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloading,buffer=await readFile((await download.path())!);
  await page.reload(); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled(); await page.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'Groups.sparko',mimeType:'application/zip',buffer});
  await expect(page.locator('.story-group')).toHaveCount(1);expect((await saved(page)).storyFlow.groups).toEqual(graph.groups);const restoredNodes=(await saved(page)).storyFlow.nodes;
  await page.locator('.story-group-header').click({button:'right'});await page.getByRole('menuitem',{name:/Remove group/}).click();
  await expect(page.locator('.story-group')).toHaveCount(0);expect((await saved(page)).storyFlow.nodes).toEqual(restoredNodes);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-group')).toHaveCount(1);
  await page.locator('.story-group-header').focus();await page.keyboard.press('Enter');await page.keyboard.press('Delete');await expect(page.locator('.story-group')).toHaveCount(0);await expect(page.locator('.story-clip')).toHaveCount(1);
});

test('right-click groups the selection without changing connections',async({page})=>{
  await open(page);await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await fitAll(page);
  const original=(await saved(page)).storyFlow,first=page.locator('.story-clip').first();
  await first.locator('.story-clip-title').click();await page.locator('.story-clip-title').last().click({modifiers:['Shift']});await groupSelection(page,first);
  let graph=(await saved(page)).storyFlow;
  expect(graph.groups[0].nodeIds).toEqual(original.nodes.map((n:any)=>n.id));expect(graph.nodes).toEqual(original.nodes);expect(graph.edges).toEqual(original.edges);
  await first.locator('.story-clip-title').click({button:'right'});await page.getByRole('menuitem',{name:'Remove from group',exact:true}).click();
  graph=(await saved(page)).storyFlow;expect(graph.groups[0].nodeIds).toEqual([original.nodes[1].id]);expect(graph.edges).toEqual(original.edges);
});

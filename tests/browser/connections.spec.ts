import { fitAll,test,expect,type Page} from './fixtures';
const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
async function open(page:Page){
  await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await page.locator('.story-clip').last().locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await expect(page.locator('.story-clip')).toHaveCount(3);await fitAll(page);
  return saved(page);
}
async function drag(page:Page,from:string,to:string|{x:number;y:number},cancel=false){
  const box=await page.locator(from).boundingBox(),end=typeof to==='string'?await page.locator(to).boundingBox():null;
  const target=typeof to==='string'?{x:end!.x+end!.width/2,y:end!.y+end!.height/2}:to;
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
test('sockets detach, connect backwards, reconnect, and cancel while retaining the connection fade',async({page})=>{
  const project=await open(page),[first,middle,last]=project.storyFlow.nodes;
  const input=(id:string)=>`[data-node-id="${id}"] .story-port.input`,output=(id:string)=>`[data-node-id="${id}"] .story-port.output`;
  const canvas=await page.locator('.story-scroll').boundingBox(),blank={x:canvas!.x+30,y:canvas!.y+30};
  await drag(page,input(middle.id),blank);await expect.poll(async()=>(await saved(page)).storyFlow.edges.length).toBe(1);
  await drag(page,input(middle.id),output(first.id));await expect.poll(async()=>(await saved(page)).storyFlow.edges.length).toBe(2);
  let connection=(await saved(page)).storyFlow.edges.find((e:any)=>e.from===first.id);const selector=`[data-edge-id="${connection.id}"]`;
  await page.locator(selector+' .story-crossfade').click();await page.getByLabel('Crossfade duration').fill('.375');
  await drag(page,input(middle.id),input(last.id),true);expect((await saved(page)).storyFlow.edges.find((e:any)=>e.id===connection.id).to).toBe(middle.id);
  await drag(page,input(middle.id),input(last.id));await expect.poll(async()=>(await saved(page)).storyFlow.edges.find((e:any)=>e.id===connection.id).to).toBe(last.id);
  expect((await saved(page)).storyFlow.edges.find((e:any)=>e.id===connection.id).crossfade).toBe(.375);await expect(page.locator('.story-wire')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await saved(page)).storyFlow.edges.find((e:any)=>e.id===connection.id).to).toBe(middle.id);
});
test('reroute points reshape wires, cancel cleanly, and support keyboard and context-menu editing',async({page})=>{
  const project=await open(page),link=project.storyFlow.edges[0],root=page.locator(`[data-edge-id="${link.id}"]`),path=root.locator('.story-edge-hit');
  const point=await path.evaluate(el=>{const p=(el as SVGPathElement).getPointAtLength((el as SVGPathElement).getTotalLength()*.25),m=(el as SVGPathElement).getScreenCTM()!;return {x:p.x*m.a+m.e,y:p.y*m.d+m.f};});
  await page.mouse.dblclick(point.x,point.y);await expect(root.locator('.story-reroute')).toHaveCount(1);
  const before=(await saved(page)).storyFlow.edges.find((e:any)=>e.id===link.id),circle=`[data-edge-id="${link.id}"] .story-reroute`;
  await drag(page,circle,{x:point.x+40,y:point.y-60});const moved=(await saved(page)).storyFlow.edges.find((e:any)=>e.id===link.id);
  expect(moved.points[0].y).toBeLessThan(before.points[0].y);expect(moved.from).toBe(link.from);expect(moved.to).toBe(link.to);expect(moved.crossfade).toBe(link.crossfade);
  await drag(page,circle,{x:point.x+100,y:point.y+40},true);expect((await saved(page)).storyFlow.edges.find((e:any)=>e.id===link.id).points).toEqual(moved.points);
  await root.locator('.story-reroute').focus();await page.keyboard.press('Shift+ArrowDown');expect((await saved(page)).storyFlow.edges.find((e:any)=>e.id===link.id).points[0].y).toBeCloseTo(moved.points[0].y+10);
  await root.locator('.story-reroute').click({button:'right'});await page.getByRole('menuitem',{name:'Remove reroute point',exact:true}).click();await expect(root.locator('.story-reroute')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(root.locator('.story-reroute')).toHaveCount(1);
  await path.focus();expect(await path.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
  await page.screenshot({path:'test-results/connection-reroute.png',fullPage:true});
});
test('the fade icon opens a hidden or collapsed inspector without adding clips or a bounding outline',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Collapse Inspector panel',exact:true}).click();
  const fade=page.locator('.story-crossfade').first();await fade.click();await expect(page.getByLabel('Crossfade duration')).toBeVisible();await expect(page.locator('.story-clip')).toHaveCount(3);
  await page.locator('.panel-workspace-menu summary').click();await page.locator('.panel-workspace-menu').getByRole('button',{name:/Inspector$/}).click();await page.locator('.panel-workspace-menu summary').click();
  await expect(page.locator('[data-panel-id=inspector]')).toHaveCount(0);await fade.click();await expect(page.getByLabel('Crossfade duration')).toBeVisible();
  await fade.focus();expect(await fade.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');await expect(fade.locator('.fade-ramp')).toHaveCount(2);
  await page.locator('.story-clip-title').first().click();await expect(page.getByLabel('Crossfade duration')).toHaveCount(0);await expect(page.locator('.story-fade,.story-fade-handle')).toHaveCount(0);
});

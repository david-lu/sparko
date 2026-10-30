import { test, expect, type Page } from './fixtures';
const open=async(page:Page)=>{await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const saved=(page:Page)=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sparko-projects');r.onsuccess=()=>resolve(r.result);});const all=await new Promise<any[]>(resolve=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return all.find(p=>p.id.startsWith('draft:'));});
const split=async(page:Page)=>{await page.getByRole('slider',{name:/Scrub/}).first().focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await expect(page.locator('.story-clip')).toHaveCount(2);};
const drag=async(page:Page,from:{x:number;y:number},to:{x:number;y:number},button:'left'|'middle'='left')=>{await page.mouse.move(from.x,from.y);await page.mouse.down({button});await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up({button});};

test('clips move past zero in both directions, and cleanup keeps routes and media with one undo',async({page})=>{
  await open(page);await split(page);const original=await saved(page),id=original.storyFlow.entryId;
  const view=(await page.locator('.story-scroll').boundingBox())!;
  await drag(page,{x:view.x+600,y:view.y+50},{x:view.x+950,y:view.y+150},'middle');
  const title=(await page.locator(`[data-node-id="${id}"] .story-clip-title`).boundingBox())!;
  await drag(page,{x:title.x+15,y:title.y+10},{x:title.x-285,y:title.y-140});
  await expect.poll(async()=>(await saved(page)).storyFlow.nodes.find((n:any)=>n.id===id).x).toBeLessThan(0);
  await expect.poll(async()=>(await saved(page)).storyFlow.nodes.find((n:any)=>n.id===id).y).toBeLessThan(0);
  const moved=(await saved(page)).storyFlow;expect(moved.edges).toEqual(original.storyFlow.edges);
  await page.locator('.story-scroll').click({button:'right',position:{x:15,y:15}});await expect(page.getByRole('menu',{name:'Timeline actions'})).toBeVisible();await page.getByRole('menuitem',{name:/Clean up layout/}).click();
  await expect.poll(async()=>(await saved(page)).storyFlow.nodes.find((n:any)=>n.id===id).x).toBeGreaterThanOrEqual(0);
  const cleaned=(await saved(page)).storyFlow;expect(cleaned.edges).toEqual(moved.edges);expect(cleaned.nodes.map((n:any)=>n.source)).toEqual(moved.nodes.map((n:any)=>n.source));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await saved(page)).storyFlow.nodes).toEqual(moved.nodes);
});

test('box selection moves clips together, Escape cancels, background clicks deselect, and text stays unselected',async({page})=>{
  await open(page);await split(page);await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const boxes=await page.locator('.story-clip').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const from={x:Math.min(...boxes.map(r=>r.x))-15,y:Math.min(...boxes.map(r=>r.y))-15},to={x:Math.max(...boxes.map(r=>r.x+r.width))+15,y:Math.max(...boxes.map(r=>r.y+r.height))+15};
  await drag(page,from,to);await expect(page.locator('.story-clip.selected')).toHaveCount(2);expect(await page.evaluate(()=>window.getSelection()?.toString())).toBe('');
  const before=(await saved(page)).storyFlow.nodes,title=(await page.locator('.story-clip-title').first().boundingBox())!;
  await drag(page,{x:title.x+15,y:title.y+10},{x:title.x+55,y:title.y+30});
  await expect.poll(async()=>(await saved(page)).storyFlow.nodes[0].x).not.toBe(before[0].x);
  const after=(await saved(page)).storyFlow.nodes;expect(after[0].x-before[0].x).toBe(after[1].x-before[1].x);expect(after[0].y-before[0].y).toBe(after[1].y-before[1].y);
  await page.keyboard.press('Shift+F');await expect(page.locator('.story-clip.selected')).toHaveCount(2);
  await page.locator('.story-scroll').click({position:{x:15,y:15}});await expect(page.locator('.story-clip.selected')).toHaveCount(0);await expect(page.getByRole('button',{name:'Fit selected',exact:true})).toBeDisabled();
  await page.locator('.story-clip-title').first().click();await expect(page.locator('.story-clip.selected')).toHaveCount(1);
  const view=(await page.locator('.story-scroll').boundingBox())!;await page.mouse.move(view.x+20,view.y+40);await page.mouse.down();await page.mouse.move(view.x+view.width-20,view.y+view.height-40,{steps:8});await expect(page.locator('.story-marquee')).toBeVisible();await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.story-marquee')).toHaveCount(0);await expect(page.locator('.story-clip.selected')).toHaveCount(1);
  expect(await page.locator('.story-clip-title span').first().evaluate(el=>getComputedStyle(el).userSelect)).toBe('none');
});

test('Hand, Space and wheel pan freely; Fit all and Shift+F preserve clip height and font size',async({page})=>{
  await open(page);await split(page);await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const heights=()=>page.locator('.story-clip').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n.querySelector('.story-clip-title')!).fontSize})));
  const baseline=await heights();expect(baseline.every(v=>v.height===76)).toBe(true);
  await page.getByRole('button',{name:'Zoom in story'}).click();await page.getByRole('button',{name:'Zoom out story'}).click();expect(await heights()).toEqual(baseline);
  const view=(await page.locator('.story-scroll').boundingBox())!,first=page.locator('.story-clip').first(),before=(await first.boundingBox())!;
  await page.getByRole('button',{name:'Pan tool',exact:true}).click();await drag(page,{x:view.x+70,y:view.y+50},{x:view.x+470,y:view.y+100});expect((await first.boundingBox())!.x-before.x).toBeCloseTo(400,0);await page.keyboard.press('v');await expect(page.getByRole('button',{name:'Pan tool',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Fit all',exact:true}).click();await page.mouse.move(view.x+70,view.y+50);await page.keyboard.down('Space');await drag(page,{x:view.x+70,y:view.y+50},{x:view.x+300,y:view.y+80});await page.keyboard.up('Space');await expect(page.getByRole('button',{name:'Play video',exact:true})).toBeVisible();
  await page.mouse.move(view.x+200,view.y+80);await page.mouse.wheel(-12000,-16000);await expect.poll(async()=>(await first.boundingBox())!.x).toBeGreaterThan(10000);
  await page.getByRole('button',{name:'Fit all',exact:true}).click();const fitted=await page.locator('.story-clip').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  expect(fitted.every(r=>r.x>=view.x&&r.right<=view.x+view.width&&r.y>=view.y&&r.bottom<=view.y+view.height)).toBe(true);expect(await heights()).toEqual(baseline);
  await page.locator('.story-clip-title').first().click();await page.mouse.move(view.x+200,view.y+80);await page.mouse.wheel(20000,20000);await page.keyboard.press('Shift+F');
  const selected=(await page.locator('.story-clip.selected').boundingBox())!;expect(selected.x).toBeGreaterThanOrEqual(view.x);expect(selected.x+selected.width).toBeLessThanOrEqual(view.x+view.width);expect(await heights()).toEqual(baseline);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({path:'test-results/infinite-canvas.png',fullPage:true});
});

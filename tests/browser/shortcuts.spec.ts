import { test, expect, fitAll, type Page } from './fixtures';
const open=async(page:Page)=>{await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const camera=(page:Page)=>page.locator('.story-scroll').evaluate(el=>({position:(el as HTMLElement).style.backgroundPosition,size:(el as HTMLElement).style.backgroundSize,zoom:document.querySelector('.story-zoom')!.textContent}));
const pan=async(page:Page)=>{await page.locator('.story-scroll').hover({position:{x:20,y:20}});await page.mouse.wheel(1600,1600);await expect.poll(async()=>(await camera(page)).position).not.toBe('0px 0px');};
const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Keyboard shortcuts'});
const assign=async(page:Page,name:string,key:string)=>{await dialog(page).getByRole('button',{name:`Shortcut for ${name}`,exact:true}).click();await page.keyboard.press(key);};

test('Auto layout preserves the camera; F and Fit frame the selection or all clips without fullscreen',async({page})=>{
  await open(page);await page.locator('.story-clip-title').click();await page.keyboard.press('Control+d');await expect(page.locator('.story-clip')).toHaveCount(2);await fitAll(page);
  await page.getByRole('button',{name:'Zoom out story'}).click();await pan(page);const before=await camera(page),nodes=(await saved(page)).storyFlow.nodes;
  await page.getByRole('button',{name:'Auto layout',exact:true}).click();await expect.poll(async()=>(await saved(page)).storyFlow.nodes).not.toEqual(nodes);expect(await camera(page)).toEqual(before);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('.story-scroll').click({button:'right',position:{x:10,y:10}});await page.getByRole('menuitem',{name:/Clean up layout/}).click();expect(await camera(page)).toEqual(before);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('.story-scroll').focus();await page.keyboard.press('a');expect(await camera(page)).toEqual(before);
  await expect(page.locator('.story-clip.selected')).toHaveCount(0);await page.keyboard.press('f');const all=await camera(page);expect(all).not.toEqual(before);expect(await page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  const visible=()=>page.locator('.story-scroll').evaluate(el=>{const view=el.getBoundingClientRect();return [...el.querySelectorAll('.story-clip')].map(clip=>{const r=clip.getBoundingClientRect();return r.left>=view.left&&r.right<=view.right&&r.top>=view.top&&r.bottom<=view.bottom;});});
  expect((await visible()).every(Boolean)).toBe(true);await pan(page);await page.getByRole('button',{name:'Fit',exact:true}).click();expect(await camera(page)).toEqual(all);
  await page.locator('.story-clip-title').first().click();await pan(page);await page.keyboard.press('f');const selected=await camera(page);expect(selected).not.toEqual(all);expect((await visible())[0]).toBe(true);
  await pan(page);await page.getByRole('button',{name:'Fit',exact:true}).click();expect(await camera(page)).toEqual(selected);
  await expect(page.getByRole('button',{name:'Fit all',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Fit selected',exact:true})).toHaveCount(0);
});

for(const width of [1440,390])test(`shortcut assignments record safely, persist and reset at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});await open(page);
  const before=await page.locator('.workspace-grid').boundingBox();await page.getByRole('button',{name:'Shortcuts',exact:true}).click();await expect(dialog(page)).toBeVisible();
  await page.screenshot({path:`test-results/shortcut-settings-all-${width}.png`,fullPage:true});
  await assign(page,'Fit','c');await expect(dialog(page).getByRole('status')).toContainText('assigned to Cut tool');await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Alt+q');await expect(dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true})).toHaveText('Alt+Q');
  await assign(page,'Auto layout','a');await expect(dialog(page).getByRole('status')).toContainText('saved');
  await assign(page,'Cut tool','r');await assign(page,'Play / pause','Shift+k');await assign(page,'Duplicate selected clips','Alt+d');await assign(page,'Undo','Alt+z');
  await dialog(page).getByLabel('Filter shortcuts').fill('fit');await expect(dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true})).toBeVisible();await expect(page.locator('.story-clip')).toHaveCount(1);
  const bounds=(await dialog(page).boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(await page.locator('.workspace-grid').boundingBox()).toEqual(before);
  await page.screenshot({path:`test-results/shortcut-settings-${width}.png`,fullPage:true});
  await dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true}).click();await page.keyboard.press('Escape');await expect(dialog(page)).toBeVisible();await expect(dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true})).toHaveText('Alt+Q');await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Fit',exact:true})).toHaveAttribute('aria-keyshortcuts','Alt+Q');expect(await page.locator('.workspace-grid').boundingBox()).toEqual(before);
  await page.locator('.story-scroll').focus();await page.keyboard.press('r');await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('v');
  await page.locator('.story-clip-title').click();await page.keyboard.press('Alt+d');await expect(page.locator('.story-clip')).toHaveCount(2);await page.keyboard.press('Alt+z');await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.getByRole('button',{name:'Fit',exact:true}).click();await page.locator('.story-clip-title').click();await page.getByLabel('Clip name',{exact:true}).fill('fr');await expect(page.getByLabel('Clip name',{exact:true})).toHaveValue('fr');await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','false');await page.getByLabel('Clip name',{exact:true}).press('Enter');
  await page.locator('.story-scroll').focus();await page.keyboard.press('Shift+k');await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveCount(1);await page.keyboard.press('Shift+k');await expect(page.getByRole('button',{name:'Play video',exact:true})).toBeVisible();
  await pan(page);const displaced=await camera(page);await page.keyboard.press('f');expect(await camera(page)).toEqual(displaced);expect(await page.evaluate(()=>!!document.fullscreenElement)).toBe(false);await page.keyboard.press('Alt+q');expect(await camera(page)).not.toEqual(displaced);
  await open(page);await expect(page.getByRole('button',{name:'Fit',exact:true})).toHaveAttribute('aria-keyshortcuts','Alt+Q');await page.getByRole('button',{name:'Shortcuts',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Clear shortcut for Fit',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true})).toHaveText('Unassigned');await assign(page,'Fullscreen','f');await expect(dialog(page).getByRole('status')).toContainText('saved');
  await dialog(page).getByRole('button',{name:'Done',exact:true}).click();await page.locator('.story-scroll').focus();await page.keyboard.press('f');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();await page.getByRole('button',{name:'Shortcuts',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Reset defaults',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'Shortcut for Fit',exact:true})).toHaveText('F');await expect(dialog(page).getByRole('button',{name:'Shortcut for Fullscreen',exact:true})).toHaveText('Unassigned');
  await dialog(page).getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByRole('button',{name:'Fit',exact:true})).toHaveAttribute('aria-keyshortcuts','F');expect(errors).toEqual([]);
});

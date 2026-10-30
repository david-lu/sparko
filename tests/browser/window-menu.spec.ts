import { test, expect, type Page } from './fixtures';
import type { Locator } from '@playwright/test';

const open=async(page:Page)=>{await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const menu=(page:Page)=>page.getByRole('menu',{name:'Window',exact:true});
const showMenu=(page:Page)=>page.locator('.window-menu summary').click();
const layout=(page:Page)=>page.evaluate(()=>({panels:localStorage.getItem('sparko:panel-layout'),width:localStorage.getItem('sparko:side-width'),height:localStorage.getItem('sparko:story-height'),collapsed:localStorage.getItem('sparko:story-collapsed'),
  boxes:['.video-stage','.story-canvas','.sidebar',...Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]')).map(n=>`[data-panel-id="${n.dataset.panelId}"]`)].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})}));
const drag=async(page:Page,target:Locator,dx:number,dy:number)=>{const r=(await target.boundingBox())!;const x=r.x+r.width/2,y=r.y+r.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();};

for(const width of [1440,390])test(`Window controls panels and locks layout without blocking editing at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});await open(page);
  await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Inspector',exact:true}).click();await expect(page.locator('[data-panel-id=inspector]')).toHaveCount(0);
  await menu(page).getByRole('menuitemcheckbox',{name:'Library',exact:true}).click();await expect(page.locator('.panels-empty')).toBeVisible();
  await menu(page).getByRole('menuitemcheckbox',{name:'Timeline',exact:true}).click();await expect(page.locator('.story-scroll')).toBeHidden();
  for(const name of ['Library','Inspector','Timeline'])await menu(page).getByRole('menuitemcheckbox',{name,exact:true}).click();
  await expect(page.locator('.sidePanelSection')).toHaveCount(2);await expect(page.locator('.story-scroll')).toBeVisible();
  await page.keyboard.press('Escape');const before=await layout(page);
  await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();
  await expect(menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true})).toBeChecked();
  for(const name of ['Library','Inspector','Timeline'])await expect(menu(page).getByRole('menuitemcheckbox',{name,exact:true})).toBeDisabled();
  await expect(menu(page).getByRole('menuitem',{name:'Reset workspace',exact:true})).toBeDisabled();expect(await layout(page)).toEqual(before);
  await page.screenshot({path:`test-results/window-workspace-locked-${width}.png`,fullPage:true});await page.keyboard.press('Escape');
  const timeline=page.getByRole('separator',{name:'Resize story canvas'}),divider=page.getByRole('separator',{name:'Library and Inspector',exact:true}),side=page.getByRole('separator',{name:'Resize side panel'});
  for(const handle of [timeline,divider,...(width>660?[side]:[])]){
    await expect(handle).toHaveAttribute('aria-disabled','true');await drag(page,handle,-55,35);await handle.dispatchEvent('keydown',{key:'Home',code:'Home'});
  }
  const header=page.getByRole('button',{name:'Move Library panel',exact:true});await expect(header).toBeDisabled();await drag(page,header,-100,130);await header.dispatchEvent('keydown',{key:'ArrowDown',code:'ArrowDown',altKey:true});
  await expect(page.locator('.sidePanelInsertionIndicator')).toHaveCount(0);await header.click({button:'right',force:true});await expect(page.getByRole('menu',{name:'Panel actions'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Collapse Library panel',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Collapse timeline',exact:true})).toBeDisabled();
  await page.locator('.panel-workspace-menu summary').click();await expect(page.locator('.panel-workspace-menu').getByRole('button',{name:/Inspector$/})).toBeDisabled();await expect(page.locator('.panel-workspace-menu').getByRole('button',{name:'Reset workspace',exact:true})).toBeDisabled();await page.locator('.panel-workspace-menu summary').click();
  expect(await layout(page)).toEqual(before);
  await page.locator('.story-clip-title').click();await page.getByLabel('Clip name',{exact:true}).fill('Editing still works');await page.getByLabel('Clip name',{exact:true}).press('Enter');
  await expect(page.getByRole('slider',{name:'Scrub Editing still works',exact:true})).toBeVisible();expect(await layout(page)).toEqual(before);
  await page.getByRole('button',{name:'Play video',exact:true}).click();await page.locator('.video-stage').hover();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
  await open(page);await expect(page.getByRole('button',{name:'Collapse timeline',exact:true})).toBeDisabled();
  await page.locator('.window-menu summary').focus();await page.keyboard.press('ArrowDown');await expect(menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true})).toBeFocused();
  await page.keyboard.press('Space');await expect(menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true})).not.toBeChecked();await page.keyboard.press('Escape');
  await expect(page.locator('.window-menu summary')).toBeFocused();await expect(page.getByRole('button',{name:'Collapse timeline',exact:true})).toBeEnabled();
  const height=(await page.locator('.story-canvas').boundingBox())!.height;await timeline.press('ArrowUp');expect((await page.locator('.story-canvas').boundingBox())!.height).toBe(height+10);
  await showMenu(page);await menu(page).getByRole('menuitem',{name:'Reset workspace',exact:true}).click();await expect(page.locator('.sidePanelLane')).toHaveCount(1);expect((await page.locator('.story-canvas').boundingBox())!.height).toBe(360);
  expect(await page.evaluate(()=>localStorage.getItem('sparko:workspace-locked'))).toBe('false');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

test('locked docked columns ignore resize, balance and keyboard moves, then unlock normally',async({page})=>{
  await open(page);const header=page.getByRole('button',{name:'Move Library panel',exact:true});await header.focus();await page.keyboard.press('Alt+ArrowRight');await expect(page.locator('.sidePanelLane')).toHaveCount(2);
  const side=page.getByRole('separator',{name:'Resize side panel'});await side.press('Shift+ArrowRight');await side.press('Shift+ArrowRight');
  const divider=page.getByRole('separator',{name:'Library and Inspector columns',exact:true});await divider.press('ArrowLeft');
  const before=await layout(page);await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await page.keyboard.press('Escape');
  await expect(divider).toHaveAttribute('aria-disabled','true');await drag(page,divider,70,0);await divider.dblclick({force:true});await divider.dispatchEvent('keydown',{key:'End',code:'End'});
  await header.dispatchEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',altKey:true});await drag(page,header,-450,0);expect(await layout(page)).toEqual(before);
  await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await page.keyboard.press('Escape');
  expect(await layout(page)).toEqual(before);
  await header.focus();await page.keyboard.press('Alt+ArrowLeft');await expect(page.locator('.sidePanelLane')).toHaveCount(1);
});

test('selection respects a locked hidden inspector and collapsed timeline can be restored from Window',async({page})=>{
  await open(page);await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Inspector',exact:true}).click();await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await page.keyboard.press('Escape');
  await page.locator('.story-clip-title').click();await expect(page.locator('[data-panel-id=inspector]')).toHaveCount(0);
  await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await menu(page).getByRole('menuitemcheckbox',{name:'Timeline',exact:true}).click();await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Expand timeline',exact:true})).toBeDisabled();await open(page);await expect(page.getByRole('button',{name:'Expand timeline',exact:true})).toBeDisabled();await expect(page.locator('[data-panel-id=inspector]')).toHaveCount(0);
  await showMenu(page);await menu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();await menu(page).getByRole('menuitemcheckbox',{name:'Timeline',exact:true}).click();await menu(page).getByRole('menuitemcheckbox',{name:'Inspector',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.story-scroll')).toBeVisible();await expect(page.locator('[data-panel-id=inspector]')).toBeVisible();
});

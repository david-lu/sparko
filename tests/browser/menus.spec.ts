import { test, expect, type Page } from './fixtures';

const open=async(page:Page)=>{await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const dropdowns=(page:Page)=>page.locator('details[data-popup-menu][open]');
const contexts=(page:Page)=>page.locator('.story-context-menu,.panelContextMenu');
const trigger=(page:Page,name:string)=>page.locator('details[data-popup-menu]>summary').filter({hasText:new RegExp(`^${name}$`)});

for(const width of [1440,390])test(`menus are exclusive, dismiss consistently and preserve inspector sections at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:1000});await open(page);
  const bounds=await page.locator('.story-toolbar').boundingBox();
  for(const name of ['Interstitial','Templates','Options','Panels','File','Window','Templates','Interstitial','Panels','Options']){
    // Window covers the timeline trigger on a narrow screen; switch with the keyboard there.
    if(width===390&&name==='Templates'&&await dropdowns(page).locator('summary').textContent()==='Window'){
      await trigger(page,name).focus();await page.keyboard.press('Enter');
    }else await trigger(page,name).click();
    await expect(dropdowns(page)).toHaveCount(1);await expect(dropdowns(page).locator('summary')).toHaveText(name);await expect(contexts(page)).toHaveCount(0);
  }
  // Controls within a menu remain usable without dismissing it.
  await page.getByRole('menuitemcheckbox',{name:'Match generated framing',exact:true}).click();await expect(dropdowns(page)).toHaveCount(1);
  await trigger(page,'Options').click();await expect(dropdowns(page)).toHaveCount(0);
  for(const name of ['File','Options','Window','Panels','Interstitial','Templates']){
    await trigger(page,name).focus();await page.keyboard.press('Enter');await expect(dropdowns(page)).toHaveCount(1);
    await page.keyboard.press('Escape');await expect(dropdowns(page)).toHaveCount(0);await expect(trigger(page,name)).toBeFocused();
  }
  await trigger(page,'Templates').click();await page.locator('.menu-app-name').click();await expect(dropdowns(page)).toHaveCount(0);
  await trigger(page,'Interstitial').click();await page.getByRole('button',{name:'Shortcuts',exact:true}).focus();await expect(dropdowns(page)).toHaveCount(0);
  // Named native menus remain exclusive when opened without pointer/focus events.
  await page.locator('details[data-popup-menu]').evaluateAll(elements=>{for(const el of elements)(el as HTMLDetailsElement).open=true;});await expect(dropdowns(page)).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(dropdowns(page)).toHaveCount(0);
  await trigger(page,'Templates').click();await page.locator('.story-scroll').click({button:'right',position:{x:12,y:12}});await expect(page.getByRole('menu',{name:'Timeline actions',exact:true})).toBeVisible();await expect(dropdowns(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Move Library panel',exact:true}).click({button:'right'});await expect(contexts(page)).toHaveCount(1);await expect(page.getByRole('menu',{name:'Panel actions',exact:true})).toBeVisible();
  await trigger(page,'Window').click();await expect(contexts(page)).toHaveCount(0);await expect(dropdowns(page)).toHaveCount(1);
  // Opening a context menu without a pointer event also dismisses a dropdown.
  await page.locator('.story-scroll').dispatchEvent('contextmenu',{clientX:15,clientY:650});await expect(dropdowns(page)).toHaveCount(0);await expect(contexts(page)).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(contexts(page)).toHaveCount(0);await expect(page.locator('.story-scroll')).toBeFocused();
  expect(await page.locator('.story-toolbar').boundingBox()).toEqual(bounds);
  await page.getByRole('button',{name:'Cut tool',exact:true}).click();await trigger(page,'Templates').click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Cut tool',exact:true}).click();
  await page.getByRole('button',{name:'Add interstitial',exact:true}).dragTo(page.locator('.story-scroll'),{targetPosition:{x:80,y:45}});await expect(page.locator('.story-clip')).toHaveCount(2);
  const generation=page.locator('.inspector-generation'),advanced=page.locator('.inspector-advanced');await expect(generation).toHaveAttribute('open','');await advanced.locator('summary').click();await expect(advanced).toHaveAttribute('open','');
  await trigger(page,'File').click();await trigger(page,'Window').click();await expect(generation).toHaveAttribute('open','');await expect(advanced).toHaveAttribute('open','');
  await page.getByRole('button',{name:'Shortcuts',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keyboard shortcuts'})).toBeVisible();await expect(dropdowns(page)).toHaveCount(0);await page.keyboard.press('Escape');expect(errors).toEqual([]);
});

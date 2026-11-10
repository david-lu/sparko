import {test,expect,type Page,saveSelectionAsTemplate} from './fixtures';

const open=async(page:Page)=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();
  await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
};
const showWindow=(page:Page)=>page.locator('.window-menu summary').click();
const windowMenu=(page:Page)=>page.getByRole('menu',{name:'Window',exact:true});

for(const width of [1440,390])test(`picture walkthrough reserves image space and supports zoom at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});
  let release=()=>{},requested=false;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/import.png*',async route=>{if(route.request().resourceType()==='image'){requested=true;await pending;}await route.continue();});
  await open(page);await showWindow(page);await windowMenu(page).getByRole('menuitem',{name:'Help & tutorial',exact:true}).click();
  const help=page.getByRole('dialog',{name:'Help & tutorial',exact:true}),count=help.locator('.help-step-count');
  const positions=()=>help.evaluate(root=>{
    const top=root.getBoundingClientRect().top;
    return ['.help-picture-button','.help-step-navigation','.help-footer'].map(selector=>{const box=root.querySelector(selector)!.getBoundingClientRect();return {y:box.y-top,height:box.height};});
  });
  await expect(count).toHaveText('Step 1 of 10');
  await expect(help.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
  await help.getByRole('button',{name:'Next',exact:true}).click();
  const picture=help.getByRole('button',{name:'Enlarge image: Import your video',exact:true});
  await picture.scrollIntoViewIfNeeded();await expect.poll(()=>requested).toBe(true);
  const loading=await positions();release();
  await expect.poll(()=>picture.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await positions()).toEqual(loading);
  await expect(count).toHaveText('Step 2 of 10');
  await picture.click();
  const viewer=page.getByRole('dialog',{name:'Import your video',exact:true});
  await expect(viewer.getByRole('button',{name:'Close enlarged picture',exact:true})).toBeFocused();
  await viewer.getByRole('button',{name:'Actual size',exact:true}).click();
  const stage=viewer.getByRole('region',{name:'Enlarged tutorial picture',exact:true});
  expect(await stage.locator('img').evaluate(image=>image.getBoundingClientRect().width===(image as HTMLImageElement).naturalWidth)).toBe(true);
  if(width===390){
    expect(await stage.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
    await stage.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>stage.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  }
  await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);await expect(picture).toBeFocused();
  await expect(help).toBeVisible();await expect(count).toHaveText('Step 2 of 10');
  await help.getByRole('button',{name:'Back',exact:true}).click();await expect(count).toHaveText('Step 1 of 10');
  for(let step=2;step<=10;step++){
    await help.getByRole('button',{name:'Next',exact:true}).click();await expect(count).toHaveText(`Step ${step} of 10`);
    await expect.poll(()=>help.locator('.help-picture img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect((await positions())[1]).toEqual(loading[1]);
    expect(await help.locator('article').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    if([4,6,9].includes(step))await page.screenshot({path:testInfo.outputPath(`walkthrough-${width}-step-${step}.png`)});
  }
  await help.getByRole('button',{name:'Start again',exact:true}).click();await expect(count).toHaveText('Step 1 of 10');
  await help.getByRole('button',{name:'Next',exact:true}).click();
  await picture.click();await page.getByRole('button',{name:'Close enlarged picture',exact:true}).click();await expect(picture).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

for(const width of [1440,390])test(`help opens from Window and preserves editing state at ${width}px`,async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:1000});
  await page.addInitScript(()=>localStorage.setItem('sparko:shortcuts',JSON.stringify({fit:['Alt+F']})));
  await open(page);
  const clip=page.getByRole('slider',{name:/Scrub/}).first();await clip.focus();await clip.press('ArrowRight');
  const before=await clip.getAttribute('aria-valuenow'),layout=await page.evaluate(()=>localStorage.getItem('sparko:panel-layout'));
  await showWindow(page);await windowMenu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();
  await windowMenu(page).getByRole('menuitem',{name:'Help & tutorial',exact:true}).click();
  const help=page.getByRole('dialog',{name:'Help & tutorial',exact:true});
  await expect(help).toBeVisible();await expect(help.getByRole('button',{name:'Close help',exact:true})).toBeFocused();
  await expect(page.locator('.window-menu')).not.toHaveAttribute('open','');
  await expect(help.getByRole('heading',{name:'Quick start',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath(`help-${width}.png`)});
  for(const topic of ['Timeline & connections','Generate a video','Reuse templates','Workspace & keybinds']){
    await help.getByRole('button',{name:topic,exact:false}).click();
    await expect(help.getByRole('heading',{name:topic,exact:true})).toBeVisible();
    expect(await help.locator('article').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  }
  await expect(help.locator('dl').getByText('Alt+F',{exact:true})).toBeVisible();await expect(help.getByText('Options → Keybinds',{exact:true})).toBeVisible();
  await help.locator('article').focus();await page.keyboard.press('s');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(help).toHaveCount(0);
  await expect(page.locator('.window-menu summary')).toBeFocused();
  await expect(clip).toHaveAttribute('aria-valuenow',before!);
  expect(await page.evaluate(()=>localStorage.getItem('sparko:panel-layout'))).toBe(layout);
  await showWindow(page);await windowMenu(page).getByRole('menuitem',{name:'Help & tutorial',exact:true}).click();
  await help.getByRole('button',{name:'Back to editor',exact:true}).click();await expect(help).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

test('Add clips has its own search, saved templates, and independent panel controls',async({page},testInfo)=>{
  await open(page);
  const library=page.getByRole('region',{name:'Asset library'}),create=page.getByRole('region',{name:'Videos and templates'});
  await expect(library.getByRole('button',{name:'Add video',exact:true})).toHaveCount(0);
  await expect(library.getByRole('button',{name:/Add template/})).toHaveCount(0);
  await library.getByLabel('Search library').fill('no matching media');
  await create.getByLabel('Search videos and templates').fill('loop');
  await expect(create.getByRole('button')).toHaveCount(1);await expect(create.getByRole('button',{name:'Add template Loop until ready',exact:true})).toBeVisible();
  await create.getByLabel('Search videos and templates').fill('no matching template');await expect(create.getByText('No matching videos or templates.')).toBeVisible();
  await create.getByLabel('Search videos and templates').fill('');
  const add=create.getByRole('button',{name:'Add video',exact:true});await add.focus();await add.press('Enter');
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await saveSelectionAsTemplate(page);await page.getByLabel('Template name',{exact:true}).fill('My saved scene');await page.getByRole('button',{name:'Save template',exact:true}).click();
  await create.getByLabel('Search videos and templates').fill('My saved scene');
  const savedTemplate=create.getByRole('button',{name:'Add template My saved scene',exact:true});await expect(savedTemplate).toBeVisible();await savedTemplate.focus();await savedTemplate.press('Enter');await expect(page.locator('.story-clip')).toHaveCount(3);
  await page.getByRole('button',{name:'Move Add clips panel',exact:true}).focus();await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.sidePanelLane')).toHaveCount(2);
  await page.getByRole('button',{name:'Collapse Add clips panel',exact:true}).click();await expect(create).toBeHidden();
  await showWindow(page);await windowMenu(page).getByRole('menuitemcheckbox',{name:'Add clips',exact:true}).click();await expect(page.locator('[data-panel-id=create]')).toHaveCount(0);
  await expect(library).toBeVisible();await windowMenu(page).getByRole('menuitemcheckbox',{name:'Add clips',exact:true}).click();await page.keyboard.press('Escape');
  await expect(create).toBeVisible();await expect(create.getByRole('button',{name:'Add video',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('add-clips-docked.png')});
});

for(const locked of [false,true])test(`existing workspace layout gains Add clips without resetting preferences (locked: ${locked})`,async({page})=>{
  const saved={panels:[{id:'inspector',lane:0,visible:false,collapsed:true,size:.6},{id:'library',lane:1,visible:true,collapsed:false,size:.4}],columns:[40,60]};
  await page.addInitScript(({saved,locked})=>{localStorage.setItem('sparko:panel-layout',JSON.stringify(saved));localStorage.setItem('sparko:workspace-locked',String(locked));},{saved,locked});
  await open(page);
  const layout=await page.evaluate(()=>JSON.parse(localStorage.getItem('sparko:panel-layout')!));
  expect(layout.panels.filter((panel:{id:string})=>panel.id!=='create')).toEqual(saved.panels);expect(layout.columns).toEqual(saved.columns);
  expect(layout.panels.find((panel:{id:string})=>panel.id==='create')).toMatchObject({lane:1,visible:!locked,collapsed:false});
  await expect(page.locator('[data-panel-id=inspector]')).toHaveCount(0);
  await showWindow(page);if(locked)await windowMenu(page).getByRole('menuitemcheckbox',{name:'Lock workspace',exact:true}).click();
  await windowMenu(page).getByRole('menuitemcheckbox',{name:'Add clips',exact:true}).click();
  await expect(page.locator('[data-panel-id=create]')).toHaveCount(locked?1:0);
});

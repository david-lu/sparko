import { test, expect, type Page } from './fixtures';

const open=async(page:Page)=>{
  await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();
  await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);
};
const view=(page:Page)=>page.locator('.story-scroll').evaluate(el=>({position:(el as HTMLElement).style.backgroundPosition,zoom:document.querySelector('.story-zoom')!.textContent,selected:[...el.querySelectorAll('.story-clip.selected')].map(n=>n.getAttribute('data-node-id'))}));

for(const width of [1440,390])test(`timeline collapses without losing its view and remembers the workspace preference at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:1000});await open(page);
  const canvas=page.locator('.story-canvas'),scroll=page.locator('.story-scroll'),film=page.locator('.story-filmstrip'),stage=page.locator('.video-stage');
  await film.focus();await page.keyboard.press('Shift+ArrowRight');await expect(film).toHaveAttribute('aria-valuenow','1');
  await page.getByRole('separator',{name:'Resize story canvas'}).press('ArrowUp');
  await page.getByRole('button',{name:'Zoom out story',exact:true}).click();await scroll.hover();await page.mouse.wheel(-140,-60);
  const before=await view(page),height=(await canvas.boundingBox())!.height,playerHeight=(await stage.boundingBox())!.height,sidebar=await page.locator('.sidebar').boundingBox();
  await page.getByRole('button',{name:'Collapse timeline',exact:true}).click();
  const expand=page.getByRole('button',{name:'Expand timeline',exact:true});await expect(expand).toHaveAttribute('aria-expanded','false');await expect(scroll).toBeHidden();
  expect((await canvas.boundingBox())!.height).toBe(33);expect((await stage.boundingBox())!.height).toBeGreaterThan(playerHeight+100);
  expect(await page.locator('.sidebar').boundingBox()).toEqual(sidebar);await expect(page.getByRole('button',{name:'Auto layout',exact:true})).toHaveCount(0);
  await expect(page.getByRole('separator',{name:'Resize story canvas'})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('sparko:story-collapsed'))).toBe('true');
  await page.screenshot({path:`test-results/timeline-collapsed-${width}.png`,fullPage:true});
  await expand.focus();await page.keyboard.press('Space');await expect(scroll).toBeVisible();
  expect((await canvas.boundingBox())!.height).toBe(height);expect(await view(page)).toEqual(before);
  await expect(film).toHaveAttribute('aria-valuenow','1');await expect(page.getByRole('button',{name:'Play video',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Collapse timeline',exact:true}).click();
  // Reopening while collapsed must defer the initial fit until the canvas has a size.
  await open(page);await expect(expand).toBeVisible();await expect(scroll).toBeHidden();await expand.click();
  await expect.poll(()=>page.locator('.story-clip').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.story-scroll')!.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom;})).toBe(true);
  await page.getByRole('button',{name:'Collapse timeline',exact:true}).click();
  await page.locator('.panel-workspace-menu summary').click();await page.getByRole('button',{name:'Reset workspace',exact:true}).click();await expect(scroll).toBeVisible();
  await expect(page.getByRole('button',{name:'Collapse timeline',exact:true})).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>localStorage.getItem('sparko:story-collapsed'))).toBe('false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

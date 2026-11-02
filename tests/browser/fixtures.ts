import type { Page } from '@playwright/test';
export { test, expect, type Page } from '@playwright/test';
export async function fitAll(page:Page){
  const canvas=page.locator('.story-scroll');
  const point=await canvas.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=8;y<r.height-8;y+=24)for(let x=8;x<r.width-8;x+=24){const hit=document.elementFromPoint(r.left+x,r.top+y);if(hit===el||hit?.classList.contains('story-world')||hit?.classList.contains('story-edges'))return {x,y};}throw new Error('No timeline background available to deselect');});
  await canvas.click({position:point});await page.getByRole('button',{name:'Fit',exact:true}).click();
}

export async function openTemplateMenu(page:Page){
  await page.locator('.story-scroll').click({button:'right',position:{x:12,y:12}});
  await page.getByRole('menuitem',{name:'Add template',exact:true}).click();
}
export async function saveSelectionAsTemplate(page:Page){
  const group=page.locator('.story-group.selected .story-group-header');
  if(await group.count())await group.click({button:'right'});
  else await page.locator('.story-clip.selected .story-clip-title').first().click({button:'right'});
  await page.getByRole('menuitem',{name:/^Save (group )?as template$/}).click();
}

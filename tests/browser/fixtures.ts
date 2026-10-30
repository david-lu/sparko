import type { Page } from '@playwright/test';
export { test, expect, type Page } from '@playwright/test';
export async function fitAll(page:Page){
  const canvas=page.locator('.story-scroll');
  const point=await canvas.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=8;y<r.height-8;y+=24)for(let x=8;x<r.width-8;x+=24){const hit=document.elementFromPoint(r.left+x,r.top+y);if(hit===el||hit?.classList.contains('story-world')||hit?.classList.contains('story-edges'))return {x,y};}throw new Error('No timeline background available to deselect');});
  await canvas.click({position:point});await page.getByRole('button',{name:'Fit',exact:true}).click();
}

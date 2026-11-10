import { openGenerationTimeline, closeGenerationTimeline, openVideo, addBridge, saveAndReopen, fitAll, test, expect, type Page } from './fixtures';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const formData=async(route:{request:()=>{postDataBuffer:()=>Buffer|null;headers:()=>Record<string,string>}})=>new Response(Uint8Array.from(route.request().postDataBuffer()!),{headers:{'Content-Type':route.request().headers()['content-type']}}).formData();
/** A native render whose saved result spans `totalDuration` seconds, references included. */
async function nativeRender(page:Page,totalDuration=5){
  let submitted=0;
  await page.route('**/api/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providers:{openai:false,gemini:false,comfy:true}}});});
  await page.route('**/api/comfy/status*',route=>{expect(new URL(route.request().url()).searchParams.has('resolution')).toBe(false);return route.fulfill({json:{ready:true}});});
  await page.route('**/api/comfy/interstitials',async route=>{
    const form=await formData(route);expect(form.get('resolution')).toBe('native');submitted++;
    await route.fulfill({status:202,json:{requestId:'native-render-job',status:'IN_QUEUE',insertion:{start:1,duration:2,totalDuration}}});
  });
  await page.route('**/api/comfy/jobs/native-render-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: refresh\ndata: {}\n\n'}));
  await page.route('**/api/comfy/jobs/native-render-job',route=>route.fulfill({json:{requestId:'native-render-job',status:'COMPLETED',videoUrl:'https://example.test/native.mp4'}}));
  await page.route('https://example.test/native.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  await openVideo(page);await addBridge(page);await page.getByLabel('Video prompt',{exact:true}).fill('Continue with fine detail');
  await expect(page.getByRole('checkbox',{name:'Enable 2K regeneration'})).toHaveCount(0);
  await page.getByRole('button',{name:'Generate',exact:true}).click();
  await expect.poll(async()=>(await saved(page)).interstitials[0].phase,{timeout:60000}).toBe('ready');expect(submitted).toBe(1);
}
const upscaleButton=(page:Page)=>page.locator('.interstitial-upscale-actions > .button');
const tabs=async(page:Page)=>{const timeline=await openGenerationTimeline(page);return Object.fromEntries(['Input','Generated','Upscaled'].map(name=>[name,timeline.locator('.generation-player-modes').getByRole('button',{name,exact:true})]));};

for(const width of [1440,390])test(`Upscale to 2K is a separate step with its own Upscaled tab and a stable layout at ${width}px`,{tag:['@generation','@slow']},async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});let complete=false,uploads=0;
  await nativeRender(page);
  const before=await tabs(page);await expect(before.Generated).toBeEnabled();await expect(before.Upscaled).toBeDisabled();await closeGenerationTimeline(page);
  await page.route('**/api/comfy/upscales/status*',route=>route.fulfill({json:{ready:true}}));
  await page.route('**/api/comfy/upscales',async route=>{
    const form=await formData(route);expect(form.get('prompt')).toBe('Continue with fine detail');expect(form.get('video')).toBeInstanceOf(File);expect(form.has('resolution')).toBe(false);uploads++;
    await route.fulfill({status:202,json:{requestId:'upscale-test-job',status:'IN_QUEUE'}});
  });
  await page.route('**/api/comfy/jobs/upscale-test-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: progress\ndata: {"type":"progress","progressDetails":{"stage":"Regenerating with H3 2K"}}\n\n'}));
  await page.route('**/api/comfy/jobs/upscale-test-job',route=>route.fulfill({json:complete?{requestId:'upscale-test-job',status:'COMPLETED',videoUrl:'https://example.test/2k.mp4'}:{requestId:'upscale-test-job',status:'IN_PROGRESS',progressDetails:{stage:'Regenerating with H3 2K'}}}));
  await page.route('https://example.test/2k.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  const controls=()=>page.locator('.interstitial-editor').evaluate(el=>{const root=el.getBoundingClientRect();return ['textarea','.generation-timeline-summary','button[type=submit]','.interstitial-upscale','.interstitial-upscale-actions > .button','.task-status'].map(selector=>{const r=el.querySelector(selector)!.getBoundingClientRect();return {top:r.top-root.top,height:r.height,width:r.width};});});
  await expect(upscaleButton(page)).toHaveText('Upscale to 2K');const idle=await controls();
  await upscaleButton(page).click();await expect.poll(()=>uploads,{timeout:60000}).toBe(1);
  await expect(page.locator('.interstitial-upscale-status')).toContainText('Regenerating with H3 2K');await expect(upscaleButton(page)).toContainText('Upscaling to 2K');
  await expect(page.getByRole('button',{name:'Cancel 2K upscale',exact:true})).toBeVisible();expect(await controls()).toEqual(idle);
  await page.locator('.interstitial-upscale').screenshot({path:`test-results/2k-upscale-running-${width}.png`});
  await expect(page.getByRole('button',{name:'Regenerate',exact:true})).toBeEnabled();
  complete=true;
  await expect.poll(async()=>(await saved(page)).interstitials[0].result?.upscaled?.assetId,{timeout:60000}).toBeTruthy();
  await expect(upscaleButton(page)).toHaveText('Upscale to 2K again');await expect(page.locator('.interstitial-upscale-status')).toContainText('Upscaled tab');
  expect(await controls()).toEqual(idle);expect(uploads).toBe(1);
  await page.locator('.interstitial-upscale').screenshot({path:`test-results/2k-upscale-ready-${width}.png`});
  const project=await saved(page);expect(project.interstitials[0]).toMatchObject({generationSettings:{resolution:'native'}});expect(project.interstitials[0].upscale).toBeUndefined();
  expect(project.interstitials[0].result.upscaled.assetId).not.toBe(project.interstitials[0].result.assetId);
  const after=await tabs(page);await after.Upscaled.click();await expect(after.Upscaled).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.generation-player-screen video')).toHaveAttribute('src',/^blob:/);await expect(page.locator('.generation-player-status')).toHaveText('',{timeout:30000});
  await expect(page.locator('.generation-lane-label').last()).toHaveText('2K audio');
  await page.screenshot({path:`test-results/2k-upscale-${width}.png`,fullPage:true});
  await after.Generated.click();await expect(after.Generated).toHaveAttribute('aria-pressed','true');await closeGenerationTimeline(page);
  await saveAndReopen(page);await fitAll(page);await page.locator('.story-clip.type-simple .story-clip-title').click();
  await expect(upscaleButton(page)).toHaveText('Upscale to 2K again');await expect((await tabs(page)).Upscaled).toBeEnabled();
});

test('unavailable 2K capability fails before upload and keeps the native render',{tag:'@generation'},async({page})=>{
  let uploads=0;await nativeRender(page);
  await page.route('**/api/comfy/upscales/status*',route=>route.fulfill({json:{ready:false,message:'Comfy is missing required 2K nodes: MinimaxHailuo03RegenerateNode.'}}));
  await page.route('**/api/comfy/upscales',route=>{uploads++;return route.abort();});
  await upscaleButton(page).click();
  await expect(page.locator('.interstitial-upscale-status')).toContainText('MinimaxHailuo03RegenerateNode');expect(uploads).toBe(0);
  await expect(upscaleButton(page)).toBeEnabled();expect((await saved(page)).interstitials[0]).toMatchObject({phase:'ready',upscale:{phase:'error'}});
  await expect((await tabs(page)).Generated).toBeEnabled();
});

test('short renders explain the official 2K minimum without blocking native generation',{tag:'@generation'},async({page})=>{
  await nativeRender(page,4);
  await expect(upscaleButton(page)).toBeDisabled();await expect(page.locator('.interstitial-upscale-status')).toContainText('4.46 seconds');
  await expect(page.getByRole('button',{name:'Regenerate',exact:true})).toBeEnabled();
});

test('Upscale to 2K is unavailable until a video has been generated',{tag:'@generation'},async({page})=>{
  await page.route('**/api/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providers:{openai:false,gemini:false,comfy:true}}});});
  await openVideo(page);await addBridge(page);
  await expect(upscaleButton(page)).toBeDisabled();await expect(page.locator('.interstitial-upscale-status')).toContainText('Generate a video first');
  await expect((await tabs(page)).Upscaled).toBeDisabled();
});

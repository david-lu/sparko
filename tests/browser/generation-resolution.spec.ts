import { openGenerationTimeline, closeGenerationTimeline, test, expect, fitAll, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const open=async(page:Page)=>{
  await page.route('**/api/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providers:{openai:false,gemini:false,comfy:true}}});});
  await page.goto('/');await expect(page.getByRole('button',{name:/^New project/})).toBeEnabled();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await page.getByRole('button',{name:'Add video',exact:true}).dragTo(page.locator('.story-crossfade'));await page.getByLabel('Video prompt',{exact:true}).fill('Continue with fine detail');
};

for(const width of [1440,390])test(`official H3 2K generation keeps loading layout stable and persists with templates at ${width}px`,{tag:['@generation','@slow']},async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});let complete=false,submitted=0,preflights=0;
  await page.route('**/api/comfy/status*',async route=>{expect(new URL(route.request().url()).searchParams.get('resolution')).toBe('2k');preflights++;await route.fulfill({json:{ready:true}});});
  await page.route('**/api/comfy/interstitials',async route=>{
    const form=await new Response(Uint8Array.from(route.request().postDataBuffer()!),{headers:{'Content-Type':route.request().headers()['content-type']}}).formData();
    expect(form.get('resolution')).toBe('2k');expect(form.has('width')).toBe(false);expect(form.get('video')).toBeInstanceOf(File);submitted++;
    await route.fulfill({status:202,json:{requestId:'resolution-test-job',status:'IN_QUEUE',insertion:{start:1,duration:2,totalDuration:4}}});
  });
  await page.route('**/api/comfy/jobs/resolution-test-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: progress\ndata: {"type":"progress","progressDetails":{"stage":"Regenerating with H3 2K"}}\n\n'}));
  await page.route('**/api/comfy/jobs/resolution-test-job',route=>route.fulfill({json:complete?{requestId:'resolution-test-job',status:'COMPLETED',videoUrl:'https://example.test/2k.mp4'}:{requestId:'resolution-test-job',status:'IN_PROGRESS',progressDetails:{stage:'Regenerating with H3 2K'}}}));
  await page.route('https://example.test/2k.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  await open(page);const resolution=page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true});await expect(resolution).not.toBeChecked();await resolution.check();
  const controls=()=>page.locator('.interstitial-editor').evaluate(el=>{const root=el.getBoundingClientRect();return ['textarea','.interstitial-resolution','.generation-timeline-summary','button[type=submit]','.task-status'].map(selector=>{const r=el.querySelector(selector)!.getBoundingClientRect();return {top:r.top-root.top,height:r.height};});});
  const before=await controls();await page.getByRole('button',{name:'Generate',exact:true}).click();await expect.poll(()=>submitted,{timeout:60000}).toBe(1);expect(preflights).toBe(1);
  await expect(page.locator('.generation-feedback,.task-status').last()).toContainText('Regenerating with H3 2K');expect(await controls()).toEqual(before);
  await expect(resolution).toBeEnabled();await resolution.uncheck();expect(await controls()).toEqual(before);complete=true;
  await expect.poll(async()=>(await saved(page)).interstitials[0].phase,{timeout:60000}).toBe('ready');expect(await controls()).toEqual(before);
  expect((await saved(page)).interstitials[0]).toMatchObject({resolution:'native',generationSettings:{resolution:'2k'}});expect(submitted).toBe(1);
  await resolution.check();await fitAll(page);await page.locator('.story-clip.type-simple .story-clip-title').click();await page.locator('.story-clip.type-simple').click({button:'right'});
  await page.getByRole('menuitem',{name:'Save as template',exact:true}).click();await page.getByRole('textbox',{name:'Template name',exact:true}).fill('2K scene');await page.getByRole('button',{name:'Save template',exact:true}).click();
  const project=await saved(page);expect(Object.values(project.storyFlow.templates[0].settings).every((settings:any)=>settings.resolution==='2k')).toBe(true);
  await page.getByText('File',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloading,buffer=await readFile((await download.path())!);
  await page.reload(); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled(); await page.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'2K.sparko',mimeType:'application/zip',buffer});await expect(page.locator('.story-clip')).toHaveCount(3);
  const restored=await saved(page);expect(restored.interstitials[0]).toMatchObject({resolution:'2k',generationSettings:{resolution:'2k'}});expect(Object.values(restored.storyFlow.templates[0].settings).every((settings:any)=>settings.resolution==='2k')).toBe(true);
  await page.locator('.story-clip.type-simple .story-clip-title').click();await expect(page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true})).toBeChecked();
  await page.screenshot({path:`test-results/2k-generation-${width}.png`,fullPage:true});
});

test('unavailable 2K capability fails before submission and keeps the draft editable', {tag:'@generation'},async({page})=>{
  let submitted=0;await page.route('**/api/comfy/status*',route=>route.fulfill({json:{ready:false,message:'Comfy is missing the official H3-Regenerate-2K partner node.'}}));await page.route('**/api/comfy/interstitials',route=>{submitted++;return route.abort();});
  await open(page);await page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true}).check();await page.getByRole('button',{name:'Generate',exact:true}).click();
  await expect(page.locator('.task-status')).toContainText('missing the official H3-Regenerate-2K partner node');expect(submitted).toBe(0);await expect(page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true})).toBeEnabled();
});

test('short clips explain the official 2K minimum before generation and remain available in Native',{tag:'@generation'},async({page})=>{
  let submitted=0;await page.route('**/api/comfy/interstitials',route=>{submitted++;return route.abort();});await open(page);
  await openGenerationTimeline(page);for(const side of ['start','end']) await page.getByRole('checkbox',{name:`Reference ${side} video`,exact:true}).uncheck();await page.getByLabel('Duration',{exact:true}).fill('2');await closeGenerationTimeline(page);await page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true}).check();
  await expect(page.getByRole('button',{name:'Generate',exact:true})).toBeDisabled();await expect(page.locator('.task-status')).toContainText('4.46 seconds');expect(submitted).toBe(0);
  await page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true}).uncheck();await expect(page.getByRole('button',{name:'Generate',exact:true})).toBeEnabled();
});

test('Native is the default and generates without official 2K support',{tag:'@generation'},async({page})=>{
  let submitted=0;await page.route('**/api/comfy/status*',route=>{expect(new URL(route.request().url()).searchParams.has('resolution')).toBe(false);return route.fulfill({json:{ready:true}});});
  await page.route('**/api/comfy/interstitials',async route=>{
    const form=await new Response(Uint8Array.from(route.request().postDataBuffer()!),{headers:{'Content-Type':route.request().headers()['content-type']}}).formData();expect(form.get('resolution')).toBe('native');submitted++;
    await route.fulfill({status:202,json:{requestId:'native-only-job',status:'IN_QUEUE',insertion:{start:1,duration:2,totalDuration:4}}});
  });
  await page.route('**/api/comfy/jobs/native-only-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: refresh\ndata: {}\n\n'}));
  await page.route('**/api/comfy/jobs/native-only-job',route=>route.fulfill({json:{requestId:'native-only-job',status:'COMPLETED',videoUrl:'https://example.test/native.mp4'}}));
  await page.route('https://example.test/native.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  await open(page);await expect(page.getByRole('checkbox',{name:'Enable 2K regeneration',exact:true})).not.toBeChecked();await page.getByRole('button',{name:'Generate',exact:true}).click();
  await expect.poll(async()=>(await saved(page)).interstitials[0].phase,{timeout:60000}).toBe('ready');expect(submitted).toBe(1);expect((await saved(page)).interstitials[0].generationSettings.resolution).toBe('native');
});

import {test,expect,openVideo,addBridge,readProject,saveAndReopen} from './fixtures';

for(const width of [1440,390]) test(`separate neutral mask editors preserve pins, handles, and independent settings at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openVideo(page);await addBridge(page);
  const item=async()=>(await readProject(page)).interstitials[0];
  const previews=page.locator('.mask-curve-preview');await expect(previews).toHaveCount(2);
  const positions=()=>page.locator('.interstitial-editor').evaluate(root=>{
    const top=root.getBoundingClientRect().top;
    return ['.mask-curve-control','.interstitial-resolution','.interstitial-time-fields','button[type=submit]','.task-status'].map(selector=>{
      const box=root.querySelector(selector)!.getBoundingClientRect();return {y:box.top-top,height:box.height};
    });
  });
  const before=await positions();
  await page.getByRole('button',{name:'Edit video mask',exact:true}).click();
  const video=page.getByRole('dialog',{name:'Video mask editor',exact:true});await expect(video).toBeVisible();
  await expect(video.locator('.mask-curve-line')).toHaveCount(1);
  await expect(video.getByRole('button',{name:'Audio',exact:true})).toHaveCount(0);
  await video.getByRole('button',{name:'Add keyframe',exact:true}).click();
  await video.getByLabel('Keyframe regeneration',{exact:true}).fill('35');
  await video.getByLabel('Keyframe time',{exact:true}).fill('0.75');
  await video.getByLabel('Mask curve interpolation',{exact:true}).selectOption('bezier');
  const handle=video.getByRole('button',{name:'Video start keyframe 2 out handle',exact:true});
  await handle.focus();await page.keyboard.press('ArrowUp');
  await video.getByRole('button',{name:'Start',exact:true}).click();
  const box=(await handle.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+10,box.y+box.height/2-12,{steps:4});await page.mouse.up();
  await expect(video.getByLabel('Mask curve interpolation')).toHaveValue('bezier');
  await page.screenshot({path:`test-results/video-mask-editor-${width}.png`});
  await video.getByRole('button',{name:'Apply video mask',exact:true}).click();
  const withVideo=await item();expect(withVideo.audioMaskCurve).toBeUndefined();
  expect(withVideo.videoMaskCurve.interpolation).toBe('bezier');
  expect(withVideo.videoMaskCurve.start[1].strength).toBe(.35);
  expect(withVideo.videoMaskCurve.start[1].out.strength).toBeGreaterThan(.36);
  expect(await positions()).toEqual(before);
  await expect(page.getByRole('button',{name:'Edit video mask',exact:true})).toBeFocused();

  await page.getByRole('button',{name:'Edit audio mask',exact:true}).click();
  const audio=page.getByRole('dialog',{name:'Audio mask editor',exact:true});await expect(audio.locator('.mask-curve-line')).toHaveCount(1);
  await audio.getByRole('button',{name:'Add keyframe',exact:true}).click();
  await audio.getByLabel('Keyframe regeneration').fill('80');
  await audio.getByLabel('Mask curve interpolation').selectOption('smooth');
  await audio.getByRole('button',{name:'Delete keyframe',exact:true}).click();
  await audio.getByRole('button',{name:'Undo mask edit',exact:true}).click();
  await page.screenshot({path:`test-results/audio-mask-editor-${width}.png`});
  await audio.getByRole('button',{name:'Apply audio mask',exact:true}).click();
  const saved=await item();expect(saved.videoMaskCurve).toEqual(withVideo.videoMaskCurve);
  expect(saved.audioMaskCurve).toMatchObject({interpolation:'smooth'});
  expect(saved.audioMaskCurve.start.some((pin:{strength:number})=>pin.strength===.8)).toBe(true);

  await page.getByRole('button',{name:'Edit video mask',exact:true}).click();
  await video.getByRole('button',{name:'Reset video',exact:true}).click();
  await video.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await item()).videoMaskCurve).toEqual(saved.videoMaskCurve);
  await saveAndReopen(page);await page.locator('.story-clip.type-simple .story-clip-title').click();
  expect((await item()).audioMaskCurve).toEqual(saved.audioMaskCurve);expect((await item()).videoMaskCurve).toEqual(saved.videoMaskCurve);
  await page.getByRole('button',{name:'Edit audio mask',exact:true}).click();
  await audio.getByRole('button',{name:'End',exact:true}).click();
  const boundary=audio.getByRole('button',{name:'Audio end keyframe 1',exact:true});await boundary.focus();
  await expect(audio.getByLabel('Keyframe regeneration')).toBeDisabled();
  await expect(audio.getByRole('button',{name:'Delete keyframe',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await audio.locator('.mask-graph-editor').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(audio).toHaveCount(0);
  expect(errors).toEqual([]);
});

for(const width of [1440,390]) test(`custom masks submit independently and keep controls stable through generation at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.route('**/api/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providers:{openai:false,gemini:false,comfy:true}}});});
  await page.route('**/api/comfy/status*',route=>route.fulfill({json:{ready:true}}));
  let submitted:Record<string,unknown>|undefined,complete=false;
  await page.route('**/api/comfy/interstitials',async route=>{
    const form=await new Response(Uint8Array.from(route.request().postDataBuffer()!),{headers:{'Content-Type':route.request().headers()['content-type']}}).formData();
    submitted={videoMaskCurve:JSON.parse(String(form.get('videoMaskCurve'))),audioMaskCurve:form.get('audioMaskCurve')};
    await route.fulfill({status:202,json:{requestId:'mask-curve-test-job',status:'IN_QUEUE',insertion:{start:1,duration:2,totalDuration:4}}});
  });
  await page.route('**/api/comfy/jobs/mask-curve-test-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: progress\ndata: {"type":"progress","progress":0.5}\n\n'}));
  await page.route('**/api/comfy/jobs/mask-curve-test-job',route=>route.fulfill({json:complete
    ?{requestId:'mask-curve-test-job',status:'COMPLETED',videoUrl:'https://example.test/mask.mp4',insertion:{start:1,duration:2,totalDuration:4}}
    :{requestId:'mask-curve-test-job',status:'IN_PROGRESS'}}));
  await page.route('https://example.test/mask.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  await openVideo(page);await addBridge(page);await page.getByLabel('Interstitial prompt',{exact:true}).fill('Continue moving forward.');
  await page.getByRole('button',{name:'Edit video mask',exact:true}).click();
  await page.getByRole('button',{name:'Add keyframe',exact:true}).click();await page.getByLabel('Keyframe regeneration').fill('45');
  await page.getByRole('button',{name:'Apply video mask',exact:true}).click();
  const curve=(await readProject(page)).interstitials[0].videoMaskCurve;
  const positions=()=>page.locator('.interstitial-editor').evaluate(root=>{const top=root.getBoundingClientRect().top;return ['.mask-curve-control','.interstitial-resolution','button[type=submit]','.task-status'].map(selector=>{const box=root.querySelector(selector)!.getBoundingClientRect();return {y:box.top-top,height:box.height};});});
  const idle=await positions();await page.getByRole('button',{name:'Generate',exact:true}).click();
  // Preparing real reference media takes longer on CI's software renderer.
  await expect.poll(()=>submitted,{timeout:60000}).toBeTruthy();expect(submitted).toEqual({videoMaskCurve:curve,audioMaskCurve:null});expect(await positions()).toEqual(idle);
  await page.getByRole('button',{name:'Edit audio mask',exact:true}).click();await expect(page.getByRole('dialog',{name:'Audio mask editor'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();complete=true;
  await expect.poll(async()=>(await readProject(page)).interstitials[0].phase,{timeout:60000}).toBe('ready');
  expect(await positions()).toEqual(idle);expect((await readProject(page)).interstitials[0].generationSettings.videoMaskCurve).toEqual(curve);
});

import {test,expect,type Page} from './fixtures';
import {readFile} from 'node:fs/promises';
const open=async(page:Page)=>{await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1,{timeout:60000});};
const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});

test('source clips split, insert, scrub, connect and retain independent fades through undo',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  expect(await page.locator('.timeline-pin').count()).toBe(0);
  const source=page.getByRole('slider',{name:/Scrub/}).first();await source.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('s');await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('button',{name:/Edit crossfade from/}).click();await page.getByRole('button',{name:'Insert simple interstitial',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(3);
  await expect(page.getByLabel('Crossfade duration',{exact:true})).toHaveCount(0);await expect(page.locator('.story-fade,.story-fade-handle')).toHaveCount(0);
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  await page.locator('.story-crossfade').first().click();await page.getByLabel('Crossfade duration',{exact:true}).fill('0.25');
  await page.locator('.story-crossfade').last().click();await page.getByLabel('Crossfade duration',{exact:true}).fill('0.75');
  let project=await saved(page);expect(project.storyFlow.edges.map((e:any)=>e.crossfade)).toEqual([.25,.75]);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await page.getByRole('button',{name:'Duplicate selected clips',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(4);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(3);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(4);
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const scale=await page.locator('.story-clip').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,duration:Number(n.getAttribute('data-duration'))})));const ratios=scale.map(n=>n.width/n.duration);expect(Math.max(...ratios)-Math.min(...ratios)).toBeLessThan(.1);
  await page.screenshot({path:'test-results/story-flow-desktop.png',fullPage:true});expect(errors).toEqual([]);
});

test('templates insert ordinary clips, routing stays editable, and selections can become templates',async({page})=>{
  await open(page);await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();await page.locator('.story-menu-popover').getByRole('button',{name:/Question & response/}).dragTo(page.locator('.story-scroll'),{force:true,targetPosition:{x:250,y:80}});await page.getByRole('button',{name:'Fit all',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(5);
  expect(await page.locator('.timeline-interstitial-group').count()).toBe(0);
  const conditional=page.locator('.story-clip.type-conditional');await conditional.locator('.story-clip-title').click();
  await expect(page.getByLabel('Interstitial type',{exact:true})).toHaveValue('conditional');await page.getByLabel('Choice 1 label',{exact:true}).fill('Absolutely');
  await page.getByLabel('Conditional fallback',{exact:true}).selectOption('');
  let project=await saved(page);expect(project.storyFlow.edges.some((e:any)=>e.label==='Absolutely')).toBe(true);
  await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();await page.getByRole('button',{name:'Save selected clips as template'}).click();await page.getByLabel('Template name',{exact:true}).fill('Custom choice');await page.getByRole('button',{name:'Save template',exact:true}).click();
  project=await saved(page);expect(project.storyFlow.templates[0].name).toBe('Custom choice');
  await page.getByRole('button',{name:'Fit all',exact:true}).click();await page.screenshot({path:'test-results/story-flow-template.png',fullPage:true});
});

test('narrow layout and loading keep graph and inspector controls in place',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await page.locator('.story-menu summary').filter({hasText:'Interstitial'}).click();await page.getByRole('button',{name:/Simple Play once/}).dragTo(page.locator('.story-scroll'),{force:true,targetPosition:{x:220,y:90}});
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const before=await page.locator('.story-toolbar').boundingBox();
  const counts=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));expect(counts.width).toBeLessThanOrEqual(counts.viewport);
  await page.screenshot({path:'test-results/story-flow-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);const after=await page.locator('.story-toolbar').boundingBox();expect(after?.y).toBe(before?.y);
});

test('connected generation uses clip references, keeps controls stable, and reopens with media and fades',async({page,browser})=>{
  await page.route('**/api/status',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),providers:{openai:false,gemini:false,comfy:true}}});});
  await page.route('**/api/comfy/status',route=>route.fulfill({json:{ready:true}}));
  let complete=false,submitted=0;
  await page.route('**/api/comfy/interstitials',async route=>{submitted++;const form=await new Response(Uint8Array.from(route.request().postDataBuffer()!),{headers:{'Content-Type':route.request().headers()['content-type']}}).formData();expect(form.get('mode')).toBe('extend');expect(Number(form.get('before'))).toBeGreaterThanOrEqual(1.625);await route.fulfill({status:202,json:{requestId:'story-test-job',status:'IN_QUEUE',insertion:{start:1,duration:2,totalDuration:4}}});});
  await page.route('**/api/comfy/jobs/story-test-job/events',route=>route.fulfill({contentType:'text/event-stream',body:'event: progress\ndata: {"type":"progress","progress":0.5,"progressDetails":{"stage":"Generating","step":1,"steps":2}}\n\n'}));
  await page.route('**/api/comfy/jobs/story-test-job',route=>route.fulfill({json:complete?{requestId:'story-test-job',status:'COMPLETED',videoUrl:'https://example.test/story.mp4',insertion:{start:1,duration:2,totalDuration:4}}:{requestId:'story-test-job',status:'IN_PROGRESS',progress:.5}}));
  await page.route('https://example.test/story.mp4',route=>route.fulfill({contentType:'video/mp4',path:'tests/fixtures/interstitial-reference.mp4'}));
  await open(page);await page.setViewportSize({width:390,height:844});
  const source=page.getByRole('slider',{name:/Scrub/}).first();await source.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await page.getByRole('button',{name:/Edit crossfade from/}).click();await page.getByRole('button',{name:'Insert simple interstitial',exact:true}).click();await page.getByLabel('Interstitial prompt',{exact:true}).fill('Continue the scene');
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  await page.locator('.story-crossfade').first().click();await page.getByLabel('Crossfade duration',{exact:true}).fill('0.25');
  await page.locator('.story-crossfade').last().click();await page.getByLabel('Crossfade duration',{exact:true}).fill('0.5');
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  const controls=()=>page.evaluate(()=>{const root=document.querySelector('.interstitial-editor')!.getBoundingClientRect();return ['textarea','.interstitial-time-fields','button[type=submit]','.task-status'].map(s=>{const r=document.querySelector('.interstitial-editor '+s)!.getBoundingClientRect();return {y:r.top-root.top,height:r.height};});});
  const libraryControls=()=>page.locator('.asset-library').evaluate(el=>{const root=el.getBoundingClientRect();return ['.library-toolbar','.library-filter','.library-preview'].map(selector=>{const rect=el.querySelector(selector)!.getBoundingClientRect();return {y:rect.top-root.top,height:rect.height};});});
  const libraryBefore=await libraryControls();
  const placeholder=page.locator('.story-clip.type-simple .story-unavailable-thumbnail');await expect(placeholder).toHaveAttribute('aria-label','Video unavailable: not generated yet');
  await expect(page.locator('.story-clip.type-simple .video-filmstrip')).toHaveCount(0);const draftHeight=(await page.locator('.story-clip.type-simple').boundingBox())!.height;
  const before=await controls();await page.getByRole('button',{name:'Generate',exact:true}).click();await expect.poll(()=>submitted,{timeout:60000}).toBe(1);
  await expect(page.locator('.story-clip .timeline-generation-spinner')).toHaveCount(1);expect(await controls()).toEqual(before);
  await expect(placeholder).toHaveCount(1);expect((await page.locator('.story-clip.type-simple').boundingBox())!.height).toBe(draftHeight);
  expect(await libraryControls()).toEqual(libraryBefore);
  complete=true;await expect.poll(async()=>(await saved(page)).interstitials[0].phase,{timeout:60000}).toBe('ready');expect(await controls()).toEqual(before);
  await expect(page.getByRole('region',{name:'Video breakdown'})).toContainText('Generated section');
  expect(await libraryControls()).toEqual(libraryBefore);
  const generated=page.locator('.story-clip.type-simple');await expect(generated).toHaveAttribute('data-duration','2');
  await expect(placeholder).toHaveCount(0);await expect(generated.locator('.video-filmstrip img').first()).toBeVisible();expect((await generated.boundingBox())!.height).toBe(draftHeight);
  await expect(generated).toHaveAttribute('data-media-duration','4');await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const sections=await generated.evaluate(el=>{const r=el.querySelector('.story-reference-section')!,g=el.querySelector('.story-generated-section')!;return {reference:r.getBoundingClientRect().width,generated:g.getBoundingClientRect().width,referenceColor:getComputedStyle(r).backgroundColor,generatedColor:getComputedStyle(g).backgroundColor,height:el.getBoundingClientRect().height};});
  expect(sections.reference/sections.generated).toBeCloseTo(.5,1);expect(sections.referenceColor).not.toBe(sections.generatedColor);expect(sections.height).toBe(76);
  await generated.locator('.story-filmstrip').focus();await page.keyboard.press('Home');expect(await generated.locator('.story-playhead').evaluate(el=>(el as HTMLElement).style.left)).toBe('25%');
  await page.locator('.story-clip.type-source .story-clip-title').first().click();await page.getByLabel('Source out',{exact:true}).fill('1.75');
  const warning=page.locator('.story-edge.reference-mismatch');await expect(warning).toHaveCount(1);await warning.locator('.story-crossfade').click();
  expect(await warning.locator('.story-edge-line').evaluate(el=>getComputedStyle(el).stroke)).toBe('rgb(241, 124, 118)');
  await expect(page.getByLabel('Reference matching')).toContainText('Reference mismatch');await expect(page.getByLabel('Reference matching')).toContainText('Playback still works');
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Fit all',exact:true}).click();await page.screenshot({path:'test-results/reference-mismatch.png',fullPage:true});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-edge.reference-mismatch')).toHaveCount(0);
  await generated.locator('.story-clip-title').click();await page.getByRole('region',{name:'Video breakdown'}).scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/generated-reference-sections.png',fullPage:true});
  await page.locator('summary').filter({hasText:/^File$/}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloadEvent;
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000'}),restored=await context.newPage();const errors:string[]=[];restored.on('pageerror',e=>errors.push(e.message));await restored.goto('/');
  await restored.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'story.sparko',mimeType:'application/zip',buffer:await readFile((await download.path())!)});
  await expect(restored.locator('.story-clip')).toHaveCount(3,{timeout:60000});await restored.locator('.story-clip.type-simple .story-clip-title').click();
  expect((await saved(restored)).storyFlow.edges.map((e:any)=>e.crossfade)).toEqual([.25,.5]);
  const breakdown=restored.getByRole('region',{name:'Video breakdown'});await expect(breakdown).toContainText('0.000 s – 1.000 s');await expect(breakdown).toContainText('1.000 s – 3.000 s');await expect(breakdown).toContainText('3.000 s – 4.000 s');
  await expect(restored.getByLabel('Crossfade duration',{exact:true})).toHaveCount(0);await expect(restored.locator('.story-clip.type-simple')).toHaveAttribute('data-duration','2');expect(errors).toEqual([]);
  await restored.getByRole('slider',{name:'Scrub New scene',exact:true}).focus();await restored.keyboard.press('ArrowRight');await restored.keyboard.press('Space');await expect(restored.locator('.story-playhead')).toBeVisible();
  await context.close();
});

test('output ports attach clips and conditional choices advance real playback',async({page})=>{
  await open(page);await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();await page.locator('.story-menu-popover').getByRole('button',{name:/Question & response/}).dragTo(page.locator('.story-scroll'),{force:true,targetPosition:{x:250,y:80}});await page.getByRole('button',{name:'Fit all',exact:true}).click();
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const p=await saved(page),source=p.storyFlow.nodes.find((n:any)=>n.kind==='source'),question=p.storyFlow.nodes.find((n:any)=>n.name==='Ask a question');
  await page.locator(`[data-node-id="${source.id}"] .story-port.output`).click();await page.locator(`[data-node-id="${question.id}"] .story-port.input`).click();
  await expect.poll(async()=>(await saved(page)).storyFlow.edges.some((e:any)=>e.from===source.id&&e.to===question.id)).toBe(true);
  await page.getByRole('button',{name:'Auto layout',exact:true}).click();await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const conditional=page.locator('.story-clip.type-conditional');await conditional.locator('.story-clip-title').click();await page.getByRole('button',{name:'Choose Yes',exact:true}).click();
  const yes=p.storyFlow.nodes.find((n:any)=>n.name==='Celebrate');await expect(page.locator(`[data-node-id="${yes.id}"] .story-playhead`)).toBeVisible({timeout:15000});
  await page.keyboard.press('Space');
  await page.screenshot({path:'test-results/story-flow-connected.png',fullPage:true});
});

test('arrows drag onto clip bodies, can be redirected, and cancel without changing routes',async({page})=>{
  await open(page);await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();await page.locator('.story-menu-popover').getByRole('button',{name:/Question & response/}).dragTo(page.locator('.story-scroll'),{force:true,targetPosition:{x:250,y:80}});await page.getByRole('button',{name:'Fit all',exact:true}).click();
  await page.getByRole('separator',{name:'Resize story canvas'}).focus();await page.keyboard.press('End');
  await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const project=await saved(page),source=project.storyFlow.nodes.find((n:any)=>n.kind==='source'),question=project.storyFlow.nodes.find((n:any)=>n.name==='Ask a question'),wait=project.storyFlow.nodes.find((n:any)=>n.kind==='conditional');
  const output=page.locator(`[data-node-id="${source.id}"] .story-port.output`),destination=page.locator(`[data-node-id="${question.id}"] .story-filmstrip`);
  const start=await output.boundingBox(),end=await destination.boundingBox();
  await page.mouse.move(start!.x+start!.width/2,start!.y+start!.height/2);await page.mouse.down();await page.mouse.move(end!.x+end!.width/2,end!.y+end!.height/2,{steps:8});await expect(page.locator('.story-wire')).toBeVisible();await page.mouse.up();
  await expect.poll(async()=>(await saved(page)).storyFlow.edges.find((e:any)=>e.from===source.id)?.to).toBe(question.id);await expect(page.locator('.story-wire')).toHaveCount(0);
  await page.getByRole('button',{name:'Auto layout',exact:true}).click();await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const connection=page.getByRole('button',{name:`Connection ${source.name} to ${question.name}: Next`,exact:true});
  const point=await connection.evaluate(el=>{const path=el as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()*.25),matrix=path.getScreenCTM()!;return {x:p.x*matrix.a+p.y*matrix.c+matrix.e,y:p.x*matrix.b+p.y*matrix.d+matrix.f};});
  const target=await page.locator(`[data-node-id="${wait.id}"] .story-filmstrip`).boundingBox();
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:8});await expect(page.locator('.story-wire')).toBeVisible();await page.keyboard.press('Escape');await page.mouse.up();
  expect((await saved(page)).storyFlow.edges.find((e:any)=>e.from===source.id)?.to).toBe(question.id);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await saved(page)).storyFlow.edges.find((e:any)=>e.from===source.id)?.to).toBe(wait.id);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await saved(page)).storyFlow.edges.find((e:any)=>e.from===source.id)?.to).toBe(question.id);
});

test('clip names accept spaces, Escape cancels, and rename is one undoable edit',async({page})=>{
  await open(page);await page.locator('.story-menu summary').filter({hasText:'Interstitial'}).click();await page.getByRole('button',{name:/Simple Play once/}).dragTo(page.locator('.story-scroll'),{force:true,targetPosition:{x:220,y:90}});
  const input=page.locator('#story-clip-name');await input.fill('');await input.pressSequentially('A quiet new scene');await input.press('Enter');
  await expect(page.locator('.story-clip.type-simple .story-clip-title')).toContainText('A quiet new scene');expect((await saved(page)).interstitials[0].label).toBe('A quiet new scene');
  await input.fill('Discard this name');await input.press('Escape');await expect(input).toHaveValue('A quiet new scene');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue('New scene');expect((await saved(page)).interstitials[0].label).toBe('New scene');
});

test('the existing sample project migrates to independent filmstrip clips',async({page})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:/Sample project/}).click();
  await expect(page.locator('.story-clip').first()).toBeVisible({timeout:120000});await expect.poll(async()=>(await saved(page))?.storyFlow?.nodes.length??0).toBeGreaterThan(5);const project=await saved(page);
  expect(project.storyFlow.nodes.length).toBeGreaterThan(5);expect(project.storyFlow.nodes.some((n:any)=>n.interstitialId)).toBe(true);expect(project.storyFlow.edges.length).toBeGreaterThan(0);
  expect(await page.locator('.timeline-pin,.timeline-interstitial-group').count()).toBe(0);
  await page.getByRole('button',{name:'Fit all',exact:true}).click();await page.locator('.story-clip').first().locator('.story-filmstrip').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.story-playhead')).toBeVisible();
  await page.screenshot({path:'test-results/story-flow-sample.png',fullPage:true});expect(errors).toEqual([]);
});

test('cut tool, context menu and S split source and interstitial clips without changing the player layout',async({page})=>{
  await open(page);const stage=await page.locator('.video-stage').boundingBox(),timeline=await page.locator('.story-canvas').boundingBox();expect(stage!.y+stage!.height).toBeLessThanOrEqual(timeline!.y+1);
  await page.getByRole('button',{name:'Cut tool',exact:true}).click();await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','true');
  const film=page.locator('.story-filmstrip').first(),box=await film.boundingBox();await page.mouse.click(box!.x+box!.width/2,box!.y+box!.height/2);await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.keyboard.press('v');await expect(page.getByRole('button',{name:'Cut tool',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Add simple interstitial',exact:true}).dragTo(page.locator('.story-scroll'),{targetPosition:{x:240,y:30}});await page.getByRole('button',{name:'Fit all',exact:true}).click();
  const generated=page.locator('.story-clip.type-simple .story-filmstrip');await generated.scrollIntoViewIfNeeded();await generated.click({button:'right',position:{x:60,y:20}});await expect(page.getByRole('menu',{name:'Clip actions'})).toBeVisible();await page.getByRole('menuitem',{name:/Split here/}).click();
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(2);const project=await saved(page),parts=project.storyFlow.nodes.filter((n:any)=>n.interstitialId);expect(parts[0].trim.outFrame).toBe(parts[1].trim.inFrame);expect(parts[0].trim.inFrame).toBe(0);expect(parts[1].trim.outFrame).toBe(144);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
  await page.getByRole('slider',{name:'Scrub New scene',exact:true}).focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await expect(page.locator('.story-clip.type-simple')).toHaveCount(2);
  await page.screenshot({path:'test-results/story-flow-cut-tool.png',fullPage:true});
});

test('the side panel drops interstitials and templates onto the canvas and inserts on arrows',async({page})=>{
  await open(page);const library=page.locator('.story-library'),canvas=page.locator('.story-scroll');
  await library.getByRole('button',{name:'Add looped interstitial',exact:true}).dragTo(canvas,{targetPosition:{x:40,y:30}});await expect(page.locator('.story-clip.type-looped')).toHaveCount(1);
  let project=await saved(page);const bounds=(await canvas.boundingBox())!,loop=(await page.locator('.story-clip.type-looped').boundingBox())!;expect(loop.x-bounds.x).toBeCloseTo(40,0);expect(loop.y-bounds.y).toBeCloseTo(30,0);
  await library.getByRole('button',{name:'Add template Question & response',exact:true}).dragTo(canvas,{targetPosition:{x:250,y:100}});await expect(page.locator('.story-clip')).toHaveCount(6);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);
  const source=page.locator('.story-clip.type-source');await source.scrollIntoViewIfNeeded();await library.getByRole('button',{name:'Add simple interstitial',exact:true}).dragTo(source);await expect(page.locator('.story-clip')).toHaveCount(3);
  project=await saved(page);const sourceId=project.storyFlow.nodes.find((n:any)=>n.kind==='source').id,next=project.storyFlow.edges.find((e:any)=>e.from===sourceId);expect(next).toBeTruthy();
  await page.getByRole('button',{name:'Fit all',exact:true}).click();const insert=page.getByRole('button',{name:/Edit crossfade from/}).first();await insert.scrollIntoViewIfNeeded();await library.getByRole('button',{name:'Add conditional interstitial',exact:true}).dragTo(insert);
  await expect(page.locator('.story-clip')).toHaveCount(4);project=await saved(page);const conditional=project.storyFlow.nodes.find((n:any)=>n.kind==='conditional');expect(project.storyFlow.edges.find((e:any)=>e.from===sourceId).to).toBe(conditional.id);expect(project.storyFlow.edges.find((e:any)=>e.from===conditional.id&&e.event==='fallback').to).toBe(next.to);
  await page.screenshot({path:'test-results/story-flow-library.png',fullPage:true});
});

test('multiple videos import as independent clips and retain their assets through undo and archive reopening',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);const original=await saved(page),buffer=await readFile('tests/fixtures/interstitial-reference.mp4');
  await page.getByLabel('Import videos as clips',{exact:true}).setInputFiles([{name:'First extra video.mp4',mimeType:'video/mp4',buffer},{name:'Second extra video.mp4',mimeType:'video/mp4',buffer}]);
  await expect(page.locator('.story-clip')).toHaveCount(3);let project=await saved(page);
  expect(project.source.assetId).toBe(original.source.assetId);expect(project.storyFlow.entryId).toBe(original.storyFlow.entryId);expect(project.storyFlow.edges).toEqual(original.storyFlow.edges);
  expect(new Set(project.storyFlow.nodes.map((n:any)=>n.source.assetId)).size).toBe(3);expect(project.storyFlow.nodes.slice(1).every((n:any)=>n.kind==='source'&&n.source.duration===4)).toBe(true);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(3);
  await page.getByRole('slider',{name:'Scrub Second extra video.mp4',exact:true}).focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await expect(page.getByRole('slider',{name:'Scrub Second extra video.mp4',exact:true})).toHaveAttribute('aria-valuenow','3');
  await page.locator('summary').filter({hasText:/^File$/}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloadEvent;
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000'}),restored=await context.newPage();restored.on('pageerror',e=>errors.push(e.message));await restored.goto('/');await restored.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'Multi video.sparko',mimeType:'application/zip',buffer:await readFile((await download.path())!)});
  await expect(restored.locator('.story-clip')).toHaveCount(3,{timeout:60000});project=await saved(restored);expect(project.storyFlow.edges).toHaveLength(0);expect(new Set(project.storyFlow.nodes.map((n:any)=>n.source.assetId)).size).toBe(3);
  const extra=restored.getByRole('slider',{name:'Scrub Second extra video.mp4',exact:true});await extra.scrollIntoViewIfNeeded();await extra.focus();await restored.keyboard.press('Shift+ArrowRight');await restored.keyboard.press('Space');await expect(restored.locator('.story-clip.playing .story-playhead')).toBeVisible();await expect(extra.locator('img').first()).toBeVisible({timeout:20000});expect(errors).toEqual([]);await context.close();
});

test('dropping a video on an existing arrow imports a separate clip and a failed batch leaves the project intact',async({page})=>{
  await open(page);const source=page.getByRole('slider',{name:/Scrub/}).first();await source.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  const before=await saved(page),bytes=Array.from(await readFile('tests/fixtures/interstitial-reference.mp4'));
  const dataTransfer=await page.evaluateHandle(bytes=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(bytes)],'Dropped video.mp4',{type:'video/mp4'}));return data;},bytes);
  await page.locator('.story-edge-hit').first().dispatchEvent('drop',{dataTransfer,clientX:300,clientY:800});await expect(page.locator('.story-clip')).toHaveCount(3);
  const imported=await saved(page);expect(imported.storyFlow.edges).toEqual(before.storyFlow.edges);expect(imported.storyFlow.nodes.at(-1).name).toBe('Dropped video.mp4');
  const toolbar=await page.locator('.story-toolbar').boundingBox();await page.getByLabel('Import videos as clips',{exact:true}).setInputFiles([{name:'Valid.mp4',mimeType:'video/mp4',buffer:Buffer.from(bytes)},{name:'Invalid.mp4',mimeType:'video/mp4',buffer:Buffer.from('not video data')}]);
  await expect(page.locator('.error-banner')).toBeVisible();expect((await saved(page)).storyFlow).toEqual(imported.storyFlow);expect((await page.locator('.story-toolbar').boundingBox())?.y).toBe(toolbar?.y);
});

import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {refineAmber} from './amber.js';
import {GLTFExporter} from './vendor/GLTFExporter.js';

const $=s=>document.querySelector(s);
export const characters=[
 ['Amber','designer','#443025','#f4eee0','#c5aa8c','long','#333333','捲髮與焦糖挑染，搭配黑色棒球帽及奶油白襯衫。'],
 ['Anna','designer','#873f26','#efd14c','#45464b','long',null,'紅棕長捲髮、黑框眼鏡與黃色上衣，搭配星星牛仔褲。'],
 ['Leona','designer','#292321','#f6f2e9','#4d7398','straight',null,'黑色長直髮、白色上衣與寬版牛仔褲，帶著黃色玩偶。'],
 ['Machi','designer','#39271f','#dfb5bb','#253750','short',null,'金色挑染短髮、粉色外套與深藍寬褲，搭配黑色肩包。'],
 ['Noise','designer','#29231f','#6b9fbe','#293c60','short','#1746a0','藍色棒球帽、淺藍牛仔外套與短褲，穿著白色球鞋。'],
 ['余采馨','staff','#2c2727','#df484f','#6c91b8','bob',null,'黑色波浪短髮、紅白層次上衣與藍色牛仔褲，手提小兔。'],
 ['吳冠賢','staff','#755033','#292a2b','#29292b','spiky',null,'棕色短髮、黑紅長外套與腰帶，搭配立體小貓與手持配件。'],
 ['李明庭','staff',null,'#ffc295','#343337','bald',null,'光頭造型、赤膊與黑色寬褲，搭配黑鞋。'],
 ['廖秦葦','staff','#222126','#29282c','#d8c4a1','short',null,'黑色短髮、連帽上衣與卡其長褲，原圖中的兔子另作立體配件。'],
 ['鄭筱舢','staff','#573a30','#9cc9e5','#f5f2e9','bob',null,'棕色短髮、淺藍背心與白色寬褲，搭配黃色小包。'],
 ['黎子瑄','staff','#3d2b24','#26262a','#454447','straight',null,'深棕長髮、黑色上衣與灰色寬褲，肩上繫著格紋披衫。']
].map(([name,type,hair,shirt,pants,style,cap,description],index)=>({name,type,hair,shirt,pants,style,cap,description,index}));
const ref=(c,view)=>`./references/${c.type}_${c.name}_${view}.png`;
let renderer;
try{renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch(e){$('#canvas').textContent='無法啟用 WebGL，請使用支援 3D 的瀏覽器並開啟硬體加速。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;$('#canvas').append(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.1,100);camera.position.set(4,2.8,7);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.7,0);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=4;controls.maxDistance=12;controls.maxPolarAngle=Math.PI*.51;controls.autoRotate=!matchMedia('(prefers-reduced-motion: reduce)').matches;controls.autoRotateSpeed=1.4;$('#rotate').setAttribute('aria-pressed',String(controls.autoRotate));
scene.add(new T.HemisphereLight(0xfff8e9,0x71816b,2.5));
function light(x,y,z,color,intensity){const l=new T.DirectionalLight(color,intensity);l.position.set(x,y,z);scene.add(l);return l;}
const key=light(-3,7,5,0xffedda,2.1);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-4;key.shadow.camera.right=4;key.shadow.camera.top=5;key.shadow.camera.bottom=-4;key.shadow.normalBias=.03;light(4,4,-3,0xe9f4ff,1.5);light(1,3,6,0xffffff,1.4);
const mat=(color,roughness=.7)=>new T.MeshStandardMaterial({color,roughness});
const pedestal=new T.Mesh(new T.CylinderGeometry(1.55,1.62,.16,96),mat('#d3dbc6'));pedestal.position.y=-.12;pedestal.receiveShadow=true;scene.add(pedestal);
const ring=new T.Mesh(new T.TorusGeometry(1.48,.008,8,96),mat('#a3b396'));ring.rotation.x=Math.PI/2;ring.position.y=-.027;scene.add(ring);
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.ShadowMaterial({opacity:.12}));floor.rotation.x=-Math.PI/2;floor.position.y=-.21;floor.receiveShadow=true;scene.add(floor);
let model,rig,helper,selected=characters[0],motion='idle',speed=1,time=0;
function build(c){
 const root=new T.Group();root.name=`EMC_${c.name}`;const bones={};
 function bone(name,parent,x,y,z){const b=new T.Bone();b.name=name;b.position.set(x,y,z);parent.add(b);bones[name]=b;return b;}
 function shape(parent,color,pos,scale,kind='sphere',rotation=0){const geo=kind==='box'?new T.BoxGeometry(1,1,1,2,2,2):kind==='cylinder'?new T.CylinderGeometry(1,1,1,32):new T.SphereGeometry(1,32,24);const m=new T.Mesh(geo,mat(color));m.position.set(...pos);m.scale.set(...scale);m.rotation.z=rotation;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function curve(parent,color,points,radius){const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));const m=new T.Mesh(new T.TubeGeometry(path,24,radius,8,false),mat(color));parent.add(m);m.castShadow=true;return m;}
 const skin='#ffbf94',hips=bone('Hips',root,0,1.04,0),spine=bone('Spine',hips,0,.48,0),head=bone('Head',spine,0,.86,0);
 shape(spine,c.shirt,[0,0,0],[.47,.51,.29]);shape(spine,skin,[0,.48,0],[.15,.21,.15]);
 for(const s of [-1,1]){
  const side=s<0?'Left':'Right';const leg=bone(`${side}UpperLeg`,hips,s*.25,-.05,0),shin=bone(`${side}LowerLeg`,leg,0,-.43,0),foot=bone(`${side}Foot`,shin,0,-.43,0);
  const shorts=c.name==='Noise';shape(leg,c.pants,[0,-.23,0],[.255,.33,.28]);shape(shin,shorts?skin:c.pants,[0,-.19,0],[shorts?.15:.265,.28,shorts?.15:.27]);shape(foot,c.name==='Machi'||c.name==='李明庭'||c.name==='黎子瑄'?'#242428':'#f6f2e9',[0,-.035,.12],[.27,.15,.38]);shape(foot,'#d8d6ce',[0,-.13,.12],[.27,.045,.37]);
  const arm=bone(`${side}UpperArm`,spine,s*.43,.26,0),fore=bone(`${side}LowerArm`,arm,s*.18,-.31,0),hand=bone(`${side}Hand`,fore,s*.07,-.25,0);
  shape(arm,c.name==='李明庭'||c.name==='鄭筱舢'||c.name==='余采馨'?skin:c.shirt,[s*.075,-.15,0],[.18,.26,.19],'sphere',s*.38);shape(fore,['Amber','Machi','Noise','廖秦葦'].includes(c.name)?c.shirt:skin,[s*.025,-.12,0],[.145,.22,.15]);shape(hand,skin,[0,-.02,.025],[.16,.18,.16]);
 }
 shape(head,skin,[0,0,0],[.77,.72,.62]);for(const s of [-1,1]){shape(head,skin,[s*.77,-.04,0],[.16,.22,.16]);shape(head,'#e99075',[s*.80,-.04,.09],[.085,.13,.055]);
  shape(head,'#fffaf4',[s*.29,-.04,.535],[.19,.235,.08]);shape(head,'#171a1b',[s*.285,-.045,.597],[.135,.18,.055]);shape(head,'#ffffff',[s*.255,.025,.642],[.042,.055,.018]);shape(head,'#ef9a87',[s*.48,-.25,.50],[.14,.07,.025]);
  curve(head,c.hair||'#4b332a',[[s*.14,.27,.57],[s*.27,.30,.586],[s*.42,.27,.54]],.025);
 }
 shape(head,skin,[0,-.18,.62],[.07,.065,.08]);curve(head,'#ac5b47',[[-.12,-.33,.55],[0,-.365,.58],[.12,-.33,.55]],.018);
 if(c.hair){
  // Back cap is restricted to the rear hemisphere, preserving a fully modeled face.
  const scalp=new T.Mesh(new T.SphereGeometry(1,40,28,Math.PI,Math.PI),mat(c.hair));scalp.scale.set(.81,.77,.65);scalp.position.y=.05;head.add(scalp);scalp.castShadow=true;
  shape(head,c.hair,[0,.56,-.09],[.73,.27,.56]);
  const long=['long','straight','bob'].includes(c.style),length=c.style==='bob'?.77:1.2;
  for(let i=0;i<(long?13:9);i++){const a=Math.PI*.12+(i/(long?12:8))*Math.PI*1.76;const x=Math.cos(a)*.66,z=Math.sin(a)*.40-.17;
   if(z>.15&&Math.abs(x)<.50)continue;
   shape(head,c.hair,[x,long?-length*.38:.24,z],[long?.20:.26,long?length*.77:.40,.25],'sphere',long?(x>0?-.1:.1):x*.7);
   if(c.style==='long')curve(head,c.name==='Amber'?'#9d612d':'#9b4e31',[[x,.25,z+.15],[x*1.08,-.27,z+.19],[x*.96,-.75,z+.18]],.045);
  }
  for(let i=0;i<5;i++)shape(head,c.hair,[(i-2)*.23,.39+Math.abs(i-2)*.025,.42],[.15,.30,.16],'sphere',c.style==='short'||c.style==='spiky'?(i-2)*.27:0);
  if(c.name==='Machi')for(const s of [-1,1])curve(head,'#d3a15b',[[s*.14,.67,.35],[s*.38,.62,.49],[s*.62,.36,.38]],.085);
 }
 if(c.cap){const cap=new T.Mesh(new T.SphereGeometry(.84,40,20,0,Math.PI*2,0,Math.PI/2),mat(c.cap));cap.position.y=.25;cap.scale.z=.85;head.add(cap);shape(head,c.cap,[0,.22,.64],[.79,.065,.45]);shape(head,c.cap,[0,1.08,0],[.09,.045,.09]);for(const s of [-1,1])curve(head,'#152d44',[[0,1.07,0],[s*.45,.89,.42],[s*.74,.30,.34]],.009);}
 if(c.name==='Anna'){for(const s of [-1,1]){const frame=new T.Mesh(new T.TorusGeometry(.235,.032,8,32),mat('#222a2b'));frame.scale.y=.88;frame.position.set(s*.29,-.03,.65);head.add(frame);}curve(head,'#222a2b',[[-.06,.025,.65],[0,.055,.67],[.06,.025,.65]],.025);for(const s of [-1,1])curve(head,'#222a2b',[[s*.53,.04,.65],[s*.77,.08,.08]],.025);
  for(const s of [-1,1])for(let i=0;i<3;i++){const star=new T.Shape();for(let j=0;j<10;j++){const a=j*Math.PI/5+Math.PI/2,r=j%2?.045:.1;const x=Math.cos(a)*r,y=Math.sin(a)*r;j?star.lineTo(x,y):star.moveTo(x,y);}star.closePath();const m=new T.Mesh(new T.ShapeGeometry(star),mat('#bfc0b9'));m.position.set(s*.25,-.13-i*.22,.276);hips.add(m);}
 }
 if(c.name==='Amber')for(const s of [-1,1])shape(spine,'#fff8ec',[s*.14,.36,.26],[.16,.15,.035],'box',s*.45);
 if(['Amber','Machi','Noise'].includes(c.name)){for(let i=0;i<4;i++)shape(spine,'#b29f7a',[0,.29-i*.13,.295],[.024,.024,.014]);if(c.name!=='Amber')for(const s of [-1,1])shape(spine,c.shirt,[s*.26,.16,.27],[.15,.12,.04],'box');}
 if(c.name==='余采馨'){for(let j=0;j<3;j++){const m=new T.Mesh(new T.CylinderGeometry(.34+j*.05,.48+j*.05,.18,48),mat(j===2?'#fff4e4':c.shirt));m.position.y=-.14-j*.16;spine.add(m);}}
 if(c.name==='廖秦葦'){shape(spine,c.shirt,[0,.39,-.12],[.43,.24,.27]);for(const s of [-1,1])curve(spine,'#d5c7ab',[[s*.12,.27,.27],[s*.12,.05,.31]],.014);}
 if(c.name==='吳冠賢'){for(const s of [-1,1])shape(spine,'#ab3438',[s*.28,-.03,.28],[.10,.61,.04],'box',s*-.15);shape(hips,'#bf9a45',[0,.15,.32],[.13,.13,.05]);shape(bones.LeftHand,'#24282b',[0,.49,.05],[.18,.29,.09],'box');shape(bones.LeftHand,'#b69c54',[0,.49,.15],[.08,.18,.025]);}
 if(c.name==='黎子瑄'){for(const s of [-1,1]){shape(spine,'#a78b72',[s*.24,.25,.22],[.15,.37,.06],'box',s*.6);shape(spine,'#a78b72',[s*.13,-.32,.31],[.10,.33,.05],'box',s*.2);for(let i=0;i<4;i++)shape(spine,'#584e46',[s*.13,-.1-i*.12,.366],[.11,.025,.007],'box');}shape(spine,'#c5c6bd',[0,.17,.31],[.045,.045,.015]);}
 function pet(parent,color,y=0,rabbit=false){const g=new T.Group();g.position.set(0,y,.05);parent.add(g);shape(g,color,[0,0,0],[.24,.30,.20]);shape(g,color,[0,.29,.03],[.25,.22,.20]);for(const s of [-1,1]){shape(g,color,[s*.14,.54,0],[.07,rabbit?.23:.13,.07],'sphere',s*-.15);if(rabbit)shape(g,'#eab0b0',[s*.14,.55,.06],[.035,.16,.015]);shape(g,'#28242a',[s*.085,.31,.216],[.027,.035,.016]);shape(g,color,[s*.14,-.24,.06],[.10,.09,.13]);}shape(g,'#d2917d',[0,.22,.225],[.035,.025,.02]);return g;}
 if(['Leona','鄭筱舢','余采馨','Machi'].includes(c.name)){if(c.name==='Machi'){shape(bones.LeftHand,'#272727',[0,.08,.12],[.21,.23,.12],'box');curve(spine,'#635237',[[-.4,.43,0],[-.52,0,.18],[-.63,-.4,.16]],.025);}else {const p=pet(bones.LeftHand,c.name==='余采馨'?'#fcf2e2':'#f3df8c',-.23,c.name==='余采馨');p.scale.setScalar(.75);}}
 if(c.name==='廖秦葦'||c.name==='吳冠賢'){const p=pet(root,c.name==='廖秦葦'?'#f6ecda':'#e6ac65',.33,c.name==='廖秦葦');p.position.x=1.02;p.scale.setScalar(.8);}
 refineAmber(root,bones,c);
 root.userData={...root.userData,character:c.name,stage:'Character custom surface study v2',rig:'rigid bone attachment; not production skinning',referenceViews:['front','side','back']};
 // Attach every mesh to an actual skeleton with rigid weights, retaining editable bone hierarchy.
 root.updateMatrixWorld(true);const skeleton=new T.Skeleton(Object.values(bones));skeleton.calculateInverses();const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 for(const m of meshes){let p=m.parent;while(p&&!p.isBone)p=p.parent;if(!p)continue;const index=skeleton.bones.indexOf(p),geo=m.geometry;const count=geo.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);for(let i=0;i<count;i++){indices[i*4]=index;weights[i*4]=1;}geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const skinned=new T.SkinnedMesh(geo,m.material);skinned.name=`${p.name}_mesh_${meshes.indexOf(m)}`;skinned.position.copy(m.position);skinned.quaternion.copy(m.quaternion);skinned.scale.copy(m.scale);skinned.castShadow=true;skinned.receiveShadow=false;m.parent.add(skinned);skinned.updateMatrixWorld(true);skinned.bind(skeleton,skinned.matrixWorld);m.removeFromParent();}
 return {root,bones,skeleton};
}
function dispose(root){const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});}
function pose(b,t,mode){const moving=mode!=='idle',rate=mode==='run'?10:5,amp=mode==='run'?.85:.5,phase=t*rate;for(const bone of Object.values(b))bone.rotation.set(0,0,0);b.Hips.position.y=1.04+(moving?Math.abs(Math.sin(phase))*(mode==='run'?.09:.035):Math.sin(t*2)*.015);b.Spine.rotation.x=mode==='run'?.12:0;b.Head.rotation.y=moving?0:Math.sin(t*.7)*.045;for(const [side,sign] of [['Left',1],['Right',-1]]){b[side+'UpperLeg'].rotation.x=moving?Math.sin(phase)*amp*sign:0;b[side+'LowerLeg'].rotation.x=moving?Math.max(0,-Math.sin(phase)*sign)*(mode==='run'?1.1:.5):0;b[side+'UpperArm'].rotation.x=moving?-Math.sin(phase)*amp*sign:Math.sin(t*2)*.025;b[side+'LowerArm'].rotation.x=mode==='run'?-.8:-.10;}}
function select(c){selected=c;if(model){scene.remove(model);dispose(model);rig.skeleton.dispose();}if(helper){scene.remove(helper);helper.dispose();}rig=build(c);model=rig.root;scene.add(model);helper=new T.SkeletonHelper(model);helper.visible=$('#skeleton').checked;scene.add(helper);$('#number').textContent=`CHARACTER / ${String(c.index+1).padStart(2,'0')}`;$('#name').textContent=c.name;document.querySelector('.tags span').textContent='外觀修訂 v2';document.querySelector('.note').textContent='v2：曲面臉型、五官彩繪、獨立髮型與服裝配件。仍為程序化近似模型，採剛性骨架權重，尚未達到原畫完整精修品質。';$('#description').textContent=c.description;$('#references').replaceChildren(...['front','side','back'].map((v,i)=>{const b=document.createElement('button');b.innerHTML=`<img src="${ref(c,v)}" alt="${c.name} ${['正面','側面','背面'][i]}"><small>${['正面','側面','背面'][i]}</small>`;b.onclick=()=>{$('#reference-large').src=ref(c,v);$('#reference-dialog').showModal();};return b;}));document.querySelectorAll('.character').forEach(b=>{const active=Number(b.dataset.index)===c.index;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});time=0;}
function roster(filter='all'){$('#characters').replaceChildren(...characters.filter(c=>filter==='all'||c.type===filter).map(c=>{const b=document.createElement('button');b.className='character';b.dataset.index=c.index;b.innerHTML=`<img src="${ref(c,'front')}" alt=""><span><strong>${c.name}</strong><small>${c.type==='designer'?'DESIGNER':'TEAM MEMBER'}</small></span><span class="dot">${String(c.index+1).padStart(2,'0')}</span>`;b.onclick=()=>select(c);b.classList.toggle('active',c===selected);b.setAttribute('aria-pressed',String(c===selected));return b;}));}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));roster(b.dataset.filter);});
document.querySelectorAll('[data-motion]').forEach(b=>{b.setAttribute('aria-pressed',String(b.classList.contains('active')));b.onclick=()=>{motion=b.dataset.motion;document.querySelectorAll('[data-motion]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});};});
$('#speed').oninput=e=>{speed=Number(e.target.value);$('#speed-label').value=speed.toFixed(1)+'×';};$('#skeleton').onchange=e=>helper.visible=e.target.checked;
$('#rotate').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('#rotate').setAttribute('aria-pressed',String(controls.autoRotate));};
function view(angle){controls.autoRotate=false;$('#rotate').setAttribute('aria-pressed','false');const r=camera.position.distanceTo(controls.target);camera.position.set(Math.sin(angle)*r,2.5,Math.cos(angle)*r);controls.update();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(Number(b.dataset.view)));$('#reset').onclick=()=>{camera.position.set(4,2.8,7);controls.target.set(0,1.7,0);controls.update();};$('#close-dialog').onclick=()=>$('#reference-dialog').close();
function clips(){return ['idle','walk','run'].map(mode=>{const duration=mode==='run'?Math.PI/5:mode==='walk'?Math.PI*2/5:Math.PI;const tracks=[],samples=61;const times=Array.from({length:samples},(_,i)=>i*duration/(samples-1));for(const b of Object.values(rig.bones)){const rotations=[],positions=[];for(const t of times){pose(rig.bones,t,mode);rotations.push(...b.quaternion.toArray());positions.push(...b.position.toArray());}tracks.push(new T.QuaternionKeyframeTrack(b.name+'.quaternion',times,rotations));if(b.name==='Hips')tracks.push(new T.VectorKeyframeTrack(b.name+'.position',times,positions));}return new T.AnimationClip(mode,duration,tracks);});}
async function exportModel(){const button=$('#export');button.disabled=true;try{const animations=clips();pose(rig.bones,0,'idle');model.updateMatrixWorld(true);const result=await new GLTFExporter().parseAsync(model,{binary:true,animations,onlyVisible:true});const blob=new Blob([result],{type:'model/gltf-binary'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`EMC_${selected.name}_prototype.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('GLB 已匯出，包含骨架及 idle / walk / run 動作。');}catch(e){console.error(e);toast('匯出失敗：'+e.message);}finally{button.disabled=false;}}
$('#export').onclick=exportModel;function toast(text){$('#status').textContent=text;$('#status').classList.add('visible');setTimeout(()=>$('#status').classList.remove('visible'),5000);}
new ResizeObserver(()=>{const {width,height}=$('#canvas').getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe($('#canvas'));
roster();select(selected);const clock=new T.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);time+=dt*speed;pose(rig.bones,time,motion);controls.update();$('#angle').textContent=String(Math.round((controls.getAzimuthalAngle()*180/Math.PI+360)%360)).padStart(3,'0')+'°';renderer.render(scene,camera);});
// Small read-only hook for automated viewport checks and integrations.
window.characterStudio={get selected(){return selected.name;},get model(){return model;},select:name=>select(characters.find(c=>c.name===name)||characters[0]),exportModel};

import * as T from 'three';
import {addCharacterDetails} from './character-details.js';

// Dedicated Amber model: shaped ring surfaces, painted facial UVs and tapered curl ribbons.
export function refineAmber(root,bones,c={name:'Amber',shirt:'#f7efe0',pants:'#c8ae91',hair:'#43281e',style:'long',cap:'#303032'}){
 const old=[];root.traverse(o=>{if(o.isMesh)old.push(o);});for(const o of old){o.geometry.dispose();o.material.dispose();o.removeFromParent();}
 const material=(color,roughness=.83)=>new T.MeshStandardMaterial({color,roughness});
 const skin=material('#ffc39e'),ivory=material(c.shirt),seam=material(new T.Color(c.pants).multiplyScalar(.72)),pants=material(c.pants),hair=material(c.hair||'#43281e',.62),gold=material(c.name==='Amber'?'#a66c38':c.name==='Machi'?'#d7a25a':new T.Color(c.hair||'#43281e').multiplyScalar(1.15),.65),cap=material(c.cap||'#303032',.92),thread=material('#242426');
 const collared=['Amber','Machi','Noise','吳冠賢'].includes(c.name),bare=c.name==='李明庭',sleeveless=['李明庭','鄭筱舢','余采馨'].includes(c.name),longSleeves=['Amber','Machi','Noise','廖秦葦'].includes(c.name);
 const add=(parent,geometry,mat)=>{const m=new T.Mesh(geometry,mat);m.castShadow=true;m.receiveShadow=false;parent.add(m);return m;};
 function ell(parent,mat,p,s){const m=add(parent,new T.SphereGeometry(1,48,32),mat);m.position.set(...p);m.scale.set(...s);return m;}
 function tube(parent,mat,points,r=.012){return add(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),48,r,8,false),mat);}
 // Rings: [height, half-width, half-depth, depth-offset]. Smooth silhouette without stacked ellipsoids.
 function loft(parent,mat,rings,segments=64){if(rings.length<20){const original=rings;const path=new T.CatmullRomCurve3(rings.map(r=>new T.Vector3(r[1],r[0],r[2])),false,'catmullrom',.18);rings=path.getPoints((rings.length-1)*6).map((v,i,all)=>{const t=i/(all.length-1)*(original.length-1),j=Math.min(original.length-2,Math.floor(t)),f=t-j;return [v.y,Math.max(.001,v.x),Math.max(.001,v.z),(original[j][3]||0)*(1-f)+(original[j+1][3]||0)*f];});}const positions=[],uv=[],indices=[];for(let j=0;j<rings.length;j++){const [y,w,d,z=0]=rings[j];for(let i=0;i<=segments;i++){const a=-Math.PI+i/segments*Math.PI*2;positions.push(Math.sin(a)*w,y,Math.cos(a)*d+z);uv.push(i/segments,j/(rings.length-1));}}for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return add(parent,g,mat);}
 const head=bones.Head,spine=bones.Spine,hips=bones.Hips;
 // Facial painting belongs to the curved head surface, avoiding raised eyeballs and cheek disks.
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffc39e';ctx.fillRect(0,0,2048,1024);
 const faceX=1024;
 function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
 for(const sign of [-1,1]){
  const x=faceX+sign*126;
  const blush=ctx.createRadialGradient(faceX+sign*196,644,3,faceX+sign*196,644,66);blush.addColorStop(0,'rgba(244,116,112,.70)');blush.addColorStop(.5,'rgba(246,132,121,.38)');blush.addColorStop(1,'rgba(255,166,143,0)');ctx.fillStyle=blush;ctx.fillRect(faceX+sign*196-70,574,140,140);
  ellipse(x,526,76,120,'#fff9ee');ellipse(x+sign*5,534,58,103,'#171517');ellipse(x-sign*19,474,15,22,'#ffffff');ellipse(x+sign*18,592,5,7,'#5b4c40');
  ctx.strokeStyle='#34251f';ctx.lineWidth=12;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-sign*73,465);ctx.quadraticCurveTo(x,403,x+sign*72,465);ctx.stroke();ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x+sign*59,452);ctx.lineTo(x+sign*82,434);ctx.stroke();
  ctx.lineWidth=13;ctx.beginPath();ctx.moveTo(x-43,395);ctx.quadraticCurveTo(x,369,x+39,395);ctx.stroke();
 }
 ellipse(faceX,635,7,7,'#e08b68');ctx.strokeStyle='#bb6c51';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(982,691);ctx.quadraticCurveTo(1024,729,1066,691);ctx.stroke();
 if(bare){ellipse(faceX,705,34,25,'#a64f3e');ellipse(faceX,714,21,10,'#ef8a7b');}
 if(c.name==='吳冠賢')for(let i=0;i<13;i++)ellipse(982+i*7,669+(i%3)*7,1.5,2,'#b78564');
 const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;
 const faceMat=material('#ffffff');faceMat.map=tex;
 // Even vertical ring spacing preserves facial UV proportions.
 const rings=[];for(let i=0;i<=64;i++){const v=i/64,phi=(v-.5)*Math.PI;const width=.79*Math.pow(Math.cos(phi),.40)*(.90+.10*T.MathUtils.smoothstep(v,.1,.65));rings.push([-.62+v*1.30,Math.max(.001,width),Math.max(.001,.57*Math.pow(Math.cos(phi),.85)),.035*(1-v)]);}loft(head,faceMat,rings,96);
 for(const s of [-1,1]){ell(head,skin,[s*.765,-.12,-.015],[.13,.18,.115]);ell(head,material('#eea083'),[s*.80,-.12,.075],[.057,.10,.028]);}
 ell(spine,skin,[0,.39,0],[.14,.23,.13]);
 loft(spine,bare?skin:ivory,[[-.45,.36,.24],[-.40,.41,.27],[-.23,.43,.28],[0,.46,.28],[.20,.48,.26],[.33,.39,.23],[.40,.19,.16],[.42,.14,.14]]);
 // Open collar with shaped pointed lapels.
 if(collared){
 for(const s of [-1,1]){const shape=new T.Shape();shape.moveTo(s*.07,.40);shape.lineTo(s*.25,.33);shape.lineTo(s*.28,.13);shape.lineTo(s*.10,.23);shape.closePath();const m=add(spine,new T.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelThickness:.008,bevelSize:.012,bevelSegments:2,steps:1}),ivory);m.position.z=.255;}
 tube(spine,seam,[[0,.23,.289],[0,-.10,.292],[0,-.40,.274]],.005);for(let j=0;j<4;j++)ell(spine,material('#d5c4a9'),[.035,.16-j*.15,.296],[.018,.018,.009]);
 }else if(!bare){tube(spine,material(c.shirt),[[-.18,.38,.17],[-.13,.28,.24],[0,.25,.28],[.13,.28,.24],[.18,.38,.17]],.025);}
 if(bare)ell(spine,material('#dba07b'),[0,-.25,.279],[.025,.02,.007]);
 const waist=loft(hips,pants,[[.015,.44,.26],[.13,.43,.265],[.17,.40,.25]]);tube(hips,seam,[[-.4,.12,.12],[-.25,.12,.24],[0,.12,.268],[.25,.12,.24],[.4,.12,.12]],.012);
 ell(hips,material('#ead7b8'),[0,.1,.277],[.05,.041,.012]);tube(hips,seam,[[0,.015,.27],[0,-.13,.28],[.035,-.22,.28]],.005);
 for(const s of [-1,1]){
  const side=s<0?'Left':'Right',leg=bones[side+'UpperLeg'],lower=bones[side+'LowerLeg'],foot=bones[side+'Foot'],arm=bones[side+'UpperArm'],fore=bones[side+'LowerArm'],hand=bones[side+'Hand'];
  // Continuous upper and lower trouser pieces overlap at the joint; flat hems instead of spherical knees.
  loft(leg,pants,[[-.50,.255,.265],[-.39,.25,.265],[-.20,.24,.265],[0,.235,.255],[.10,.21,.23]]);
  if(c.name==='Noise'){loft(lower,skin,[[-.46,.13,.14],[-.2,.145,.15],[.04,.15,.16]]);loft(leg,material('#426282'),[[-.52,.26,.27],[-.44,.26,.27]]);}else{
  loft(lower,pants,[[-.49,.30,.29],[-.44,.30,.29],[-.25,.28,.28],[-.04,.255,.265],[.04,.255,.265]]);
  tube(lower,seam,[[s*.24,.02,.08],[s*.27,-.22,.10],[s*.295,-.45,.11]],.005);
  tube(lower,seam,[[-.28,-.43,.13],[0,-.43,.294],[.28,-.43,.13]],.005);
  }
  tube(leg,seam,[[s*.16,.04,.20],[s*.10,-.13,.25],[s*.04,-.19,.263]],.006);
  const darkShoes=['Machi','李明庭','黎子瑄','吳冠賢'].includes(c.name);ell(foot,material(darkShoes?'#252526':'#f8f4ed'),[0,-.035,.12],[.28,.12,.35]);loft(foot,material(darkShoes?'#19191b':'#ede4d7'),[[-.14,.28,.34,.12],[-.10,.285,.35,.12],[-.07,.28,.34,.12]]);
  tube(foot,seam,[[-.20,-.015,.35],[0,.015,.43],[.20,-.015,.35]],.005);
  const sleeve=loft(arm,sleeveless?skin:ivory,[[-.39,sleeveless?.135:.17,sleeveless?.145:.18],[-.30,sleeveless?.15:.20,sleeveless?.15:.20],[-.10,sleeveless?.16:.22,sleeveless?.16:.21],[.08,.16,.18]]);sleeve.rotation.z=s*.32;
  loft(fore,longSleeves?ivory:skin,[[-.27,.14,.15],[-.20,longSleeves?.18:.14,longSleeves?.18:.15],[0,longSleeves?.18:.145,longSleeves?.19:.15],[.08,.17,.18]]);
  if(longSleeves)loft(fore,material(c.name==='Amber'?'#fff6e7':c.shirt),[[-.29,.145,.155],[-.22,.15,.16]]);
  ell(hand,skin,[0,-.025,.025],[.145,.17,.145]);ell(hand,skin,[-s*.10,.01,.10],[.06,.08,.065]);
 }
 // Flowing locks have variable width and elliptical cross-sections, not round spaghetti tubes.
 function lock(points,width,depth,mat){const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),n=64,k=12,pos=[],ind=[];for(let j=0;j<=n;j++){const t=j/n,p=path.getPoint(t),tangent=path.getTangent(t),axis=new T.Vector3(0,0,1).cross(tangent).normalize(),normal=tangent.clone().cross(axis).normalize(),taper=Math.sin(Math.PI*(.09+t*.90))**.4;for(let i=0;i<=k;i++){const a=i/k*Math.PI*2,v=p.clone().addScaledVector(axis,Math.cos(a)*width*taper).addScaledVector(normal,Math.sin(a)*depth*taper);pos.push(...v.toArray());if(j<n&&i<k){const q=j*(k+1)+i;ind.push(q,q+1,q+k+1,q+1,q+k+2,q+k+1);}}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ind);g.computeVertexNormals();add(head,g,mat);}
 // Back volume, with deliberately open front face.
 if(c.hair){
 const long=c.style==='long'||c.style==='straight',short=c.style==='short'||c.style==='spiky',length=long?1.2:short?.40:.70,wavy=c.style==='long'||c.name==='余采馨';
 const back=add(head,new T.SphereGeometry(1,64,40,Math.PI,Math.PI),hair);back.position.set(0,short?.12:-.15,-.10);back.scale.set(.84,short?.65:long?1.05:.80,.59);
 if(!c.cap){const crown=[];for(let i=0;i<=32;i++){const a=i/32*Math.PI/2;crown.push([.18+Math.sin(a)*.62,Math.max(.001,.82*Math.cos(a)),Math.max(.001,.62*Math.cos(a)),-.035]);}loft(head,hair,crown,80);}
 const adjust=points=>points.map(([x,y,z])=>[x,y<0?y*length/1.2:y,z]);
 if(!short){
 for(let i=0;i<11;i++){const x=-.76+i/10*1.52,z=-Math.sqrt(Math.max(0,1-(x/.86)**2))*.45-.12;const pts=adjust([[x*.72,.30,z],[x,-.08,z-.03],[x+(wavy?Math.sin(i)*.08:0),-.50,z],[x-(wavy?Math.sin(i+.6)*.10:0),-.91,z+.025],[x*.94,-1.20+(i%3)*.06,z+.02]]);lock(pts,.16,.13,hair);if(i%2===0)lock(pts.map(([x,y,z])=>[x+.025,y,z-.105]),c.name==='Amber'?.052:.018,.012,gold);}
 for(const s of [-1,1])for(let i=0;i<3;i++){const x=s*(.66+i*.12),z=.10-i*.18;const pts=adjust([[s*.68,.21,z],[x,-.13,z+.05],[x+(wavy?s*.10:0),-.43,z+.04],[x-(wavy?s*.035:0),-.70,z+.12],[x+(wavy?s*.04:0),-.96,z+.07],[x-s*.10,-1.18+i*.05,z]]);lock(pts,.17,.12,hair);lock(pts.map(([x,y,z])=>[x+s*.025,y,z+.105]),c.name==='Amber'?.053:.018,.012,gold);}
 }
 if(!c.cap){
  const parted=['Anna','Machi','吳冠賢','鄭筱舢'].includes(c.name);
  if(parted){for(const s of [-1,1])for(let j=0;j<5;j++){const pts=[[s*.04,.73-j*.018,.23],[s*(.25+j*.06),.68-j*.035,.48],[s*(.50+j*.05),.36-j*.03,.48-j*.035],[s*(.64+j*.03),.17-j*.045,.30]];lock(pts,short?.16:.12,.09,hair);if(c.name==='Machi'&&j%2===0)lock(pts.map(([x,y,z])=>[x,y+.025,z+.08]),.048,.015,gold);}}
  else{for(let j=0;j<7;j++){const x=(j-3)*.17;lock([[x*.45,.73,.18],[x*.88,.52,.47],[x,.25,.56],[x,.16+Math.abs(j-3)*.025,.55]],.115,.075,hair);}}
  if(short)for(let j=0;j<9;j++){const a=j/8*Math.PI;lock([[Math.cos(a)*.58,.58,-.12],[Math.cos(a)*.80,.37,-.10],[Math.cos(a)*.83,.05,-.16],[Math.cos(a)*.73,-.26,-.24]],.15,.13,hair);}
 }
 }
 // Curved fabric crown and curved bill.
 if(c.cap){
 const crownRings=[];for(let i=0;i<=32;i++){const a=i/32*Math.PI/2;const radius=Math.cos(a);crownRings.push([.18+Math.sin(a)*.85,Math.max(.001,.855*radius),Math.max(.001,.68*radius),-.035]);}loft(head,cap,crownRings,96);
 const billPositions=[],billIndices=[];for(let j=0;j<=12;j++){const t=j/12;for(let i=0;i<=48;i++){const u=(i/48-.5)*2,x=u*.84*(1-t*.05),front=Math.sqrt(Math.max(0,1-u*u));billPositions.push(x,.255-.10*t-.07*u*u,.10+front*(.52+.43*t));if(j<12&&i<48){const a=j*49+i;billIndices.push(a,a+49,a+1,a+1,a+49,a+50);}}}const bg=new T.BufferGeometry();bg.setAttribute('position',new T.Float32BufferAttribute(billPositions,3));bg.setIndex(billIndices);bg.computeVertexNormals();const billmat=cap.clone();billmat.side=T.DoubleSide;add(head,bg,billmat);
 for(let j=0;j<6;j++){const a=j/6*Math.PI*2,pts=[];for(let i=0;i<=20;i++){const b=i/20*Math.PI/2;pts.push([Math.sin(a)*.86*Math.cos(b),.245+.79*Math.sin(b),Math.cos(a)*.685*Math.cos(b)-.035]);}tube(head,thread,pts,.006);}
 ell(head,cap,[0,1.047,-.035],[.065,.025,.058]);
 tube(head,thread,[[-.75,.21,.35],[-.4,.17,.85],[0,.155,1.05],[.4,.17,.85],[.75,.21,.35]],.008);
 // Back adjustment strap and ventilation eyelets.
 const strap=add(head,new T.BoxGeometry(.48,.11,.035),thread);strap.position.set(0,.30,-.70);for(let i=0;i<5;i++)ell(head,material('#111113'),[(i-2)*.077,.30,-.724],[.018,.018,.009]);
 }
 addCharacterDetails({root,bones,c,material,add,ell,tube,loft,skin,ivory,pants,seam});
 root.userData.stage='Character custom surface study v2';root.userData.limitations='Custom procedural mesh; rigid skin weights; not production hand-sculpted asset';
}

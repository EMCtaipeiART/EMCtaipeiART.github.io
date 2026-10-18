import * as T from 'three';

// Character-specific details remain separate from the shared face, hair and tailoring surfaces.
export function addCharacterDetails({root,bones,c,material,add,ell,tube,loft,skin,ivory,pants,seam}){
 const head=bones.Head,spine=bones.Spine,hips=bones.Hips,gold=material('#c3a35b'),white=material('#fff8ec'),dark=material('#252629');
 function box(parent,mat,pos,scale,angle=0){const m=add(parent,new T.BoxGeometry(...scale),mat);m.position.set(...pos);m.rotation.z=angle;return m;}
 function torus(parent,mat,pos,r,t=.012){const m=add(parent,new T.TorusGeometry(r,t,8,48),mat);m.position.set(...pos);return m;}
 function plush(parent,rabbit=false,color='#f1d983',size=.75,pos=[0,-.20,.14]){const g=new T.Group();g.position.set(...pos);g.scale.setScalar(size);parent.add(g);const fur=material(color),pink=material('#eaa5a5');ell(g,fur,[0,0,0],[.23,.27,.17]);ell(g,fur,[0,.26,.03],[.26,.20,.17]);for(const s of [-1,1]){ell(g,fur,[s*.20,rabbit?.49:.27,.01],rabbit?[.073,.25,.065]:[.12,.13,.075]);if(rabbit)ell(g,pink,[s*.20,.50,.067],[.033,.18,.012]);ell(g,dark,[s*.09,.27,.193],[.025,.032,.01]);ell(g,pink,[s*.145,.20,.18],[.035,.02,.01]);ell(g,fur,[s*.14,-.21,.04],[.085,.10,.10]);ell(g,fur,[s*.23,-.01,.02],[.08,.13,.08]);}ell(g,material('#9f6a50'),[0,.21,.197],[.025,.021,.012]);tube(g,dark,[[-.045,.16,.193],[0,.14,.20],[.045,.16,.193]],.006);if(!rabbit){ell(g,material('#68402a'),[0,.445,.02],[.16,.045,.12]);}return g;}
 function necklace(){tube(spine,gold,[[-.18,.38,.20],[-.14,.20,.28],[0,.12,.30],[.14,.20,.28],[.18,.38,.20]],.012);ell(spine,gold,[0,.10,.31],[.04,.05,.015]);}
 function bracelet(side='Left',color=gold){const m=torus(bones[side+'LowerArm'],color,[0,-.21,0],.15,.015);m.rotation.x=Math.PI/2;}
 function pocket(parent,x,y,z){tube(parent,seam,[[x-.10,y+.08,z],[x-.09,y-.08,z],[x,y-.12,z+.01],[x+.09,y-.08,z],[x+.10,y+.08,z]],.005);}
 if(c.name==='Anna'){
  for(const s of [-1,1]){const m=add(head,new T.TorusGeometry(.23,.027,10,64),dark);m.position.set(s*.30,.04,.58);m.scale.set(1.12,.88,1);tube(head,dark,[[s*.55,.11,.54],[s*.76,.10,.01]],.024);}tube(head,dark,[[-.05,.10,.605],[0,.125,.62],[.05,.10,.605]],.022);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle=c.shirt;ctx.fillRect(0,0,512,256);ctx.fillStyle='#a4432b';ctx.textAlign='center';ctx.font='bold 65px Georgia';['Real',"Ain’t",'A Lady'].forEach((s,i)=>ctx.fillText(s,256,65+i*72));const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;const m=add(spine,new T.PlaneGeometry(.48,.32),new T.MeshStandardMaterial({map:texture,roughness:1}));m.position.set(0,-.005,.286);
  for(const s of [-1,1])for(let i=0;i<4;i++){const shape=new T.Shape();for(let j=0;j<10;j++){const a=Math.PI/2+j*Math.PI/5,r=j%2?.045:.10;j?shape.lineTo(Math.cos(a)*r,Math.sin(a)*r):shape.moveTo(Math.cos(a)*r,Math.sin(a)*r);}shape.closePath();const m=add(i<2?bones[s<0?'LeftUpperLeg':'RightUpperLeg']:bones[s<0?'LeftLowerLeg':'RightLowerLeg'],new T.ShapeGeometry(shape),material('#b3b3b1'));m.position.set(i%2?.055:-.06,i<2?-.15-(i%2)*.20:-.1-(i%2)*.23,.272);}
  bracelet('Right',dark);tube(hips,material('#b5b5b0'),[[.2,.13,.28],[.35,-.10,.27],[.43,-.05,.13]],.014);
 }
 if(c.name==='Leona'){plush(bones.LeftHand);bracelet();}
 if(c.name==='Machi'){
  necklace();const navy=material('#263c55');box(spine,navy,[0,-.02,.29],[.19,.66,.035]);for(const s of [-1,1]){box(spine,ivory,[s*.26,-.02,.28],[.21,.17,.04]);pocket(spine,s*.26,-.02,.307);for(let i=0;i<4;i++)box(spine,material('#f2d5d4'),[s*.27,-.30+i*.16,.307],[.25,.009,.004]);ell(spine,gold,[s*.28,.25,.28],[.037,.037,.015]);}
  const bag=box(bones.LeftHand,dark,[.02,.10,.16],[.32,.32,.15],-.12);torus(bones.LeftHand,gold,[.02,.10,.245],.05,.009);tube(spine,gold,[[.36,.42,.13],[.17,.1,.34],[-.42,-.36,.20],[-.61,-.40,.13]],.018);tube(hips,gold,[[.4,.04,.13],[.46,-.35,.12],[.5,-.40,.14]],.012);
 }
 if(c.name==='Noise'){
  box(spine,white,[0,-.01,.287],[.25,.68,.02]);for(const s of [-1,1]){box(spine,ivory,[s*.28,.10,.27],[.20,.17,.05]);pocket(spine,s*.28,.10,.304);tube(spine,seam,[[s*.16,.34,.24],[s*.18,0,.30],[s*.18,-.38,.27]],.007);}for(const side of ['Left','Right'])for(let i=0;i<3;i++)tube(bones[side+'Foot'],white,[[-.10,.065,.19+i*.05],[.10,.065,.19+i*.05]],.012);
 }
 if(c.name==='余采馨'){
  for(let layer=0;layer<3;layer++){const y=-.07-layer*.17;const m=loft(spine,layer===2?white:ivory,[[y-.17,.53+layer*.025,.32],[y-.10,.48+layer*.025,.30],[y,.40+layer*.025,.27]]);for(let j=0;j<12;j++){const a=j/12*Math.PI*2;ell(spine,layer===2?white:ivory,[Math.sin(a)*(.48+layer*.025),y-.14,Math.cos(a)*.29],[.085,.065,.05]);}}
  for(const s of [-1,1])for(let i=0;i<4;i++)ell(spine,ivory,[s*(.23+i*.035),.31-i*.07,.235],[.065,.065,.035]);necklace();bracelet('Left',material('#dbbdce'));plush(bones.LeftHand,true,'#fff4e7',.65,[0,-.23,.10]);
 }
 if(c.name==='吳冠賢'){
  const red=material('#a83136');for(const s of [-1,1]){box(spine,red,[s*.26,-.08,.29],[.10,.97,.035],-s*.12);loft(spine,ivory,[[-.76,.53,.31],[-.42,.44,.28],[-.30,.42,.27]]);box(bones[s<0?'LeftLowerArm':'RightLowerArm'],dark,[0,-.1,.13],[.25,.23,.07]);tube(bones[s<0?'LeftLowerArm':'RightLowerArm'],red,[[-.10,-.2,.16],[-.10,0,.16],[.10,0,.16]],.014);}box(hips,white,[0,.07,.277],[.78,.14,.04]);ell(hips,gold,[0,.07,.32],[.11,.11,.025]);torus(hips,dark,[0,.07,.35],.065,.009);
  const hand=bones.LeftHand;box(hand,dark,[0,.48,.06],[.34,.49,.15]);tube(hand,gold,[[-.09,.64,.145],[.07,.63,.15],[.09,.55,.15],[-.08,.47,.15],[-.06,.37,.15],[.08,.36,.15]],.018);tube(hand,dark,[[0,.22,.04],[0,-.63,.04]],.025);for(let i=0;i<4;i++)tube(hand,red,[[.10,.24,.07],[.14,-.08,.07],[.13+i*.012,-.23,.07]],.008);
  const cat=plush(root,false,'#fff7e7',.7,[.92,.25,.10]);ell(cat,material('#b57735'),[.11,.35,.09],[.12,.13,.12]);ell(cat,dark,[-.13,.38,.04],[.09,.11,.10]);
 }
 if(c.name==='廖秦葦'){
  ell(spine,ivory,[0,.30,-.15],[.39,.26,.23]);for(const s of [-1,1]){tube(spine,material('#bcb6a9'),[[s*.12,.30,.27],[s*.12,.02,.29]],.009);}pocket(spine,0,-.26,.28);const glasses=material('#a48c50');for(const y of [.18,.02])torus(spine,glasses,[.07,y,.32],.055,.008);
  const rabbit=plush(root,true,'#fff3df',1.08,[.98,.31,.05]);tube(rabbit,material('#69533c'),[[-.22,.25,.05],[-.24,-.04,.16],[0,-.13,.19],[.24,-.04,.16],[.22,.25,.05]],.023);ell(rabbit,material('#eb963c'),[0,-.15,.20],[.05,.09,.025]);
 }
 if(c.name==='鄭筱舢'){
  necklace();for(let i=0;i<12;i++){const x=-.34+i*.062;const z=.28*Math.sqrt(Math.max(0,1-(x/.46)**2));tube(spine,material('#c5ddeb'),[[x,-.38,z],[x,.26,z]],.004);}tube(spine,white,[[.30,.36,.12],[.48,.06,.05],[.60,-.43,.03]],.02);plush(bones.LeftHand,false,'#f2dc8a',.70,[0,.0,.1]);const pink=material('#d99ab2');for(const s of [-1,1])ell(bones.LeftHand,pink,[s*.07,-.05,.27],[.08,.035,.025]);for(const side of ['LeftUpperLeg','RightUpperLeg'])pocket(bones[side],0,-.05,.27);
 }
 if(c.name==='黎子瑄'){
  const plaid=material('#a68b74'),line=material('#50443a');for(const s of [-1,1]){box(spine,plaid,[s*.25,.25,.23],[.24,.40,.04],s*.6);box(spine,plaid,[s*.12,-.30,.31],[.15,.50,.04],s*.16);for(let i=0;i<5;i++)box(spine,line,[s*.12,-.10-i*.09,.337],[.15,.018,.006]);box(spine,line,[s*.12,-.30,.34],[.02,.49,.007]);}ell(spine,plaid,[0,-.05,.34],[.09,.07,.06]);necklace();
 }
 // Back pockets and belt loops are visible during a full rotation.
 for(const side of ['LeftUpperLeg','RightUpperLeg'])pocket(bones[side],0,-.09,-.267);
 for(const x of [-.28,.28])box(hips,pants,[x,.09,.27],[.035,.15,.025]);
}

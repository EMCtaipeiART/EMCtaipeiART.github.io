// 生成版 3D 寵物（試作，只在展示頁使用）：外型是白膜圖生成的 GLB，花紋用原圖三視圖依表面朝向投影。目前只有站姿、不會動。
// 模型：assets/pets3d-gen/cat.glb（models/pets/gen_cat_model.py）；貼圖：cat.webp（models/pets/gen_cat_texture.py）
import {GLTFLoader} from '../character-studio/vendor/GLTFLoader.js';
const IDS = {cat:{ink:0x33201a, height:2.2}};
export const hasPet = id => !!IDS[id];
export function makePet(THREE, {mergeVertices}, id, HULL_LAYER, {ready, fail} = {}){
  const P = IDS[id], group = new THREE.Group(), base = new URL('assets/pets3d-gen/', import.meta.url).href, v = '?v=4';
  const atlas = new Promise((res, rej) => new THREE.TextureLoader().load(base + id + '.webp' + v, res, undefined, rej));
  const model = new Promise((res, rej) => new GLTFLoader().load(base + id + '.glb' + v, res, undefined, rej));
  Promise.all([atlas, model]).then(([map, gltf]) => {
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    let src; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh && !src) src = o.geometry.clone().applyMatrix4(o.matrixWorld); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', src.attributes.position); geo.setIndex(src.index);
    const g = mergeVertices(geo, 1e-4); g.computeVertexNormals(); g.setAttribute('aRest', g.attributes.position);
    const skin = new THREE.ShaderMaterial({uniforms:{map:{value:map}}, vertexShader:`
      varying vec3 p; varying vec3 n;
      void main(){ p = position; n = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader:`
      uniform sampler2D map; varying vec3 p; varying vec3 n;
      vec3 panel(float u, float v, float i){ return texture2D(map, vec2((i + clamp(0.5 + u / 2.6, 0.002, 0.998)) / 3.0, 0.5 + v / 2.6)).rgb; }
      void main(){
        vec3 m = normalize(n); float h = p.y - 1.1;
        float wf = pow(max(m.z, 0.0), 4.0), wb = pow(max(-m.z, 0.0), 4.0), ws = pow(abs(m.x), 4.0) + 0.7 * pow(abs(m.y), 4.0);
        // 臉：朝前的地方只用正面圖，五官才不會疊影
        float face = (1.0 - smoothstep(0.85, 1.25, length(vec2(p.x / 0.47, (p.y - 1.47) / 0.4)))) * smoothstep(0.35, 0.55, p.z) * smoothstep(0.35, 0.75, m.z);
        // 翹起的尾巴只用側面圖
        float tail = smoothstep(-0.35, -0.55, p.z) * smoothstep(1.15, 1.3, p.y);
        float bell = (1.0 - smoothstep(0.75, 1.4, length(vec2(p.x, p.y - 0.97) / 0.145))) * smoothstep(0.3, 0.5, p.z) * smoothstep(-0.1, 0.35, m.z);
        face = max(face, bell);
        wf = (wf + 6.0 * face) * (1.0 - tail); ws = ws * (1.0 - face) + tail; wb *= 1.0 - tail;
        vec3 c = panel(p.x, h, 0.0) * wf + panel(p.z + tail * p.x * abs(m.z) * 0.9, h, 1.0) * ws + panel(-p.x, h, 2.0) * wb;
        gl_FragColor = vec4(c / max(wf + ws + wb, 1e-4), 1.0);
        #include <colorspace_fragment>
      }`});
    const mesh = new THREE.Mesh(g, skin); mesh.frustumCulled = false; group.add(mesh);
    // 外框：沿法線外擴的背面
    const hull = g.clone(), hp = hull.attributes.position, hn = hull.attributes.normal;
    for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + hn.getX(i) * .034, hp.getY(i) + hn.getY(i) * .034, hp.getZ(i) + hn.getZ(i) * .034);
    const ink = new THREE.MeshBasicMaterial({color:P.ink, side:THREE.BackSide});
    ink.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n if (isOrthographic) mvPosition.z -= 0.1; else mvPosition.xyz += normalize(mvPosition.xyz) * 0.1; gl_Position = projectionMatrix * mvPosition;'); };
    const line = new THREE.Mesh(hull, ink); line.layers.set(HULL_LAYER); line.frustumCulled = false; group.add(line);
    ready && ready();
  }).catch(e => { console.error(e); fail && fail(e); });
  return {group, update(){}};
}

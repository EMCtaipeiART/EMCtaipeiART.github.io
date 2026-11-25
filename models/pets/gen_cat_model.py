# 生成版 3D 貓的模型：把圖生 3D 的原始 GLB（本機 pixel-plaza/ai-views/cat-glb/cat-shape-mv.glb，Hunyuan3D-2mv 用白膜四視角生成）
# 減面到 4 萬、腳底放在 y=0、高度 2.2，輸出 pixel-plaza/assets/pets3d-gen/cat.glb，並算正交視圖供貼圖對位。
# 執行：Blender --background --factory-startup --python models/pets/gen_cat_model.py -- 原始.glb 輸出.glb 預覽圖前綴
import bpy, sys, math, mathutils
src, out_glb, prefix = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in sc.objects if o.type == 'MESH']
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
if len(ms) > 1: bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = o.data
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
m = o.modifiers.new('d', 'DECIMATE'); m.ratio = min(1, 40000 / len(me.polygons)); bpy.ops.object.modifier_apply(modifier='d')
cs = [v.co for v in me.vertices]
lo = [min(c[i] for c in cs) for i in range(3)]; hi = [max(c[i] for c in cs) for i in range(3)]
s = 2.2 / (hi[2] - lo[2])
for v in me.vertices: v.co = ((v.co.x - (lo[0] + hi[0]) / 2) * s, (v.co.y - (lo[1] + hi[1]) / 2) * s, (v.co.z - lo[2]) * s)
for p in me.polygons: p.use_smooth = True
me.materials.clear(); me.update()
for other in list(sc.objects):
    if other != o: bpy.data.objects.remove(other)
print('FACES', len(me.polygons), [round((hi[i] - lo[i]) * s, 3) for i in range(3)])
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_normals=True, export_materials='NONE', export_texcoords=False)
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'; sc.display.shading.single_color = (.82, .8, .78); sc.display.shading.show_cavity = True
sc.render.resolution_x = sc.render.resolution_y = 1024
sc.world = bpy.data.worlds.new('w'); sc.world.color = (.35, .4, .38)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.6
# glTF (x, y, z) = Blender (x, z, -y)
for name, d in [('front', (0, -1, 0)), ('side', (-1, 0, 0)), ('back', (0, 1, 0))]:
    d = mathutils.Vector(d); cam.location = mathutils.Vector((0, 0, 1.1)) + d * 8; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = prefix + name + '.png'; bpy.ops.render.render(write_still=True)

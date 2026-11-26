# Eric 成品：AI 版的頭＋眼鏡（eric_ai.py），接上手工版的身體、手、腳（eric.py）
# 1) EXPORT=<暫存>/ai.glb Blender -b --factory-startup --python models/people/eric_ai.py -- <預覽資料夾>
# 2) Blender -b --factory-startup --python models/people/eric.py ，把 eric.glb 移成 <暫存>/hand.glb
# 3) Blender -b --factory-startup --python models/people/eric_combine.py -- hand.glb ai.glb pixel-plaza/assets/people3d/eric.glb
import bpy, sys
hand, ai, out = sys.argv[sys.argv.index('--') + 1:][:3]
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
def take(path, keep):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == 'MESH' and not keep(o.name): bpy.data.objects.remove(o)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
take(hand, lambda n: not n.startswith('machi_head__'))
take(ai, lambda n: n.startswith('machi_head__'))
# 同名節點會被加 .001，遊戲就認不出結尾的 _n（不描邊），改成編號放前面
for i, o in enumerate(sorted((o for o in bpy.data.objects if o.name.startswith('machi_head__glass')), key=lambda o: o.name)):
    o.name = 'machi_head__%s_%d_n' % (o.data.materials[0].name.split('.')[0], i)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=90)
print(sorted(o.name for o in bpy.data.objects if o.type == 'MESH'))

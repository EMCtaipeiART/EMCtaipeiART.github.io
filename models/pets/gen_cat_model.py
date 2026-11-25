# 生成版 3D 貓的模型：把圖生 3D 的原始 GLB（本機 pixel-plaza/ai-views/cat-glb/cat-shape-mv.glb，Hunyuan3D-2mv 用白膜四視角生成）
# 減面到 4 萬、腳底放在 y=0、高度 2.2，輸出 pixel-plaza/assets/pets3d-gen/cat.glb，並算正交視圖供貼圖對位。
# 執行：Blender --background --factory-startup --python models/pets/gen_cat_model.py -- 原始.glb 輸出.glb 預覽圖前綴
import bpy, sys, math, mathutils
src, out_glb, prefix, *flags = sys.argv[sys.argv.index('--') + 1:]
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
cs = [v.co for v in me.vertices]
lo = [min(c[i] for c in cs) for i in range(3)]; hi = [max(c[i] for c in cs) for i in range(3)]
s = 2.2 / (hi[2] - lo[2])
for v in me.vertices: v.co = ((v.co.x - (lo[0] + hi[0]) / 2) * s, (v.co.y - (lo[1] + hi[1]) / 2) * s, (v.co.z - lo[2]) * s)
if 'whiskers' in flags:   # 虎斑貓的鬍鬚被生成成一堆細管（和一根飄出的薄片）：臉頰範圍裡很薄的部分刪掉再補洞
    import bmesh, math
    import numpy as np
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(me); bm.normal_update(); tree = BVHTree.FromBMesh(bm)
    def thin(v, limit):
        hit = tree.ray_cast(v.co - v.normal * .0015, -v.normal)
        return hit[0] is not None and hit[3] < limit
    gone = []
    for v in bm.verts:
        x, y, z = v.co.x, -v.co.y, v.co.z                                     # y：朝前
        if abs(x) > .1 and 1.12 < z < 1.52 and y > .5 and thin(v, .04): gone.append(v)
        elif x < -.3 and .6 < z < 1.07 and -.25 < y < .7 and thin(v, .04): gone.append(v)  # 身側薄片
    print('THIN', len(gone))
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    def parts():
        seen = set()
        for v in bm.verts:
            if v in seen: continue
            stack = [v]; seen.add(v); part = []
            while stack:
                q = stack.pop(); part.append(q)
                for e in q.link_edges:
                    b = e.other_vert(q)
                    if b not in seen: seen.add(b); stack.append(b)
            yield part
    ps = list(parts()); big = max(ps, key=len)
    bmesh.ops.delete(bm, geom=[v for q in ps if q is not big for v in q], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    def refine():   # 補洞的大三角形切細，才抹得平
        long = [e for e in bm.edges if e.calc_length() > .025]
        if long: bmesh.ops.subdivide_edges(bm, edges=long, cuts=3)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    refine()
    cheek = [v for v in bm.verts if .12 < abs(v.co.x) < .56 and 1.12 < v.co.z < 1.5 and -v.co.y > .45]   # 鬚根的小疙瘩抹平
    for _ in range(150): bmesh.ops.smooth_vert(bm, verts=cheek, factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    from mathutils import Vector
    p0, d = Vector((-.2, .66)), Vector((.82, .35))   # 身側那道鬚狀薄片（前後, 高度）
    def near(v, r):
        q = Vector((-v.co.y, v.co.z)) - p0
        t = max(0, min(1, q.dot(d) / d.length_squared))
        return v.co.x < -.3 and (q - d * t).length < r
    strip = [v for v in bm.verts if near(v, .05)]
    bmesh.ops.delete(bm, geom=strip, context='VERTS')
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    refine()
    side = [v for v in bm.verts if near(v, .1)]
    for _ in range(80): bmesh.ops.smooth_vert(bm, verts=side, factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for cx in (-.25, .27):   # 鬍鬚根部殘留的小洞：整塊重做，點投影到周圍擬合出的曲面
        spot = lambda v, r: -v.co.y > .6 and ((v.co.x - cx) ** 2 + (v.co.z - 1.33) ** 2) ** .5 < r
        ring = [v for v in bm.verts if spot(v, .13) and not spot(v, .08) and v.normal.y < -.2]
        A = np.array([[1, v.co.x, v.co.z, v.co.x ** 2, v.co.z ** 2, v.co.x * v.co.z] for v in ring])
        k = np.linalg.lstsq(A, np.array([v.co.y for v in ring]), rcond=None)[0]
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if spot(v, .085)], context='VERTS')
        edges = [e for e in bm.edges if e.is_boundary and spot(e.verts[0], .15)]
        verts = {v for e in edges for v in e.verts}
        # 邊界依角度排序後封成一個面（不依賴邊界是否單純）
        loop = sorted(verts, key=lambda v: math.atan2(v.co.z - 1.33, v.co.x - cx))
        mid = bm.verts.new((cx, k @ [1, cx, 1.33, cx ** 2, 1.33 ** 2, cx * 1.33], 1.33))
        for a, b in zip(loop, loop[1:] + loop[:1]):
            try: bm.faces.new((mid, a, b))
            except ValueError: pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        refine()
        for v in bm.verts:
            if spot(v, .08): v.co.y = k @ [1, v.co.x, v.co.z, v.co.x ** 2, v.co.z ** 2, v.co.x * v.co.z]
        area = [v for v in bm.verts if spot(v, .13)]
        for _ in range(20): bmesh.ops.smooth_vert(bm, verts=area, factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.normal_update()
    print('OPEN', sum(e.is_boundary for e in bm.edges))
    bm.to_mesh(me); bm.free()
m = o.modifiers.new('d', 'DECIMATE'); m.ratio = min(1, 40000 / len(me.polygons)); bpy.ops.object.modifier_apply(modifier='d')
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

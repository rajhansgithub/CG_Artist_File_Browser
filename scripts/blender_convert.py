import sys
import os
import json
import math

def clean_scene():
    import bpy
    # Remove all meshes, objects, materials, cameras, lights
    bpy.ops.wm.read_factory_settings(use_empty=True)

def find_bounding_box(objects):
    import bpy
    from mathutils import Vector
    min_coord = Vector((float('inf'), float('inf'), float('inf')))
    max_coord = Vector((float('-inf'), float('-inf'), float('-inf')))
    has_mesh = False

    try:
        bpy.context.view_layer.update()
    except Exception:
        pass

    for obj in objects:
        if obj.type == 'MESH' and obj.bound_box:
            has_mesh = True
            for corner in [obj.matrix_world @ Vector(c) for c in obj.bound_box]:
                min_coord[0] = min(min_coord[0], corner[0])
                min_coord[1] = min(min_coord[1], corner[1])
                min_coord[2] = min(min_coord[2], corner[2])
                max_coord[0] = max(max_coord[0], corner[0])
                max_coord[1] = max(max_coord[1], corner[1])
                max_coord[2] = max(max_coord[2], corner[2])

    if not has_mesh or min_coord[0] == float('inf'):
        return Vector((-1, -1, -1)), Vector((1, 1, 1)), Vector((0, 0, 0)), 2.0

    center = (min_coord + max_coord) / 2.0
    size = max_coord - min_coord
    max_dim = max(size[0], size[1], size[2])
    return min_coord, max_coord, center, max_dim


def setup_studio_camera_and_lights(center, max_dim):
    import bpy
    from mathutils import Vector

    # Camera
    cam_data = bpy.data.cameras.new(name="ThumbnailCam")
    cam_data.lens = 45
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, max_dim * 25.0)

    cam_obj = bpy.data.objects.new("ThumbnailCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Position camera diagonally with tight framing
    dist = max(1.2, max_dim * 1.45)
    cam_obj.location = Vector((center.x + dist * 0.7, center.y - dist * 1.1, center.z + dist * 0.65))

    # Point camera at center
    direction = center - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()

    # World background setup: Dark neutral #0a0a0a
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("StudioWorld")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get('Background')
    if bg_node:
        bg_node.inputs['Color'].default_value = (0.04, 0.04, 0.04, 1.0)
        bg_node.inputs['Strength'].default_value = 1.0

    # Key light
    key_data = bpy.data.lights.new(name="KeyLight", type='AREA')
    key_data.energy = 600.0 * (dist ** 2) / 4.0
    key_data.size = max_dim * 1.8
    key_obj = bpy.data.objects.new("KeyLight", key_data)
    key_obj.location = Vector((center.x - dist, center.y - dist, center.z + dist * 1.2))
    bpy.context.scene.collection.objects.link(key_obj)

    # Fill light
    fill_data = bpy.data.lights.new(name="FillLight", type='AREA')
    fill_data.energy = 250.0 * (dist ** 2) / 4.0
    fill_data.size = max_dim * 2.2
    fill_obj = bpy.data.objects.new("FillLight", fill_data)
    fill_obj.location = Vector((center.x + dist * 1.4, center.y - dist * 0.5, center.z + dist * 0.5))
    bpy.context.scene.collection.objects.link(fill_obj)

    # Rim light
    rim_data = bpy.data.lights.new(name="RimLight", type='POINT')
    rim_data.energy = 350.0 * (dist ** 2) / 4.0
    rim_obj = bpy.data.objects.new("RimLight", rim_data)
    rim_obj.location = Vector((center.x, center.y + dist, center.z + dist * 0.8))
    bpy.context.scene.collection.objects.link(rim_obj)

def import_file(filepath):
    import bpy
    ext = os.path.splitext(filepath)[1].lower()
    
    if ext == '.abc':
        bpy.ops.wm.alembic_import(filepath=filepath, as_background_job=False)
    elif ext in ['.usd', '.usda', '.usdc', '.usdz']:
        bpy.ops.wm.usd_import(filepath=filepath)
    elif ext == '.obj':
        try:
            bpy.ops.wm.obj_import(filepath=filepath)
        except Exception:
            bpy.ops.import_scene.obj(filepath=filepath)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=filepath)
    elif ext in ['.gltf', '.glb']:
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == '.stl':
        try:
            bpy.ops.wm.stl_import(filepath=filepath)
        except Exception:
            bpy.ops.import_mesh.stl(filepath=filepath)
    elif ext == '.ply':
        try:
            bpy.ops.wm.ply_import(filepath=filepath)
        except Exception:
            bpy.ops.import_mesh.ply(filepath=filepath)
    else:
        raise ValueError(f"Unsupported format for Blender import: {ext}")

def main():
    import bpy

    # Arguments passed after "--"
    argv = sys.argv
    if "--" not in argv:
        print(json.dumps({"error": "No arguments provided after --"}))
        return

    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        print(json.dumps({"error": "Usage: blender -P blender_convert.py -- <mode> <input_path> [output_path]"}))
        return

    mode = args[0]
    input_path = os.path.abspath(args[1])
    output_path = os.path.abspath(args[2]) if len(args) > 2 else ""

    if not os.path.exists(input_path):
        print(json.dumps({"error": f"Input file not found: {input_path}"}))
        return

    try:
        clean_scene()
        import_file(input_path)

        mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        total_verts = sum(len(obj.data.vertices) for obj in mesh_objects)
        total_faces = sum(len(obj.data.polygons) for obj in mesh_objects)
        total_tris = sum(len(obj.data.loop_triangles) if hasattr(obj.data, 'loop_triangles') else len(obj.data.polygons) for obj in mesh_objects)

        min_coord, max_coord, center, max_dim = find_bounding_box(mesh_objects)
        dimensions = {
            "x": round(max_coord.x - min_coord.x, 3),
            "y": round(max_coord.y - min_coord.y, 3),
            "z": round(max_coord.z - min_coord.z, 3),
        }

        materials = set()
        for obj in mesh_objects:
            for mat_slot in obj.material_slots:
                if mat_slot.material:
                    materials.add(mat_slot.material.name)

        meta = {
            "success": True,
            "filename": os.path.basename(input_path),
            "vertices": total_verts,
            "faces": total_faces,
            "triangles": total_tris,
            "meshes": len(mesh_objects),
            "materials": list(materials),
            "dimensions": dimensions,
            "maxDimension": round(max_dim, 3)
        }

        if mode == "convert_glb" and output_path:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format='GLB',
                export_materials='EXPORT',
                export_animations=True,
                export_apply=True
            )
            meta["outputPath"] = output_path
            print("RESULT_JSON:" + json.dumps(meta))

        elif mode == "thumbnail" and output_path:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            setup_studio_camera_and_lights(center, max_dim)

            # Assign neutral clay material if mesh has no materials
            default_mat = bpy.data.materials.new(name="DefaultStudioClay")
            default_mat.use_nodes = True
            bsdf = default_mat.node_tree.nodes.get('Principled BSDF')
            if bsdf:
                bsdf.inputs['Base Color'].default_value = (0.6, 0.6, 0.6, 1.0)
                bsdf.inputs['Roughness'].default_value = 0.35

            for obj in mesh_objects:
                if not obj.data.materials:
                    obj.data.materials.append(default_mat)
                else:
                    for i in range(len(obj.data.materials)):
                        if obj.data.materials[i] is None:
                            obj.data.materials[i] = default_mat
            
            # Configure Cycles or EEVEE
            scene = bpy.context.scene
            scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderSettings') and 'BLENDER_EEVEE_NEXT' in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items else 'BLENDER_EEVEE'
            scene.render.resolution_x = 320
            scene.render.resolution_y = 160
            scene.render.film_transparent = False
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = output_path
            
            bpy.ops.render.render(write_still=True)
            meta["thumbnailPath"] = output_path
            print("RESULT_JSON:" + json.dumps(meta))

        elif mode == "metadata":
            print("RESULT_JSON:" + json.dumps(meta))

    except Exception as e:
        print("RESULT_JSON:" + json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()

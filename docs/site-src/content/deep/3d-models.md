---
title: 3D models
layer: deep
nav: 3D models
summary: The 3D viewer for OBJ, FBX, glTF, GLB, STL and PLY: shading, lights, cameras, turntable, animation and statistics.
order: 4
counterpart: quick/tour
---

## Opening a model

Models open in the 3D studio viewer: `.glb`, `.gltf`, `.obj`, `.fbx`, `.stl` and `.ply` directly, and `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc` and `.blend` after a background conversion. See [USD and Alembic](@deep/usd-outliner) for the conversion.

![The 3D viewer with the toolbar across the top and the model in the middle](media:viewer-3d.webp "A gem model in the studio viewer. The panel in the bottom left shows the mesh statistics.")

## Moving the camera

- Drag with the left button to orbit, the right button to pan and the wheel to zoom.
- `F` frames the model.
- The numpad keys snap to views: `1` front, `3` right, `7` top, and `Ctrl` with `1` or `3` for the back or left side. `5` switches between perspective and orthographic.
- The camera menu sets the focal length (18, 35, 50, 85 and 200 mm) and the free or fixed view.

![Orbiting a model](media:orbit-3d.gif "Left-drag to orbit. The model stays framed.")

## Shading

The shading list has the full PBR material, clay, wireframe, normal-map and matcap looks. Wireframe and grid buttons sit beside it. Clay and matcap modes show form and surface flow without colour, which is useful for checking dents and smooth curves.

## Smooth preview and mesh colours

**Smooth** (or `3`, like Maya) shows the meshes smoothed, as if they were subdivided twice. It only changes what you see. The file is not touched. It is off when a model opens, and press it again to go back to the original. Very dense models get fewer subdivisions, and a model that is too dense to smooth stays as it is with a short note. Skinned and animated-shape meshes are left as they are. The **Wireframe** button shows the smoothed lines while Smooth is on.

**Colors** (or `C`) gives every mesh its own colour, so it is easy to see where one part ends and the next begins. It works in the Shaded, Clay and Wireframe Overlay looks, and it is off when a model opens.

## Lights and the turntable

The lighting list sets the studio rig: the softbox, sunset, neutral and cyber presets. The **Light** slider turns the light rig around the model. **Turntable** spins the model at an adjustable speed for a quick look from every side.

## Animation

Rigged models with animation clips show playback controls, so you can play, pause and scrub through a clip.

## Statistics and snapshot

The statistics panel shows the number of vertices, triangles, meshes and materials and the model's size. **Snapshot** saves what you see as a PNG. You choose where the file goes.

## The outliner

Press `O` to open the outliner, which lists the parts of the scene. Click a part to select it and frame it. The [USD and Alembic](@deep/usd-outliner) page has an example.

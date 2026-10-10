---
title: Render textures (.tx and .tex)
layer: deep
nav: Render textures (.tx, .tex)
summary: Arnold .tx and RenderMan .tex textures: the mip levels and tiles, and the check for whether a texture is sharp enough at a given render size.
order: 8
counterpart: quick/tour
---

## What it is for

Renderers do not read a texture file as it is. Arnold (`.tx`) and RenderMan (`.tex`) convert it first into mip levels, smaller copies used when the object is far from the camera. This viewer shows those levels, so you can check the texture as the renderer will see it. It opens straight onto the **In the render** tab, and the **Texture** tab lets you browse the levels.

## The two tabs

- **Texture**: look at the texture itself, one mip level at a time. Wheel zooms and dragging pans. The buttons zoom in and out, and a double-click fits the texture to the screen.
- **In the render**: see the texture on the pixels of a final render. Choose the render size (1K, 2K, 3K, 4K or 8K), then slide how much of the frame the object covers, or type a size in pixels, such as 10 pixels. The texture is shown magnified so single pixels are visible.

## The verdict

The panel gives a plain-words verdict for the current settings: **Too soft**, **A little soft**, **Sharp enough**, **More than enough** or **Overkill**. It also says how big the texture needs to be and which mip level the renderer reads. A colour chart shows the verdict for every render size and distance for the open texture. Click a smaller mip level to test a question such as "is 2K enough?".

## What-if sizes

The texture size comes from the file. A **Texture size** choice lets you try a bigger size than the file, such as "what if this were 8K?". The verdict and the chart use that size and say so; the preview keeps showing the file's real pixels.

## Files it cannot read

Files based on OpenEXR, or using Pixar's compression, cannot be read here. The viewer says so instead of failing silently. A `.tex` file that is really a LaTeX document is also reported.

Use the left and right arrow keys to move to the next or previous texture in the folder, and `Esc` to close.

#!/usr/bin/env python3
"""
GPU-Accelerated Ken Burns Renderer
Renders image slideshows with zoom/pan effects using OpenGL.
Outputs raw RGB24 frames to stdout for FFmpeg encoding.
"""

import sys
import json
import struct
from typing import List, Dict, Any
import numpy as np
import moderngl
from PIL import Image

def easing_linear(t: float) -> float:
    """Linear easing: constant rate"""
    return t

def easing_smoothstep(t: float) -> float:
    """Smoothstep easing: slow start and end, fast middle"""
    return t * t * (3.0 - 2.0 * t)

def easing_ease_in_out(t: float) -> float:
    """Cubic ease in/out: smooth acceleration and deceleration"""
    if t < 0.5:
        return 2.0 * t * t
    else:
        return 1.0 - 2.0 * (1.0 - t) * (1.0 - t)

EASING_FUNCTIONS = {
    "linear": easing_linear,
    "smoothstep": easing_smoothstep,
    "ease_in_out": easing_ease_in_out,
}

# Vertex shader: textured quad with transform matrix
VERTEX_SHADER = """
#version 330
in vec2 in_position;
in vec2 in_texcoord;
out vec2 v_texcoord;
uniform mat4 transform;

void main() {
    gl_Position = transform * vec4(in_position, 0.0, 1.0);
    v_texcoord = in_texcoord;
}
"""

# Fragment shader: sample texture
FRAGMENT_SHADER = """
#version 330
in vec2 v_texcoord;
out vec4 fragColor;
uniform sampler2D texture0;

void main() {
    fragColor = texture(texture0, v_texcoord);
}
"""

def create_transform_matrix(scale: float, pan_x: float, pan_y: float, width: int, height: int) -> np.ndarray:
    """
    Create 4x4 transform matrix for Ken Burns effect.

    Args:
        scale: Zoom level (1.0 = no zoom, >1.0 = zoomed in)
        pan_x: Horizontal pan position (0.5 = center, 0.0 = left, 1.0 = right)
        pan_y: Vertical pan position (0.5 = center, 0.0 = top, 1.0 = bottom)
        width: Output frame width
        height: Output frame height

    Returns:
        4x4 numpy array (column-major for OpenGL)
    """
    # Convert normalized pan coordinates to clip space [-1, 1]
    # Pan 0.5 = center (no translation), 0.0 = move view left, 1.0 = move view right
    translate_x = (0.5 - pan_x) * 2.0
    translate_y = (0.5 - pan_y) * 2.0

    # Build transform matrix: translate then scale
    matrix = np.array([
        [scale, 0.0,   0.0, 0.0],
        [0.0,   scale, 0.0, 0.0],
        [0.0,   0.0,   1.0, 0.0],
        [translate_x, translate_y, 0.0, 1.0],
    ], dtype='f4')

    return matrix

def load_texture(ctx: moderngl.Context, image_path: str) -> moderngl.Texture:
    """Load image as OpenGL texture"""
    try:
        img = Image.open(image_path).convert('RGB')
        texture = ctx.texture(img.size, 3, img.tobytes())
        texture.filter = (moderngl.LINEAR, moderngl.LINEAR)  # Smooth filtering
        return texture
    except Exception as e:
        error = {"error": f"Failed to load image: {str(e)}", "image_path": image_path}
        print(json.dumps(error), file=sys.stderr, flush=True)
        sys.exit(1)

def render_scene(
    ctx: moderngl.Context,
    fbo: moderngl.Framebuffer,
    program: moderngl.Program,
    vao: moderngl.VertexArray,
    texture: moderngl.Texture,
    scene: Dict[str, Any],
    scene_index: int,
    width: int,
    height: int,
) -> None:
    """Render all frames for a single scene"""
    duration_frames = scene["duration_frames"]
    zoom_from = scene.get("zoom_from", 1.0)
    zoom_to = scene.get("zoom_to", 1.05)
    pan_from_x = scene.get("pan_from_x", 0.5)
    pan_from_y = scene.get("pan_from_y", 0.5)
    pan_to_x = scene.get("pan_to_x", pan_from_x)
    pan_to_y = scene.get("pan_to_y", pan_from_y)
    easing_name = scene.get("easing", "smoothstep")

    easing_func = EASING_FUNCTIONS.get(easing_name, easing_smoothstep)

    # Bind texture to sampler
    texture.use(0)
    program['texture0'] = 0

    for frame_idx in range(duration_frames):
        # Compute progress (0.0 to 1.0)
        progress = frame_idx / max(duration_frames - 1, 1)
        p = easing_func(progress)

        # Interpolate zoom and pan
        scale = zoom_from + (zoom_to - zoom_from) * p
        pan_x = pan_from_x + (pan_to_x - pan_from_x) * p
        pan_y = pan_from_y + (pan_to_y - pan_from_y) * p

        # Build transform matrix
        transform = create_transform_matrix(scale, pan_x, pan_y, width, height)
        program['transform'].write(transform.tobytes())

        # Render to framebuffer
        fbo.use()
        fbo.clear(0.0, 0.0, 0.0)  # Clear to black
        vao.render(moderngl.TRIANGLE_STRIP)

        # Read pixels (RGB24 format)
        pixels = fbo.read(components=3)

        # Write raw RGB24 to stdout (no buffering)
        sys.stdout.buffer.write(pixels)
        sys.stdout.buffer.flush()

        # Progress logging every 30 frames
        if frame_idx % 30 == 0:
            msg = f"[progress] Scene {scene_index + 1}, Frame {frame_idx + 1}/{duration_frames}"
            print(msg, file=sys.stderr, flush=True)

def main():
    """Main entry point"""
    try:
        # Read JSON spec from stdin
        spec = json.load(sys.stdin)
        scenes = spec["scenes"]
        width = spec["width"]
        height = spec["height"]
        fps = spec.get("fps", 30)

        # Create headless OpenGL context with EGL backend (for headless servers)
        # Try EGL first, fall back to default (X11) if that fails
        ctx = None
        try:
            ctx = moderngl.create_context(standalone=True, backend='egl')
            print("[info] Using EGL backend (headless mode)", file=sys.stderr, flush=True)
        except Exception as egl_error:
            print(f"[warning] EGL backend failed: {egl_error}", file=sys.stderr, flush=True)
            try:
                ctx = moderngl.create_standalone_context()
                print("[info] Using default backend", file=sys.stderr, flush=True)
            except Exception as ctx_error:
                error = {"error": f"Failed to create OpenGL context: {ctx_error}. Install EGL support for headless rendering."}
                print(json.dumps(error), file=sys.stderr, flush=True)
                sys.exit(1)

        # Create framebuffer for offscreen rendering
        fbo = ctx.simple_framebuffer((width, height))

        # Compile shaders
        program = ctx.program(
            vertex_shader=VERTEX_SHADER,
            fragment_shader=FRAGMENT_SHADER,
        )

        # Create fullscreen quad (two triangles as triangle strip)
        # Vertex format: (x, y, u, v)
        # Note: PIL images have (0,0) at top-left, so we flip V coordinates
        vertices = np.array([
            -1.0,  1.0,  0.0, 1.0,  # Top-left
             1.0,  1.0,  1.0, 1.0,  # Top-right
            -1.0, -1.0,  0.0, 0.0,  # Bottom-left
             1.0, -1.0,  1.0, 0.0,  # Bottom-right
        ], dtype='f4')

        vbo = ctx.buffer(vertices.tobytes())
        vao = ctx.simple_vertex_array(program, vbo, 'in_position', 'in_texcoord')

        # Render each scene
        for scene_index, scene in enumerate(scenes):
            image_path = scene["image_path"]

            # Load texture for this scene
            texture = load_texture(ctx, image_path)

            # Render all frames
            render_scene(ctx, fbo, program, vao, texture, scene, scene_index, width, height)

            # Release texture
            texture.release()

        # Success
        print(f"[success] Rendered {len(scenes)} scenes", file=sys.stderr, flush=True)
        sys.exit(0)

    except json.JSONDecodeError as e:
        error = {"error": f"Invalid JSON: {str(e)}"}
        print(json.dumps(error), file=sys.stderr, flush=True)
        sys.exit(1)
    except KeyError as e:
        error = {"error": f"Missing required field: {str(e)}"}
        print(json.dumps(error), file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as e:
        error = {"error": f"Unexpected error: {str(e)}"}
        print(json.dumps(error), file=sys.stderr, flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()

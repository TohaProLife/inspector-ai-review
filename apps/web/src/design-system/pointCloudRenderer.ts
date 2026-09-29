import { cloudPosition, cloudProgress, type CloudPoint } from "./architecturalPointCloud";

export interface CloudRenderer {
  draw(elapsed: number, pointerX: number, pointerY: number, width: number, height: number, ratio: number): void;
  dispose(): void;
}

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 aModel;
layout(location=1) in vec2 aExtra;
uniform vec2 uViewport;
uniform vec2 uPointer;
uniform float uScale;
uniform float uTime;
uniform float uRatio;
out float vShade;
out float vAlpha;
void main() {
  float isGuide = aExtra.y;
  float delay = isGuide > .5 ? .48 : .36 + (.5-aModel.y)*1.5 + aModel.w*.66;
  float duration = isGuide > .5 ? 2.4 : 3.15;
  float t = clamp((uTime-delay)/duration,0.,1.);
  t = t*t*(3.-2.*t);
  float spread = 1.-t;
  float angle = aModel.w*31.4159265 + spread*2.4;
  vec2 origin = vec2(cos(angle)*(.18+aModel.w*.3)+aModel.x*.15,
                     sin(angle)*(.12+aModel.w*.2)+aModel.y*.12);
  vec2 model = mix(origin,aModel.xy,t) + uPointer*aExtra.x*.025;
  vec2 pixel = model*uScale;
  gl_Position = vec4(pixel.x*2./uViewport.x,-pixel.y*2./uViewport.y,0.,1.);
  gl_PointSize = (isGuide > .5 ? 1.2 : .9 + aModel.z*1.35)*uRatio;
  vShade = aModel.z;
  vAlpha = (isGuide > .5 ? .28 : .20 + aModel.z*.74) * (.20 + t*.80);
}`;

const fragment = `#version 300 es
precision highp float;
in float vShade;
in float vAlpha;
out vec4 outColor;
void main() {
  float distanceToCenter = length(gl_PointCoord - .5);
  float circle = 1. - smoothstep(.32,.5,distanceToCenter);
  outColor = vec4(mix(vec3(.65,.82,1.),vec3(.96,.99,1.),vShade),circle*vAlpha);
}`;

function webglRenderer(gl: WebGL2RenderingContext, points: CloudPoint[]): CloudRenderer {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw Error("Unable to create particle shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) ?? "Particle shader failed");
    return shader;
  };
  const program = gl.createProgram(), buffer = gl.createBuffer(), array = gl.createVertexArray();
  if (!program || !buffer || !array) throw Error("Unable to allocate particle buffers");
  const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? "Particle program failed");
  gl.deleteShader(vs); gl.deleteShader(fs);
  const data = new Float32Array(points.length * 6);
  points.forEach((point, index) => data.set([point.x, point.y, point.shade, point.seed, point.depth, point.guide], index * 6));
  gl.bindVertexArray(array); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const viewport = gl.getUniformLocation(program, "uViewport"), pointer = gl.getUniformLocation(program, "uPointer");
  const scale = gl.getUniformLocation(program, "uScale"), time = gl.getUniformLocation(program, "uTime");
  const deviceRatio = gl.getUniformLocation(program, "uRatio");
  return {
    draw(elapsed, pointerX, pointerY, width, height, ratio) {
      gl.viewport(0, 0, Math.round(width * ratio), Math.round(height * ratio));
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program); gl.bindVertexArray(array);
      gl.uniform2f(viewport, width, height); gl.uniform2f(pointer, pointerX, pointerY);
      gl.uniform1f(scale, Math.min(width / 1.7, height / 1.07));
      gl.uniform1f(time, elapsed / 1000); gl.uniform1f(deviceRatio, ratio);
      gl.drawArrays(gl.POINTS, 0, points.length);
      gl.bindVertexArray(null);
    },
    dispose() { gl.deleteBuffer(buffer); gl.deleteVertexArray(array); gl.deleteProgram(program); },
  };
}

function canvasRenderer(context: CanvasRenderingContext2D, points: CloudPoint[]): CloudRenderer {
  const subset = points.filter((point, index) => point.guide || index % 3 === 0);
  return {
    draw(elapsed, pointerX, pointerY, width, height, ratio) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const scale = Math.min(width / 1.7, height / 1.07);
      for (let bucket = 0; bucket < 4; bucket++) {
        context.beginPath();
        for (const point of subset) {
          const level = point.guide ? 0 : Math.min(3, Math.floor(point.shade * 3.8));
          if (level !== bucket) continue;
          const progress = cloudProgress(point, elapsed);
          const position = cloudPosition(point, progress);
          const px = width / 2 + (position.x + pointerX * point.depth * .025) * scale;
          const py = height / 2 + (position.y + pointerY * point.depth * .025) * scale;
          if (px < 0 || py < 0 || px > width || py > height) continue;
          const radius = point.guide ? .6 : .65 + point.shade * .45;
          context.moveTo(px + radius, py); context.arc(px, py, radius, 0, Math.PI * 2);
        }
        context.fillStyle = ["rgba(187,220,255,.32)", "rgba(195,228,255,.46)", "rgba(224,246,255,.72)", "rgba(250,255,255,.93)"][bucket];
        context.fill();
      }
    },
    dispose() {},
  };
}

export function createCloudRenderer(canvas: HTMLCanvasElement, points: CloudPoint[]): CloudRenderer | null {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "low-power" }) as WebGL2RenderingContext | null;
  if (gl && typeof gl.createShader === "function") {
    try { return webglRenderer(gl, points); } catch { return null; }
  }
  const context = canvas.getContext("2d", { alpha: true });
  return context ? canvasRenderer(context, points) : null;
}

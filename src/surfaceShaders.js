// GLSL for atmospheric flight: the ground, the sky dome and the cloud layer over the local plane.
// Local frame: x east, y up, z south, one unit about six metres. The same single-scattering atmosphere as
// from space is evaluated in planet units: the camera sits straight above the planet centre at
// uRadius + y * uK, and the plane bends away with radius uCurvR = uRadius / uK, so ground, sky and haze agree.
import { NOISE_GLSL, ATMOSPHERE_GLSL, RAY_SPHERE } from './planetShaders';

const SURF_UNIFORMS = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uEast;
uniform vec3 uSouth;
uniform float uRmap;
uniform float uK;
uniform float uRadius;
uniform float uCurvR;
uniform vec3 uSunL;
uniform float uLight;
uniform float uTime;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform sampler2D uColorMap;
uniform sampler2D uAuxMap;
uniform float uCloudShift;
uniform float uCloudY;

// Direction from the planet centre (planet frame) of a point on the plane
vec3 planetDir(vec2 xz) {
  float r = length(xz);
  if (r < 1e-3) return uCenter;
  float th = r / uRmap;
  vec2 u = xz / r;
  return normalize(cos(th) * uCenter + sin(th) * (u.x * uEast + u.y * uSouth));
}

// A local point (y already bent by the curvature) in planet units, the camera above the planet centre
vec3 toPlanet(vec3 p) {
  vec2 d = (p.xz - cameraPosition.xz) * uK;
  return vec3(d.x, uRadius + p.y * uK, d.y);
}
vec3 camPlanet() {
  return vec3(0.0, uRadius + cameraPosition.y * uK, 0.0);
}

// A noise layer of wavelength wl that fades out where a pixel covers too much of it
float layer(vec2 xz, float wl, float foot, float seed) {
  float k = 1.0 - smoothstep(wl * 0.12, wl * 0.45, foot);
  if (k <= 0.0) return 0.0;
  return snoise(vec3(xz.x / wl, seed, xz.y / wl)) * k;
}
`;

const SUN_TRANSMIT = /* glsl */ `
// Sunlight left at planet point p after its way down through the atmosphere; nothing once the Sun has set
vec3 sunTransmit(vec3 p) {
  float r = length(p);
  float horizonCos = -sqrt(max(0.0, 1.0 - (uRadius * uRadius) / (r * r)));
  float vis = smoothstep(horizonCos - 0.012, horizonCos + 0.03, dot(p / r, uSunL));
  if (vis <= 0.0) return vec3(0.0);
  float tl = raySphere(p, uSunL, uAtmoTop).y;
  float dsl = tl / 6.0;
  float lR = 0.0;
  float lM = 0.0;
  for (int j = 0; j < 6; j++) {
    float hq = max(length(p + uSunL * ((float(j) + 0.5) * dsl)) - uRadius, 0.0);
    lR += exp(-hq / uHR) * dsl;
    lM += exp(-hq / uHM) * dsl;
  }
  return exp(-(uBetaR * lR + uBetaM * 1.1 * lM)) * vis;
}
`;

// Shared vertex stage for everything lying on the plane: bend it away from the camera with the curvature
export const PLANE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uCurvR;
attribute float depth;
varying vec3 vPos;
varying vec3 vNrm;
varying float vDepth;
varying float vDrop;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  vDepth = depth;
  vec2 d = wp.xz - cameraPosition.xz;
  vDrop = dot(d, d) / (2.0 * uCurvR);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz += mat3(viewMatrix) * vec3(0.0, -vDrop, 0.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

function prelude(atmo) {
  return NOISE_GLSL + (atmo ? ATMOSPHERE_GLSL + SURF_UNIFORMS + SUN_TRANSMIT : RAY_SPHERE + SURF_UNIFORMS);
}

export function terrainFragment(atmo) {
  return prelude(atmo) + /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uShipPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
varying vec3 vPos;
varying vec3 vNrm;
varying float vDepth;
varying float vDrop;

// The ship's own shadow on the ground below it, along the sunlight
float shipShadow(vec3 P) {
  if (uSunL.y <= 0.03) return 1.0;
  float t = (uShipPos.y - P.y) / uSunL.y;
  if (t <= 0.0) return 1.0;
  vec3 q = P + uSunL * t;
  vec2 d = q.xz - uShipPos.xz;
  float r = length(d * vec2(1.0, 0.8));
  return 1.0 - 0.7 * smoothstep(2.4, 0.9, r) * smoothstep(600.0, 60.0, t);
}

vec3 lin(vec3 c) { return toLinear(c); }

void main() {
  vec3 P = vec3(vPos.x, vPos.y - vDrop, vPos.z);
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N0 = normalize(vNrm);
  float slope = 1.0 - N0.y;
  float h = vPos.y;
  float foot = max(length(dFdx(vPos)), length(dFdy(vPos)));
  vec3 o = planetDir(vPos.xz);
  vec4 tex = texture2D(uColorMap, sphereUV(o));
  vec3 albedo = lin(tex.rgb);

  float v1 = layer(vPos.xz, 520.0, foot, 1.3);
  float v2 = layer(vPos.xz, 90.0, foot, 4.1);
  float v3 = layer(vPos.xz, 17.0, foot, 7.7);
  float v4 = layer(vPos.xz, 3.2, foot, 9.2);
  float bump = v2 * 6.0 + v3 * 1.6 + v4 * 0.35;
  float wet = 0.0;

#if defined(EARTH)
  wet = smoothstep(0.0, 0.6, vDepth);
  // The map is coarse: where it still shows sea on what is land here, take sand and grass instead
  vec3 grass = lin(vec3(0.36, 0.45, 0.22));
  vec3 sand = lin(vec3(0.78, 0.70, 0.52));
  albedo = mix(albedo, mix(grass, sand, smoothstep(14.0, 3.0, h)), smoothstep(0.15, 0.7, tex.a));
  albedo *= 0.8 + 0.25 * v1 + 0.18 * v2 + 0.16 * v3 + 0.1 * v4;
  float green = smoothstep(0.0, 0.04, albedo.g - albedo.r);
  albedo = mix(albedo, albedo * vec3(0.5, 0.66, 0.46), green * smoothstep(0.05, 0.45, v2 + 0.6 * v1));
  albedo = mix(albedo, sand * (0.9 + 0.2 * v3), smoothstep(7.0, 2.0, h) * (1.0 - wet));
  vec3 rock = lin(vec3(0.42, 0.39, 0.35)) * (0.8 + 0.3 * v2 + 0.15 * v3);
  float rockMix = smoothstep(0.26, 0.5, slope + 0.12 * v2);
  albedo = mix(albedo, rock, rockMix);
  float snowLine = mix(1250.0, 220.0, smoothstep(0.35, 0.85, abs(o.y))) + v1 * 130.0 + v2 * 30.0;
  float snow = smoothstep(snowLine - 35.0, snowLine + 35.0, h) * (1.0 - smoothstep(0.3, 0.55, slope));
  albedo = mix(albedo, vec3(0.82, 0.85, 0.9), snow);
  bump *= 1.0 + rockMix * 1.5;
#elif defined(MARS)
  albedo *= 0.82 + 0.22 * v1 + 0.16 * v2 + 0.14 * v3 + 0.08 * v4;
  vec3 rock = albedo * vec3(0.62, 0.55, 0.52);
  albedo = mix(albedo, rock, smoothstep(0.22, 0.45, slope + 0.1 * v2));
  albedo = mix(albedo, albedo * 1.12 + vec3(0.02, 0.01, 0.0), smoothstep(0.1, 0.0, slope) * 0.5);
#elif defined(MERCURY)
  albedo *= 0.85 + 0.2 * v1 + 0.14 * v2 + 0.12 * v3 + 0.08 * v4;
  albedo = mix(albedo, albedo * 0.75, smoothstep(0.25, 0.5, slope));
#elif defined(VENUS)
  // Basalt plains, darker on the flows, rough and rust-tinted on the highlands
  albedo = lin(vec3(0.34, 0.28, 0.23)) * (0.8 + 0.25 * v1 + 0.2 * v2 + 0.12 * v3);
  albedo = mix(albedo, lin(vec3(0.22, 0.19, 0.17)), smoothstep(0.1, 0.4, v1 + 0.3 * v2));
  albedo = mix(albedo, lin(vec3(0.42, 0.30, 0.22)), smoothstep(0.2, 0.45, slope));
#endif

  // Fine relief by bump mapping the detail noise (screen-space derivatives)
  vec3 N = N0;
  {
    vec3 dpdx = dFdx(vPos);
    vec3 dpdy = dFdy(vPos);
    float dbx = dFdx(bump);
    float dby = dFdy(bump);
    vec3 r1 = cross(dpdy, N0);
    vec3 r2 = cross(N0, dpdx);
    float det = dot(dpdx, r1);
    if (abs(det) > 1e-8) {
      vec3 grad = sign(det) * (dbx * r1 + dby * r2);
      N = normalize(abs(det) * N0 - grad * (1.0 - wet));
    }
  }

  vec3 Pp = toPlanet(P);
#ifdef HAS_ATMO
  vec3 sunT = sunTransmit(Pp);
#else
  vec3 sunT = vec3(smoothstep(-0.02, 0.03, uSunL.y));
#endif
  vec3 sunC = vec3(1.0, 0.97, 0.93) * uLight * sunT;
  float shade = shipShadow(P);
#if defined(EARTH)
  // Shadows of the clouds overhead
  if (uSunL.y > 0.05 && P.y < uCloudY) {
    vec3 q = P + uSunL * ((uCloudY - P.y) / uSunL.y);
    vec3 oq = planetDir(q.xz);
    float cover = texture2D(uAuxMap, sphereUV(rotY(oq, uCloudShift))).g;
    float n = snoise(vec3(q.x / 2200.0, uTime * 0.003, q.z / 2200.0));
    shade *= 1.0 - 0.6 * smoothstep(0.3, 0.7, cover + n * 0.3);
  }
#endif
  float lit = max(dot(N, uSunL), 0.0);
#if defined(VENUS)
  // Under the deck there is no Sun, only a dim orange glow from everywhere above
  vec3 color = albedo * uAmbient * (0.55 + 0.45 * N.y);
#else
  vec3 color = albedo * (sunC * lit * shade + uAmbient * (0.55 + 0.45 * N.y));
#endif

  // The ship's headlights, switched on in the dark
  if (uHeadOn > 0.0) {
    vec3 toP = P - uShipPos;
    float d = length(toP);
    vec3 l = toP / d;
    float cone = smoothstep(0.8, 0.96, dot(l, uHeadDir));
    color += albedo * vec3(1.0, 0.95, 0.85) * uHeadOn * cone * 3000.0 / (d * d + 300.0) * max(dot(N, -l), 0.0);
  }

#if defined(EARTH)
  // Water: shallow turquoise to deep blue, sky in the waves, the Sun's glint, surf along the shore
  if (vDepth > 0.0) {
    vec2 q = vPos.xz;
    float wk = 1.0 - smoothstep(4.0, 30.0, foot);
    float w = 0.0;
    w += snoise(vec3(q.x / 38.0, uTime * 0.12, q.y / 38.0)) * 0.5;
    w += snoise(vec3(q.x / 11.0 + 3.0, uTime * 0.25, q.y / 13.0)) * 0.25 * wk;
    w += snoise(vec3(q.x / 3.0, uTime * 0.6, q.y / 3.5 + 7.0)) * 0.08 * wk;
    vec3 dpdx = dFdx(vPos);
    vec3 dpdy = dFdy(vPos);
    vec3 r1 = cross(dpdy, vec3(0.0, 1.0, 0.0));
    vec3 r2 = cross(vec3(0.0, 1.0, 0.0), dpdx);
    float det = dot(dpdx, r1);
    vec3 Nw = vec3(0.0, 1.0, 0.0);
    if (abs(det) > 1e-8) Nw = normalize(abs(det) * Nw - sign(det) * (dFdx(w) * r1 + dFdy(w) * r2) * 0.9);
    vec3 deep = vec3(0.004, 0.02, 0.045);
    vec3 shallow = vec3(0.02, 0.11, 0.12);
    vec3 body = mix(shallow, deep, smoothstep(0.0, 70.0, vDepth));
    vec3 wcol = body * (sunC * max(uSunL.y, 0.0) * 0.6 + uAmbient);
    vec3 R = reflect(-V, Nw);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, sqrt(clamp(R.y, 0.0, 1.0)));
    wcol = mix(wcol, sky, fres);
    vec3 H = normalize(uSunL + V);
    float nh = max(dot(Nw, H), 0.0);
    wcol += sunC * (pow(nh, 700.0) * 18.0 + pow(nh, 60.0) * 0.08) * shade;
    float surf = smoothstep(2.5, 0.2, vDepth) * (0.6 + 0.4 * sin(uTime * 1.3 + vPos.x * 0.05 + vPos.z * 0.04 + v3 * 3.0));
    wcol = mix(wcol, vec3(0.8) * (sunC * max(uSunL.y, 0.0) + uAmbient), clamp(surf, 0.0, 1.0) * 0.7);
    color = mix(color, wcol, wet);
  }
  // City lights on the night side
  float night = 1.0 - smoothstep(-0.08, 0.06, uSunL.y);
  if (night > 0.0 && vDepth <= 0.0) {
    // Settlements on flat lowland only: single lamps close up, blocks of town, a faint glow from afar
    float city = texture2D(uAuxMap, sphereUV(o)).r * smoothstep(0.22, 0.08, slope) * smoothstep(450.0, 120.0, h);
    if (city > 0.0) {
      float blocks = smoothstep(0.0, 0.5, snoise(vec3(vPos.x / 70.0, 8.1, vPos.z / 70.0)) + 0.3 * snoise(vec3(vPos.x / 300.0, 2.2, vPos.z / 300.0)));
      float lamps = smoothstep(0.7, 0.92, snoise(vec3(vPos.x / 2.6, 3.3, vPos.z / 2.6)));
      float near = 1.0 - smoothstep(0.8, 5.0, foot);
      float lit = blocks * mix(0.06, lamps, near);
      color += vec3(1.0, 0.66, 0.32) * city * lit * night * 1.4;
    }
  }
#endif

#if defined(VENUS)
  // Thick, glowing haze
  color = mix(color, uFogColor, 1.0 - exp(-dist / 2400.0));
#elif defined(HAS_ATMO)
  vec3 ro = camPlanet();
  vec3 seg = Pp - ro;
  float segLen = length(seg);
  vec3 ins;
  vec3 tr;
  atmosphere(ro, seg / segLen, segLen, uSunL, uRadius, ins, tr);
  color = color * tr + ins;
#endif
  gl_FragColor = vec4(color, 1.0);
  #include <logdepthbuf_fragment>
}
`;
}

// Sky dome around the camera: scattering on top of the stars (one / one-minus-alpha blending), the Sun's disc
export const DOME_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

export function domeFragment(atmo) {
  return prelude(atmo) + /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uSunCos;
uniform float uDeckY;
varying vec3 vWorld;
void main() {
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 ro = camPlanet();
  float mu = dot(rd, uSunL);
  float disc = smoothstep(uSunCos - 0.00004, uSunCos + 0.00002, mu);
  float halo = pow(max(mu, 0.0), 900.0) * 0.6;
  vec2 tg = raySphere(ro, rd, uRadius);
  bool ground = tg.x <= tg.y && tg.x > 0.0;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
#if defined(VENUS)
  if (cameraPosition.y < uDeckY) {
    // Under the deck: an even, orange-brown glow, brighter overhead
    col = uFogColor * (0.75 + 0.5 * smoothstep(-0.1, 0.8, rd.y));
    gl_FragColor = vec4(col, 1.0);
    #include <logdepthbuf_fragment>
    return;
  }
#endif
#ifdef HAS_ATMO
  vec3 ins;
  vec3 tr;
  atmosphere(ro, rd, ground ? tg.x : 1e9, uSunL, uRadius, ins, tr);
  col = ins;
  if (ground) {
    col += uAmbient * 0.3 * tr;
    alpha = 1.0;
  } else {
    col += vec3(1.0, 0.95, 0.85) * uLight * (disc * 40.0 + halo) * tr;
    alpha = 1.0 - dot(tr, vec3(1.0 / 3.0));
  }
#else
  if (ground) {
    col = uAmbient * 0.2;
    alpha = 1.0;
  } else {
    col = vec3(1.0, 0.97, 0.92) * uLight * (disc * 40.0 + halo * 0.4);
  }
#endif
  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
}
`;
}

// A layer of cloud (Earth) or the closed cloud deck (Venus), drawn from above and below
export function cloudFragment(atmo) {
  return prelude(atmo) + /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uExtent;
varying vec3 vPos;
varying vec3 vNrm;
varying float vDepth;
varying float vDrop;
void main() {
  vec3 P = vec3(vPos.x, vPos.y - vDrop, vPos.z);
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  float foot = max(length(dFdx(vPos)), length(dFdy(vPos)));
  vec3 o = planetDir(vPos.xz);
  bool above = cameraPosition.y > vPos.y;
  float edge = 1.0 - smoothstep(uExtent * 0.7, uExtent * 0.98, length(vPos.xz - cameraPosition.xz));
#if defined(VENUS)
  float n = layer(vPos.xz, 1800.0, foot, 2.0) * 0.5 + layer(vPos.xz, 400.0, foot, 5.0) * 0.25 + layer(vPos.xz, 90.0, foot, 8.0) * 0.12;
  vec3 color;
  float alpha = 1.0;
  if (above) {
    vec3 top = toLinear(texture2D(uColorMap, sphereUV(o)).rgb) * (0.9 + 0.2 * n);
    vec3 Pp = toPlanet(P);
    vec3 sunT = sunTransmit(Pp);
    color = top * (vec3(1.0, 0.97, 0.93) * uLight * sunT * (0.25 + 0.75 * max(uSunL.y, 0.0)) + uAmbient);
    vec3 ro = camPlanet();
    vec3 seg = Pp - ro;
    float segLen = length(seg);
    vec3 ins;
    vec3 tr;
    atmosphere(ro, seg / segLen, segLen, uSunL, uRadius, ins, tr);
    color = color * tr + ins;
  } else {
    color = uFogColor * (0.6 + 0.25 * n);
    color = mix(color, uFogColor, 1.0 - exp(-dist / 2400.0));
  }
  gl_FragColor = vec4(color, alpha * edge);
#else
  float cover = texture2D(uAuxMap, sphereUV(rotY(o, uCloudShift))).g;
  float n = layer(vPos.xz, 2200.0, foot, 1.0) * 0.5 + layer(vPos.xz, 700.0, foot, 2.5) * 0.3 + layer(vPos.xz, 180.0, foot, 6.0) * 0.18 + layer(vPos.xz, 45.0, foot, 9.0) * 0.08;
  float c = smoothstep(0.32, 0.72, cover + n * 0.55);
  if (c < 0.01) discard;
  vec3 Pp = toPlanet(P);
  vec3 sunT = sunTransmit(Pp);
  vec3 sunC = vec3(1.0, 0.97, 0.93) * uLight * sunT;
  vec3 color;
  if (above) {
    color = vec3(0.92) * (sunC * (0.35 + 0.65 * max(uSunL.y, 0.0)) * (0.85 + 0.25 * n) + uAmbient * 0.8);
  } else {
    // Undersides: light shines through thin cloud, thick cloud is dark
    color = vec3(0.8) * (sunC * max(uSunL.y, 0.0) * mix(0.55, 0.12, c) + uAmbient * mix(0.9, 0.45, c));
  }
  vec3 ro = camPlanet();
  vec3 seg = Pp - ro;
  float segLen = length(seg);
  vec3 ins;
  vec3 tr;
  atmosphere(ro, seg / segLen, segLen, uSunL, uRadius, ins, tr);
  color = color * tr + ins;
  gl_FragColor = vec4(color, c * 0.94 * edge);
#endif
  #include <logdepthbuf_fragment>
}
`;
}

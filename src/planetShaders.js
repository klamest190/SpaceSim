// GLSL for the planets: baking their surface maps once on the GPU, then drawing surface, clouds,
// atmosphere, rings and the Sun. All lighting happens in planet-local space (planet centre at the
// origin, world orientation), so huge world coordinates never reach the fragment math.

export const NOISE_GLSL = /* glsl */ `
const float PI = 3.141592653589793;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT), range about -1..1
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(17.1, 4.3, 9.7);
    amp *= 0.5;
  }
  return sum;
}

// Sharp crests: mountain chains, canyons
float ridged(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float prev = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    p = p * 2.07 + vec3(3.7, 11.3, 5.1);
    amp *= 0.5;
  }
  return sum;
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

// Rotation about the y (spin) axis, same sense as three.js rotation.y
vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// Equirectangular lookup without a seam: of two longitudes whose cut lies elsewhere, take the smooth one
vec2 sphereUV(vec3 d) {
  float lon = atan(d.z, d.x);
  float u1 = lon / (2.0 * PI) + 0.5;
  float u2 = fract(u1 + 0.5) - 0.5;
  float u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2;
  return vec2(u, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// How many octaves of detail noise (first octave: features of 1 / freq world units) this pixel can resolve
float detailOctaves(vec3 pos, float freq) {
  float footprint = max(length(dFdx(pos)), length(dFdy(pos)));
  return clamp(log2(1.0 / (freq * footprint * 2.5)), 0.0, 5.0);
}
`;

// Ray against a sphere at the origin: entry and exit distance, or (1e9, -1e9) on a miss
export const RAY_SPHERE = /* glsl */ `
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Whether a ray from ro along rd runs into the sphere ahead of it
bool hitsSphere(vec3 ro, vec3 rd, float r) {
  vec2 t = raySphere(ro, rd, r);
  return t.x <= t.y && t.y > 0.0;
}
`;

// Single scattering through an exponential atmosphere (Rayleigh + Mie), planet-local units
export const ATMOSPHERE_GLSL = RAY_SPHERE + /* glsl */ `
uniform float uAtmoTop;
uniform float uHR;
uniform float uHM;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uMieG;
uniform float uSunE;

#ifndef ATMO_STEPS
#define ATMO_STEPS 10
#endif

// Haze that scatters some colours more than others and swallows the rest (Titan's orange smog);
// plain grey Mie scattering with a little absorption otherwise
#ifdef MIE_TINT
uniform vec3 uMieCol;
uniform vec3 uMieExt;
#define MIE_SCA (uBetaM * uMieCol)
#define MIE_EXT (uBetaM * uMieExt)
#else
#define MIE_SCA vec3(uBetaM)
#define MIE_EXT vec3(uBetaM * 1.1)
#endif

void atmosphere(vec3 ro, vec3 rd, float tMax, vec3 sunDir, float radius, out vec3 inscatter, out vec3 transmit) {
  inscatter = vec3(0.0);
  transmit = vec3(1.0);
  vec2 ta = raySphere(ro, rd, uAtmoTop);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  if (t1 <= t0) return;

  float odR = 0.0;
  float odM = 0.0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
#ifdef ATMO_FIXED_STEP
  // Equal steps for every ray, so a deep haze looks the same just inside and just outside the solid disc
  float ds = 2.0 * sqrt(uAtmoTop * uAtmoTop - radius * radius) / float(ATMO_STEPS);
  for (int i = 0; i < ATMO_STEPS * 2; i++) {
    float sa = t0 + float(i) * ds;
    if (sa >= t1) break;
    float seg = min(ds, t1 - sa);
    vec3 p = ro + rd * (sa + 0.5 * seg);
#else
  float ds = (t1 - t0) / float(ATMO_STEPS);
  for (int i = 0; i < ATMO_STEPS; i++) {
    float seg = ds;
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds);
#endif
    float h = max(length(p) - radius, 0.0);
    float dR = exp(-h / uHR) * seg;
    float dM = exp(-h / uHM) * seg;
    odR += dR;
    odM += dM;
    // Points in the planet's shadow get no sunlight; the edge is soft, like a real terminator
    float r = length(p);
    float horizonCos = -sqrt(max(0.0, 1.0 - (radius * radius) / (r * r)));
    float sunVis = smoothstep(horizonCos - 0.01, horizonCos + 0.05, dot(p / r, sunDir));
    if (sunVis > 0.0) {
      float tl = raySphere(p, sunDir, uAtmoTop).y;
      float dsl = tl / 4.0;
      float lR = 0.0;
      float lM = 0.0;
      for (int j = 0; j < 4; j++) {
        float hq = max(length(p + sunDir * ((float(j) + 0.5) * dsl)) - radius, 0.0);
        lR += exp(-hq / uHR) * dsl;
        lM += exp(-hq / uHM) * dsl;
      }
      vec3 att = exp(-(uBetaR * (odR + lR) + MIE_EXT * (odM + lM))) * sunVis;
      sumR += dR * att;
      sumM += dM * att;
    }
  }
  float mu = dot(rd, sunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uMieG;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  inscatter = uSunE * (sumR * uBetaR * phaseR + sumM * MIE_SCA * phaseM);
  transmit = exp(-(uBetaR * odR + MIE_EXT * odM));
}
`;

// ---------------------------------------------------------------------------------------------
// Baking: one fullscreen pass per map. Pass 0 = colour (rgb albedo in sRGB, a = ocean mask or
// height), pass 1 = Earth's extra map (r = city lights, g = cloud cover, b = height).
// ---------------------------------------------------------------------------------------------

export const BAKE_VERTEX = /* glsl */ `
uniform vec4 uTile;
varying vec2 vUv;
void main() {
  vUv = uTile.xy + uv * uTile.zw;
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT = NOISE_GLSL + /* glsl */ `
uniform int uPass;
uniform float uSeed;
varying vec2 vUv;

vec3 dirFromUV(vec2 uv) {
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
}

// Direction of a point at latitude / longitude in degrees
vec3 dirAt(float latDeg, float lonDeg) {
  float lat = radians(latDeg);
  float lon = radians(lonDeg);
  return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
}

// Impact craters on the unit sphere: bowl, raised rim, central peak; glow = fresh bright ejecta
float craterLayer(vec3 p, float freq, float density, inout float glow) {
  vec3 q = p * freq;
  vec3 i = floor(q);
  vec3 f = fract(q);
  float h = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 rnd = hash33(i + o + uSeed);
    if (rnd.z > density) continue;
    vec3 c = o + 0.2 + 0.6 * rnd - f;
    float r = 0.16 + 0.3 * fract(rnd.x * 7.31 + rnd.y);
    float d = length(c) / r;
    if (d > 2.5) continue;
    float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
    float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.3;
    float peak = r > 0.36 ? 0.35 * exp(-d * d * 28.0) : 0.0;
    float ejecta = d > 1.0 ? 0.06 * exp(-(d - 1.0) * 3.0) : 0.0;
    h += (bowl + rim + peak + ejecta) * r;
    // A few young craters keep bright ejecta blankets
    if (freq < 12.0 && fract(rnd.y * 13.7) > 0.9) glow = max(glow, exp(-max(d - 0.9, 0.0) * 2.0));
  }
  return h / freq;
}

float craters(vec3 p, float scale, inout float glow) {
  float h = 0.0;
  h += craterLayer(p, 3.0 * scale, 0.35, glow) * 1.0;
  h += craterLayer(p, 7.0 * scale, 0.5, glow) * 1.0;
  h += craterLayer(p, 16.0 * scale, 0.6, glow) * 0.9;
  h += craterLayer(p, 34.0 * scale, 0.6, glow) * 0.6;
  return h;
}

// Twist p around the axis c: a cyclone of the given strength and size
vec3 swirl(vec3 p, vec3 c, float strength, float size) {
  float d = distance(p, c);
  float a = strength * exp(-d * d / (size * size));
  vec3 axis = c;
  return p * cos(a) + cross(axis, p) * sin(a) + axis * dot(axis, p) * (1.0 - cos(a));
}

// Moons are tidally locked: longitude 0 faces their planet, and east longitudes (as on the maps) lie towards -z
vec3 selDir(float latDeg, float lonEastDeg) {
  return dirAt(latDeg, -lonEastDeg);
}

float angleTo(vec3 p, vec3 c) {
  return acos(clamp(dot(p, c), -1.0, 1.0));
}

// One named crater: bowl, rim and central peak, radius r in radians
float bowl(vec3 p, vec3 c, float r) {
  float d = angleTo(p, c) / r;
  float b = d < 1.0 ? (d * d - 1.0) : 0.0;
  float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.3;
  float peak = 0.35 * exp(-d * d * 28.0);
  return (b + rim + peak) * r;
}

// Bright rays of a young crater, thrown out over len radians, broken up along their length
float crRays(vec3 p, vec3 c, float len, float seed) {
  float d = angleTo(p, c);
  vec3 t1 = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(c, t1);
  float az = atan(dot(p, t2), dot(p, t1));
  vec2 a = vec2(cos(az), sin(az));
  float streak = pow(max(snoise(vec3(a * 5.0, seed)), 0.0), 1.5) + pow(max(snoise(vec3(a * 13.0, seed + 3.0)), 0.0), 2.0);
  float broken = 0.55 + 0.45 * snoise(vec3(a * 13.0, d * 25.0 + seed));
  float halo = exp(-pow(d / (len * 0.1), 2.0));
  return clamp(streak * broken * exp(-d / len) * 1.6 + halo * 0.9, 0.0, 1.0);
}

#ifdef LUNA
// A lava plain around (lat, lon) of angular radius r: soft, so neighbouring basins flow into one another
float mare(vec3 p, float lat, float lon, float r) {
  return exp(-1.5 * pow(angleTo(p, selDir(lat, lon)) / (r * 1.35), 2.0));
}

void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  vec3 q = normalize(p + 0.11 * vec3(fbm(p * 3.0, 5), fbm(p * 3.0 + 3.0, 5), fbm(p * 3.0 + 6.0, 5))
                       + 0.035 * vec3(fbm(p * 11.0, 4), fbm(p * 11.0 + 5.0, 4), fbm(p * 11.0 + 9.0, 4)));
  // The maria of the near side where they really are, a few small ones at the limb and on the far side
  float m = mare(q, 33.0, -16.0, 0.30);          // Imbrium
  m += (mare(q, 28.0, 17.5, 0.19));         // Serenitatis
  m += (mare(q, 8.5, 31.0, 0.21));          // Tranquillitatis
  m += (mare(q, 17.0, 59.0, 0.14));         // Crisium
  m += (mare(q, -7.8, 51.3, 0.16));         // Fecunditatis
  m += (mare(q, -15.0, 35.0, 0.09));        // Nectaris
  m += (mare(q, -21.0, -16.6, 0.16));       // Nubium
  m += (mare(q, -24.4, -38.6, 0.11));       // Humorum
  m += (mare(q, -10.0, -23.0, 0.10));       // Cognitum
  m += (mare(q, 7.5, -31.0, 0.13));         // Insularum
  m += (mare(q, 13.3, 3.6, 0.08));          // Vaporum
  m += (mare(q, 22.0, -55.0, 0.31));        // Oceanus Procellarum, vast and ragged
  m += (mare(q, 2.0, -50.0, 0.24));
  m += (mare(q, 38.0, -42.0, 0.19));
  m += (mare(q, -10.0, -56.0, 0.14));
  m += (mare(q, 1.3, 87.0, 0.09));          // Smythii
  m += (mare(q, 13.0, 86.0, 0.07));         // Marginis
  m += (mare(q, -38.0, 93.0, 0.10) * 0.7);  // Australe, patchy
  m += (mare(q, 27.0, 148.0, 0.06));        // Moscoviense on the far side
  m += (mare(q, -19.0, -93.0, 0.045));      // the heart of Orientale
  m = max(m, 1.0 - smoothstep(0.022, 0.03, angleTo(p, selDir(51.6, -9.4))));   // Plato's dark floor
  m = max(m, 1.0 - smoothstep(0.04, 0.052, angleTo(q, selDir(-5.5, -68.3)))); // Grimaldi
  // Mare Frigoris: a long thin band in the far north
  float latD = degrees(asin(clamp(q.y, -1.0, 1.0)));
  float lonE = -degrees(atan(q.z, q.x));
  float frig = exp(-pow((latD - 56.0) / 5.0, 2.0)) * smoothstep(-62.0, -30.0, lonE) * smoothstep(55.0, 25.0, lonE);
  m = max(m, frig);
  // Ragged shores: the plains flood the low ground unevenly
  m = smoothstep(0.36, 0.62, m + 0.22 * fbm(p * 7.0 + 21.0, 5));
  m = clamp(m * (0.9 + 0.2 * fbm(p * 11.0, 3)), 0.0, 1.0);

  // South Pole-Aitken: the oldest, deepest basin, a little darker
  float spa = 1.0 - smoothstep(0.6, 1.05, angleTo(q, selDir(-53.0, -169.0)));
  // Orientale's rings
  float dO = angleTo(p, selDir(-19.4, -92.8));
  float rings = exp(-pow((dO - 0.27) / 0.012, 2.0)) + 0.7 * exp(-pow((dO - 0.18) / 0.01, 2.0)) + 0.5 * exp(-pow((dO - 0.12) / 0.008, 2.0));

  float glow = 0.0;
  float crater = craters(p, 1.3, glow);
  float h = fbm(p * 2.5, 6) * 0.06 + 0.03 * ridged(p * 5.0, 4);
  h = h * (1.0 - m * 0.8) + crater * mix(1.3, 0.3, m) - m * 0.03 - spa * 0.06 + rings * 0.02;
  h += bowl(p, selDir(-43.3, -11.2), 0.026) * 1.2   // Tycho
     + bowl(p, selDir(9.6, -20.1), 0.028) * 1.2      // Copernicus
     + bowl(p, selDir(-58.4, -14.4), 0.066) * 0.6    // Clavius
     + bowl(p, selDir(8.1, -38.0), 0.01)             // Kepler
     + bowl(p, selDir(23.7, -47.4), 0.012);          // Aristarchus

  // Bright anorthosite highlands, dark basalt maria: titanium-rich ones bluish, iron-rich ones brownish
  vec3 high = mix(vec3(0.60, 0.585, 0.56), vec3(0.73, 0.71, 0.67), smoothstep(-0.3, 0.4, fbm(p * 3.0 + 7.0, 5)));
  vec3 mareC = mix(vec3(0.27, 0.285, 0.31), vec3(0.34, 0.32, 0.29), smoothstep(-0.35, 0.35, fbm(p * 2.2 + 13.0, 4)));
  vec3 c = mix(high, mareC, m);
  c *= mix(vec3(1.0), vec3(0.86, 0.84, 0.82), spa * 0.6);
  c *= 0.9 + 0.2 * fbm(p * 40.0, 3);
  float ray = crRays(p, selDir(-43.3, -11.2), 0.3, 1.0)
            + crRays(p, selDir(9.6, -20.1), 0.13, 5.0) * 0.8
            + crRays(p, selDir(8.1, -38.0), 0.07, 9.0) * 0.6
            + crRays(p, selDir(23.7, -47.4), 0.05, 13.0) * 0.7;
  c = mix(c, vec3(0.82, 0.81, 0.78), clamp(ray, 0.0, 1.0) * 0.45);
  c += glow * vec3(0.12);
  col = vec4(c, h);
  aux = vec4(0.0);
}
#endif

#ifdef IO
// Volcanic centres by latitude and west longitude: xy position, z: size of the dark patera, w: heat
const vec4 IO_VOLC[10] = vec4[10](
  vec4(-18.7, 255.3, 0.035, 1.0),  // Pele: lava lake inside a great red ring
  vec4(13.0, 309.0, 0.06, 0.9),    // Loki: the largest lava lake
  vec4(-1.5, 153.0, 0.02, 0.6),    // Prometheus
  vec4(63.0, 124.0, 0.03, 0.8),    // Tvashtar
  vec4(24.0, 115.0, 0.02, 0.6),    // Amirani
  vec4(-28.0, 210.0, 0.02, 0.5),   // Marduk
  vec4(-8.0, 325.0, 0.02, 0.4),    // Ra
  vec4(-45.0, 55.0, 0.018, 0.5),   // Masubi
  vec4(-20.0, 160.0, 0.022, 0.5),  // Culann
  vec4(18.0, 173.0, 0.018, 0.4)    // Zamama
);

void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  vec3 w = vec3(fbm(p * 2.0, 4), fbm(p * 2.0 + 5.0, 4), fbm(p * 2.0 + 9.0, 4));
  float n1 = fbm(p * 3.0 + w * 0.8, 6);
  float n2 = fbm(p * 7.0 + w * 1.5 + 4.0, 5);
  // Sulfur in every shade: yellow plains, white sulfur-dioxide frost near the equator, orange and tan patches
  vec3 c = mix(vec3(0.88, 0.79, 0.40), vec3(0.93, 0.90, 0.75), smoothstep(0.0, 0.45, n1) * (1.0 - smoothstep(0.45, 0.95, abs(p.y))));
  c = mix(c, vec3(0.87, 0.57, 0.28), smoothstep(0.12, 0.5, n2) * 0.7);
  c = mix(c, vec3(0.72, 0.60, 0.42), smoothstep(-0.1, -0.45, n1) * 0.6);
  c = mix(c, vec3(0.70, 0.75, 0.40), smoothstep(0.3, 0.55, fbm(p * 5.0 + 20.0, 4)) * 0.35);
  // Reddish-brown poles
  float polar = smoothstep(0.55, 0.85, abs(p.y) + 0.12 * fbm(p * 4.0 + 2.0, 4));
  c = mix(c, vec3(0.56, 0.38, 0.25), polar * 0.8);
  float h = fbm(p * 3.0, 6) * 0.04;
  // A few lonely mountains, steeper than any on Earth
  h += smoothstep(0.55, 0.8, fbm(p * 6.0 + 30.0, 5)) * 0.08;

  float hot = 0.0;
  // Hundreds of small paterae: dark lava floors, some with red or white deposits around them
  vec3 qq = p * 9.0;
  vec3 ci = floor(qq);
  vec3 cf = fract(qq);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 rnd = hash33(ci + o + uSeed);
    if (rnd.z > 0.4) continue;
    vec3 cc = o + 0.2 + 0.6 * rnd - cf;
    float r = 0.06 + 0.12 * fract(rnd.x * 5.3 + rnd.y);
    float d = length(cc) / r + 0.35 * snoise(p * 60.0 + rnd * 10.0);
    float halo = exp(-pow((d - 1.6) / 0.7, 2.0)) * step(0.5, fract(rnd.y * 7.1));
    vec3 haloCol = fract(rnd.x * 3.7) > 0.5 ? vec3(0.78, 0.36, 0.20) : vec3(0.95, 0.93, 0.85);
    c = mix(c, haloCol, halo * 0.55);
    float floorM = 1.0 - smoothstep(0.8, 1.0, d);
    c = mix(c, vec3(0.10, 0.08, 0.06), floorM * 0.9);
    h -= floorM * 0.01;
    hot = max(hot, floorM * step(0.75, fract(rnd.y * 13.3)) * 0.5);
  }
  // The great volcanoes: plume deposits as rings, lava lakes black and glowing
  for (int i = 0; i < 10; i++) {
    vec4 v = IO_VOLC[i];
    vec3 vc = selDir(v.x, -v.y);
    float d = angleTo(p, vc) + 0.012 * snoise(p * 40.0 + float(i));
    if (i == 0 || i == 3) {
      // Pele and Tvashtar: wide rings of red short-chain sulfur fallen from their umbrella plumes
      float ring = exp(-pow((d - 0.3) / 0.07, 2.0)) * (0.7 + 0.3 * snoise(p * 18.0));
      c = mix(c, vec3(0.80, 0.30, 0.16), clamp(ring, 0.0, 1.0) * 0.8);
    } else {
      float ring = exp(-pow((d - v.z * 3.0) / (v.z * 1.5), 2.0));
      c = mix(c, i == 2 ? vec3(0.95, 0.94, 0.88) : vec3(0.72, 0.42, 0.24), ring * 0.6);
    }
    float lake = 1.0 - smoothstep(v.z * 0.7, v.z, d);
    c = mix(c, vec3(0.06, 0.05, 0.04), lake);
    // Fresh flows: dark tongues running off downhill
    float flow = (1.0 - smoothstep(v.z, v.z * 4.0, d)) * smoothstep(0.2, 0.6, snoise(p * 25.0 + float(i) * 3.0));
    c = mix(c, vec3(0.16, 0.12, 0.10), flow * 0.7);
    hot = max(hot, lake * v.w + flow * v.w * 0.35);
  }
  c *= 0.93 + 0.12 * fbm(p * 30.0, 3);
  col = vec4(c, h);
  aux = vec4(hot, 0.0, 0.0, 1.0);
}
#endif

#ifdef EUROPA
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  // Clean water ice, faintly blue-white
  vec3 ice = vec3(0.90, 0.92, 0.93);
  vec3 c = ice * (0.94 + 0.08 * fbm(p * 6.0, 4));
  // The trailing hemisphere is stained tan and red by sulfur raining in from Io's torus
  float trail = smoothstep(-0.3, 0.9, dot(p, selDir(0.0, 90.0)));
  c = mix(c, vec3(0.82, 0.70, 0.56), trail * 0.45);
  vec3 wq = p + 0.08 * vec3(fbm(p * 3.0, 4), fbm(p * 3.0 + 4.0, 4), fbm(p * 3.0 + 8.0, 4));
  // Chaos terrain: ice rafts broken up and frozen into a brown matrix
  float mott = fbm(wq * 4.0 + 3.0, 6);
  float chaos = smoothstep(0.3, 0.5, mott + 0.15 * trail - 0.08);
  float rafts = smoothstep(0.1, 0.35, fbm(p * 38.0, 4));
  c = mix(c, vec3(0.64, 0.46, 0.33) * (0.85 + 0.3 * fbm(p * 70.0, 3)), chaos * (0.75 - 0.5 * rafts));
  // Mottled lowlands: soft brown freckles
  float freckle = smoothstep(0.25, 0.55, fbm(wq * 9.0 + 40.0, 5)) * (0.4 + 0.6 * trail);
  c = mix(c, vec3(0.70, 0.55, 0.42), freckle * 0.35);

  // Lineae: long cracks along great circles, reddish brown, many as double ridges with a bright middle
  float lin = 0.0;
  float mid = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 r = hash33(vec3(float(i) * 7.13, uSeed + 1.7, 3.1));
    vec3 r2 = hash33(vec3(float(i) * 3.71, 9.2, uSeed));
    vec3 n = normalize(r * 2.0 - 1.0);
    vec3 ax = normalize(cross(n, normalize(r2 * 2.0 - 1.0)));
    float span = 0.5 + 1.4 * r2.z;
    float fade = 1.0 - smoothstep(span * 0.6, span, angleTo(p, ax));
    float dist = abs(dot(p, n) + 0.006 * snoise(p * 7.0 + float(i)));
    float wdt = 0.002 + 0.005 * r.x;
    float band = exp(-pow(dist / wdt, 2.0)) * fade;
    lin = max(lin, band * (0.45 + 0.55 * r.z));
    mid = max(mid, exp(-pow(dist / (wdt * 0.3), 2.0)) * fade * step(0.45, r.y));
  }
  // A finer web of younger cracks
  float web = (1.0 - smoothstep(0.0, 0.035, abs(snoise(wq * 14.0)))) * smoothstep(-0.2, 0.3, fbm(p * 3.0 + 50.0, 3));
  web = max(web, (1.0 - smoothstep(0.0, 0.03, abs(snoise(wq * 33.0 + 7.0)))) * 0.6);
  vec3 lineCol = vec3(0.56, 0.33, 0.21);
  c = mix(c, lineCol, clamp(lin * 0.8 + web * 0.35 * (1.0 - chaos), 0.0, 1.0));
  c = mix(c, ice * 1.03, mid * 0.5);
  // Pwyll: a young crater whose bright rays reach across half the hemisphere
  vec3 pw = selDir(-25.0, -271.0);
  c = mix(c, vec3(0.97, 0.96, 0.93), crRays(p, pw, 0.25, 4.0) * 0.5);
  c = mix(c, vec3(0.45, 0.35, 0.28), 1.0 - smoothstep(0.008, 0.014, angleTo(p, pw)));
  float h = lin * 0.012 + web * 0.004 - chaos * 0.004 + fbm(p * 8.0, 4) * 0.004 + bowl(p, pw, 0.012) * 0.3;
  col = vec4(c, h);
  aux = vec4(0.0);
}
#endif

#ifdef TITAN
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  float n = fbm(p * 2.5, 6);
  float latD = degrees(asin(clamp(p.y, -1.0, 1.0)));
  vec3 c = mix(vec3(0.40, 0.29, 0.17), vec3(0.60, 0.47, 0.30), smoothstep(-0.2, 0.3, n));
  // Dark dune seas around the equator, the dunes running east-west
  float dunes = exp(-pow(latD / 24.0, 2.0)) * smoothstep(-0.1, 0.25, fbm(p * 1.8 + 4.0, 4));
  float ripples = 0.75 + 0.25 * sin(latD * 9.0 + 4.0 * fbm(p * 6.0, 3));
  c = mix(c, vec3(0.19, 0.13, 0.09) * ripples, dunes * 0.85);
  // Xanadu, the bright highland
  float xan = 1.0 - smoothstep(0.25, 0.45, angleTo(p, selDir(-10.0, -100.0)) + 0.12 * fbm(p * 5.0, 4));
  c = mix(c, vec3(0.74, 0.62, 0.45), xan);
  // Lakes and seas of liquid methane and ethane around the north pole, a few in the south
  float north = smoothstep(55.0, 75.0, latD + 12.0 * fbm(p * 3.0 + 9.0, 4));
  float south = smoothstep(-72.0, -82.0, latD) * 0.6;
  float seas = smoothstep(0.05, 0.12, fbm(p * 4.0 + 17.0, 5) + 0.25 * north - 0.2) * max(north, south);
  c = mix(c, vec3(0.03, 0.035, 0.04), seas);
  col = vec4(c, seas);
  aux = vec4(0.0);
}
#endif

#ifdef EARTH
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  vec3 q = p * 1.15;
  vec3 warp = vec3(fbm(q + vec3(3.1, 0.0, 0.0), 4), fbm(q + vec3(0.0, 7.7, 0.0), 4), fbm(q + vec3(0.0, 0.0, 1.9), 4));
  float cont = fbm(q + warp * 0.6, 8);
  // Antarctica: a continent around the south pole
  cont += smoothstep(0.82, 0.95, -p.y) * 0.35;
  float mask = smoothstep(0.0, 0.2, cont);
  float mountains = ridged(p * 3.2 + warp * 1.2, 7) * mask;
  float sea = 0.02;
  float h = cont + mountains * 0.35;
  float land = smoothstep(sea - 0.003, sea + 0.003, h);
  float elev = max(h - sea, 0.0);
  float depth = max(sea - h, 0.0);

  float lat = abs(p.y);
  float temp = 1.0 - pow(lat, 1.35) * 1.2 - elev * 1.4 + 0.12 * fbm(p * 3.0 + 40.0, 3);
  float moist = 0.55 + 0.5 * fbm(p * 2.3 + 11.0, 5) - 0.42 * exp(-pow((lat - 0.42) / 0.12, 2.0));
  moist += 0.25 * exp(-elev * 12.0) * smoothstep(0.3, 0.0, depth) - 0.15 * smoothstep(0.05, 0.25, elev);
  moist = clamp(moist, 0.0, 1.0);
  temp = clamp(temp, 0.0, 1.0);

  // Biomes (sRGB): dry to wet, cold to hot
  vec3 sand = mix(vec3(0.83, 0.70, 0.48), vec3(0.70, 0.47, 0.30), smoothstep(-0.3, 0.4, fbm(p * 9.0, 3)));
  vec3 steppe = vec3(0.58, 0.55, 0.34);
  vec3 grass = vec3(0.33, 0.43, 0.19);
  vec3 forest = vec3(0.15, 0.29, 0.10);
  vec3 jungle = vec3(0.08, 0.22, 0.06);
  vec3 tundra = vec3(0.43, 0.42, 0.33);
  vec3 rock = vec3(0.40, 0.36, 0.31);
  vec3 snow = vec3(0.94, 0.95, 0.97);

  vec3 warm = mix(mix(sand, steppe, smoothstep(0.18, 0.38, moist)), mix(grass, jungle, smoothstep(0.6, 0.85, moist)), smoothstep(0.35, 0.6, moist));
  vec3 mild = mix(mix(steppe, grass, smoothstep(0.25, 0.45, moist)), forest, smoothstep(0.5, 0.75, moist));
  vec3 cold = mix(tundra, mix(forest, tundra, 0.45), smoothstep(0.4, 0.8, moist));
  vec3 landCol = mix(cold, mild, smoothstep(0.25, 0.45, temp));
  landCol = mix(landCol, warm, smoothstep(0.55, 0.75, temp));
  landCol = mix(landCol, rock, smoothstep(0.16, 0.32, elev + 0.05 * snoise(p * 30.0)));
  float snowLine = smoothstep(0.08, 0.0, temp + 0.04 * snoise(p * 25.0)) + smoothstep(0.4, 0.55, elev + 0.06 * snoise(p * 40.0));
  landCol = mix(landCol, snow, clamp(snowLine, 0.0, 1.0));
  landCol *= 0.9 + 0.2 * fbm(p * 40.0, 3);

  vec3 deepSea = vec3(0.012, 0.055, 0.15);
  vec3 shallow = mix(vec3(0.03, 0.20, 0.30), vec3(0.05, 0.36, 0.42), smoothstep(0.5, 0.9, temp));
  vec3 seaCol = mix(deepSea, shallow, exp(-depth * 30.0));
  seaCol *= 0.92 + 0.12 * fbm(p * 6.0 + 9.0, 3);

  float seaIce = smoothstep(0.90, 0.95, lat + 0.03 * fbm(p * 12.0, 3));
  float ocean = (1.0 - land) * (1.0 - seaIce);
  vec3 surface = mix(seaCol, landCol, land);
  surface = mix(surface, snow * 0.97, seaIce * (1.0 - land));

  // Cities: settled lowlands of the temperate and warm belts, clustered and thickest near the coasts
  float habitable = land * (1.0 - clamp(snowLine, 0.0, 1.0)) * smoothstep(0.25, 0.5, temp) * smoothstep(0.12, 0.4, moist) * exp(-elev * 6.0);
  float coastal = exp(-elev * 30.0);
  float regions = smoothstep(0.12, 0.5, fbm(p * 7.0 + 5.0, 4) + 0.25 * coastal);
  float towns = pow(max(snoise(p * 150.0), 0.0), 2.0) + 0.8 * pow(max(snoise(p * 55.0), 0.0), 3.0) + 0.5 * pow(max(snoise(p * 380.0), 0.0), 4.0);
  float lights = clamp(habitable * regions * towns * 1.6, 0.0, 1.0);

  // Clouds: warped turbulence, storm belts at mid latitudes, clear subtropics, a few cyclones
  vec3 cp = p;
  cp = swirl(cp, normalize(vec3(0.6, 0.5, 0.62)), 3.0, 0.16);
  cp = swirl(cp, normalize(vec3(-0.7, -0.55, 0.3)), -3.2, 0.15);
  cp = swirl(cp, normalize(vec3(0.1, 0.25, -0.95)), 2.4, 0.12);
  cp = swirl(cp, normalize(vec3(-0.3, 0.75, -0.55)), 2.8, 0.13);
  vec3 cq = cp * vec3(2.2, 3.0, 2.2);
  vec3 cw = vec3(fbm(cq * 0.8 + 1.3, 4), fbm(cq * 0.8 + 7.1, 4), fbm(cq * 0.8 + 3.9, 4));
  float c = fbm(cq + cw * 0.7, 6) * 0.5 + 0.5;
  // Small puffy cells and streets on top of the large weather systems
  c += 0.13 * fbm(p * 20.0 + cw * 2.5, 4);
  float belt = 0.45 + 0.3 * exp(-pow((lat - 0.85) / 0.25, 2.0)) + 0.25 * exp(-pow(lat / 0.08, 2.0)) - 0.25 * exp(-pow((lat - 0.4) / 0.12, 2.0));
  float clouds = smoothstep(0.6 - belt * 0.24, 0.82 - belt * 0.2, c);
  clouds = clamp(clouds, 0.0, 1.0);

  col = vec4(surface, ocean);
  aux = vec4(lights, clouds, elev * land * 1.6, 1.0);
}
#endif

#ifdef MARS
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  vec3 warp = vec3(fbm(p * 1.4 + 2.0, 4), fbm(p * 1.4 + 8.0, 4), fbm(p * 1.4 + 5.0, 4));
  float base = fbm(p * 1.8 + warp * 0.5, 8);
  // Southern highlands, northern lowlands
  float highlands = smoothstep(-0.25, 0.25, -p.y + 0.35 * fbm(p * 1.3 + 4.0, 4));
  float glow = 0.0;
  float crater = craters(p, 1.0, glow) * mix(0.35, 1.0, highlands);
  // Tharsis bulge with its great shield volcanoes
  vec3 tharsis = dirAt(2.0, -110.0);
  float bulge = exp(-pow(distance(p, tharsis) / 0.45, 2.0)) * 0.25;
  float volcano = exp(-pow(distance(p, dirAt(18.0, -134.0)) / 0.11, 2.0)) * 0.9
                + exp(-pow(distance(p, dirAt(-9.0, -121.0)) / 0.05, 2.0)) * 0.4
                + exp(-pow(distance(p, dirAt(2.0, -112.0)) / 0.05, 2.0)) * 0.4
                + exp(-pow(distance(p, dirAt(13.0, -104.0)) / 0.05, 2.0)) * 0.4;
  float caldera = exp(-pow(distance(p, dirAt(18.0, -134.0)) / 0.018, 2.0)) * 0.25;
  // A great canyon along the equator east of Tharsis
  float canyonBand = exp(-pow((p.y + 0.12 + 0.03 * snoise(p * 9.0)) / 0.035, 2.0));
  float lonDeg = degrees(atan(p.z, p.x));
  float canyonSpan = smoothstep(-100.0, -85.0, lonDeg) * smoothstep(-25.0, -45.0, lonDeg);
  float canyon = canyonBand * canyonSpan * (0.7 + 0.3 * ridged(p * 12.0, 4));
  float h = base * 0.35 + highlands * 0.22 + crater * 1.1 + bulge + volcano - caldera - canyon * 0.45;

  float albedoVar = fbm(p * 1.9 + warp * 0.3, 6);
  vec3 bright = vec3(0.82, 0.55, 0.36);
  vec3 mid = vec3(0.72, 0.44, 0.27);
  vec3 dark = vec3(0.40, 0.29, 0.22);
  vec3 c = mix(bright, mid, smoothstep(-0.15, 0.2, albedoVar));
  c = mix(c, dark, smoothstep(0.22, 0.42, albedoVar + 0.1 * (1.0 - highlands)) * 0.85);
  c = mix(c, vec3(0.56, 0.38, 0.28), canyon * 0.6);
  c *= 0.88 + 0.24 * fbm(p * 30.0, 3);
  c += glow * vec3(0.05, 0.035, 0.025);
  // Polar caps of water and carbon-dioxide ice
  float cap = smoothstep(0.90, 0.94, abs(p.y) + 0.035 * fbm(p * 10.0, 4) + (p.y > 0.0 ? 0.015 : 0.0));
  c = mix(c, vec3(0.95, 0.92, 0.88), cap);
  col = vec4(c, h);
  aux = vec4(0.0);
}
#endif

#ifdef MERCURY
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  float glow = 0.0;
  float crater = craters(p, 1.0, glow);
  float base = fbm(p * 2.0, 7);
  float h = base * 0.15 + crater * 1.4 + 0.04 * ridged(p * 6.0, 5);
  vec3 c = mix(vec3(0.47, 0.45, 0.43), vec3(0.36, 0.34, 0.33), smoothstep(-0.3, 0.3, fbm(p * 2.5 + 3.0, 5)));
  c = mix(c, vec3(0.55, 0.52, 0.47), smoothstep(0.2, 0.5, fbm(p * 1.5 + 9.0, 4)) * 0.6);
  c *= 0.9 + 0.2 * fbm(p * 35.0, 3);
  c += glow * vec3(0.2, 0.19, 0.18);
  col = vec4(c, h);
  aux = vec4(0.0);
}
#endif

#ifdef VENUS
void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  // A closed, super-rotating cloud deck: streaks along the latitudes, a dark sideways Y at the equator
  vec3 q = vec3(p.x, p.y * 3.0, p.z);
  vec3 warp = vec3(fbm(q * 1.2, 4), fbm(q * 1.2 + 5.0, 4), fbm(q * 1.2 + 9.0, 4));
  float n = fbm(q * 2.0 + warp * 0.8, 7);
  float lon = atan(p.z, p.x);
  float chevron = exp(-pow((abs(p.y) * 2.2 - 0.6 * cos(lon * 0.5 + 1.0)) / 0.3, 2.0)) * smoothstep(0.7, 0.0, abs(p.y));
  vec3 cream = vec3(0.93, 0.85, 0.66);
  vec3 ochre = vec3(0.78, 0.62, 0.40);
  vec3 c = mix(cream, ochre, smoothstep(-0.3, 0.4, n + chevron * 0.5));
  c = mix(c, vec3(0.97, 0.93, 0.82), smoothstep(0.75, 0.95, abs(p.y)) * 0.7);
  c *= 0.93 + 0.1 * fbm(p * 18.0, 3);
  col = vec4(c, 0.5);
  aux = vec4(0.0);
}
#endif

#ifdef GAS
// Band colour by latitude for each giant
vec3 bandColor(float lat, float n) {
#if defined(JUPITER)
  // Belts (dark) and zones (light) at their real latitudes, in degrees
  float d = degrees(lat) + n * 1.2;
  float edge = 1.2;
  float dark = 0.0;
  dark += smoothstep(7.0 - edge, 7.0 + edge, d) * (1.0 - smoothstep(18.0 - edge, 18.0 + edge, d));       // north equatorial belt
  dark += smoothstep(-20.0 - edge, -20.0 + edge, d) * (1.0 - smoothstep(-7.0 - edge, -7.0 + edge, d));   // south equatorial belt
  dark += 0.75 * smoothstep(24.0 - edge, 24.0 + edge, d) * (1.0 - smoothstep(31.0 - edge, 31.0 + edge, d));
  dark += 0.7 * smoothstep(-33.0 - edge, -33.0 + edge, d) * (1.0 - smoothstep(-27.0 - edge, -27.0 + edge, d));
  dark += 0.55 * smoothstep(40.0 - edge, 40.0 + edge, d) * (1.0 - smoothstep(45.0 - edge, 45.0 + edge, d));
  dark += 0.5 * smoothstep(-45.0 - edge, -45.0 + edge, d) * (1.0 - smoothstep(-40.0 - edge, -40.0 + edge, d));
  float fineBands = 0.5 + 0.5 * sin(lat * 60.0 + n * 0.5);
  vec3 zone = vec3(0.94, 0.90, 0.81);
  vec3 belt = mix(vec3(0.58, 0.37, 0.24), vec3(0.66, 0.46, 0.32), fineBands);
  vec3 c = mix(zone, belt, clamp(dark, 0.0, 1.0));
  c *= 0.92 + 0.08 * fineBands;
  // Ochre equatorial zone, grey-brown polar regions
  c = mix(c, vec3(0.88, 0.72, 0.52), (1.0 - smoothstep(4.0, 7.0, abs(d))) * 0.55);
  c = mix(c, vec3(0.56, 0.52, 0.48), smoothstep(48.0, 62.0, abs(d)));
  return c;
#elif defined(SATURN)
  float b = 0.5 + 0.5 * sin(lat * 22.0 + 0.6 * sin(lat * 7.0) + n * 0.5);
  vec3 c = mix(vec3(0.84, 0.73, 0.53), vec3(0.92, 0.85, 0.68), smoothstep(0.3, 0.7, b));
  c = mix(c, vec3(0.95, 0.88, 0.70), exp(-pow(lat / 0.12, 2.0)) * 0.6);
  c = mix(c, vec3(0.62, 0.64, 0.66), smoothstep(1.2, 1.5, lat) * 0.7);
  c = mix(c, vec3(0.72, 0.64, 0.54), smoothstep(1.15, 1.45, -lat));
  return c;
#elif defined(URANUS)
  float b = 0.5 + 0.5 * sin(lat * 12.0 + n * 0.4);
  vec3 c = mix(vec3(0.56, 0.78, 0.82), vec3(0.62, 0.84, 0.87), b * 0.6);
  c = mix(c, vec3(0.78, 0.92, 0.93), smoothstep(0.7, 1.3, lat) * 0.8);
  return c;
#else
  float b = 0.5 + 0.5 * sin(lat * 14.0 + 0.5 * sin(lat * 4.0) + n * 0.6);
  vec3 c = mix(vec3(0.17, 0.29, 0.70), vec3(0.27, 0.45, 0.88), smoothstep(0.2, 0.8, b));
  c = mix(c, vec3(0.14, 0.23, 0.58), smoothstep(1.0, 1.4, abs(lat)));
  return c;
#endif
}

void bakePlanet(vec3 p, out vec4 col, out vec4 aux) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  vec3 sp = p;
#if defined(JUPITER)
  // The great red storm, its wake, and a string of white ovals
  vec3 grs = dirAt(-22.0, 40.0);
  sp = swirl(sp, grs, -2.6, 0.13);
  sp = swirl(sp, dirAt(-34.0, -60.0), 2.2, 0.035);
  sp = swirl(sp, dirAt(-34.0, -20.0), 2.2, 0.035);
  sp = swirl(sp, dirAt(-34.0, 100.0), 2.2, 0.035);
  sp = swirl(sp, dirAt(-41.0, 160.0), 2.0, 0.03);
  float turbAmp = 0.03;
#elif defined(SATURN)
  float turbAmp = 0.025;
#elif defined(URANUS)
  float turbAmp = 0.012;
#else
  sp = swirl(sp, dirAt(-22.0, -30.0), -2.5, 0.1);
  float turbAmp = 0.035;
#endif
  float slat = asin(clamp(sp.y, -1.0, 1.0));
  // Turbulence: strongly stretched along the latitudes, sheared most at the band edges
  vec3 tq = vec3(sp.x * 2.5, sp.y * 16.0, sp.z * 2.5);
  vec3 tw = vec3(fbm(tq * 0.5, 4), fbm(tq * 0.5 + 4.0, 4), fbm(tq * 0.5 + 8.0, 4));
  float turb = fbm(tq + tw * 0.9, 7);
  float shear = 0.5 + 0.5 * abs(cos(slat * 15.0));
  float n = turb * (0.6 + shear);
  vec3 c = bandColor(slat + turb * turbAmp * shear, n);
  float fine = fbm(vec3(sp.x * 12.0, sp.y * 60.0, sp.z * 12.0) + tw * 3.0, 4);
#if defined(URANUS)
  c *= 0.98 + 0.04 * fine;
#else
  c *= 0.94 + 0.12 * fine;
#endif
#if defined(JUPITER)
  float dGrs = distance(p * vec3(1.0, 1.6, 1.0), grs * vec3(1.0, 1.6, 1.0));
  float spot = smoothstep(0.15, 0.07, dGrs);
  c = mix(c, mix(vec3(0.74, 0.33, 0.20), vec3(0.85, 0.50, 0.32), smoothstep(0.0, 0.08, dGrs) * (0.6 + 0.4 * fine)), spot);
  c = mix(c, vec3(0.95, 0.92, 0.86), smoothstep(0.17, 0.15, dGrs) * smoothstep(0.12, 0.15, dGrs) * 0.5);
  float ovals = smoothstep(0.03, 0.015, distance(p, dirAt(-34.0, -60.0))) + smoothstep(0.03, 0.015, distance(p, dirAt(-34.0, -20.0)))
              + smoothstep(0.03, 0.015, distance(p, dirAt(-34.0, 100.0))) + smoothstep(0.028, 0.013, distance(p, dirAt(-41.0, 160.0)));
  c = mix(c, vec3(0.97, 0.95, 0.92), clamp(ovals, 0.0, 1.0) * 0.9);
#elif defined(SATURN)
  // The hexagon around the north pole
  float polar = PI * 0.5 - lat;
  float hexR = 0.27 / cos(mod(lon + PI / 6.0, PI / 3.0) - PI / 6.0);
  float hexEdge = smoothstep(0.012, 0.0, abs(polar - hexR));
  c = mix(c, vec3(0.56, 0.60, 0.62), smoothstep(hexR, hexR - 0.03, polar) * 0.45);
  c = mix(c, vec3(0.86, 0.80, 0.66), hexEdge * 0.6);
  c = mix(c, vec3(0.40, 0.45, 0.52), smoothstep(0.06, 0.0, polar));
#elif defined(NEPTUNE)
  vec3 spotC = dirAt(-22.0, -30.0);
  float dSpot = distance(p * vec3(1.0, 1.5, 1.0), spotC * vec3(1.0, 1.5, 1.0));
  c = mix(c, vec3(0.08, 0.13, 0.38), smoothstep(0.1, 0.05, dSpot));
  // Bright methane cirrus, high and streaky
  float cirrus = smoothstep(0.45, 0.75, fbm(vec3(p.x * 4.0, p.y * 30.0, p.z * 4.0) + 3.0, 5) + 0.2 * smoothstep(0.12, 0.08, dSpot));
  c = mix(c, vec3(0.88, 0.92, 1.0), cirrus * 0.85);
#endif
  col = vec4(c, 0.5);
  aux = vec4(0.0);
}
#endif

// Pass 2, read back by the CPU for flights over the ground: rg = height (16 bit, scaled into uGroundRange),
// b = open water, a = cloud cover. Venus's map shows only its cloud deck, so its ground is made up here.
uniform vec2 uGroundRange;
vec4 groundData(vec3 p, vec4 col, vec4 aux) {
  float h = 0.0;
  float water = 0.0;
  float cloud = 0.0;
#if defined(EARTH)
  h = aux.b / 1.6;
  water = col.a;
  cloud = aux.g;
#elif defined(HEIGHT_IN_ALPHA)
  h = col.a;
#elif defined(VENUS)
  // Volcanic plains, a few great shield volcanoes, folded highlands
  vec3 warp = vec3(fbm(p * 1.6 + 3.0, 4), fbm(p * 1.6 + 7.0, 4), fbm(p * 1.6 + 1.0, 4));
  float plains = fbm(p * 2.2 + warp * 0.5, 7) * 0.22;
  float highland = smoothstep(0.1, 0.35, fbm(p * 1.3 + 9.0, 4));
  float tesserae = ridged(p * 6.0 + warp, 6) * 0.35 * highland;
  float volcano = exp(-pow(distance(p, dirAt(25.0, -150.0)) / 0.09, 2.0)) * 0.55
                + exp(-pow(distance(p, dirAt(-20.0, 60.0)) / 0.07, 2.0)) * 0.4
                + exp(-pow(distance(p, dirAt(5.0, 10.0)) / 0.06, 2.0)) * 0.35;
  h = plains + highland * 0.18 + tesserae + volcano;
#endif
  float hn = clamp((h - uGroundRange.x) / (uGroundRange.y - uGroundRange.x), 0.0, 1.0);
  float v = floor(hn * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec4(hi / 255.0, (v - hi * 256.0) / 255.0, water, cloud);
}

void main() {
  vec3 p = dirFromUV(vUv);
  vec4 col;
  vec4 aux;
  bakePlanet(p, col, aux);
  gl_FragColor = uPass == 2 ? groundData(p, col, aux) : uPass == 0 ? col : aux;
}
`;

// ---------------------------------------------------------------------------------------------
// Runtime shaders
// ---------------------------------------------------------------------------------------------

// Shared vertex stage: object-space direction (turns with the planet) and planet-local position
export const BODY_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vRel;
varying vec3 vLocal;
varying vec3 vEast;
varying vec3 vNorth;
void main() {
  vObj = position;
  vLocal = position;
  vRel = mat3(modelMatrix) * position;
  // Surface frame in world orientation: east along the longitudes, north along the meridians
  vec3 east = vec3(-position.z, 0.0, position.x);
  east = dot(east, east) < 1e-10 ? vec3(0.0, 0.0, 1.0) : normalize(east);
  vEast = normalize(mat3(modelMatrix) * east);
  vNorth = normalize(mat3(modelMatrix) * cross(east, normalize(position)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

// Eclipses: how much sunlight reaches a point when moons (or the planet, for a moon) stand in front of the Sun.
// Discs compared by apparent size: umbra, penumbra, or an annular eclipse where the body is too small.
// In a full shadow only light bent through the caster's air arrives (a blood-red Moon in Earth's shadow).
const ECLIPSE_GLSL = /* glsl */ `
uniform vec4 uCasters[4];  // xyz: centre relative to this body, world orientation; w: radius (0 = unused)
uniform float uSunAng;     // angular radius of the Sun seen from this body
uniform vec3 uUmbraTint;
uniform vec3 uShineDir;
uniform vec3 uShineCol;
vec3 eclipse(vec3 P, vec3 L) {
  float vis = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 cs = uCasters[i];
    if (cs.w <= 0.0) continue;
    vec3 toC = cs.xyz - P;
    float t = dot(toC, L);
    if (t <= 0.0) continue;
    float sep = length(toC - L * t) / t;
    float ang = cs.w / t;
    float s = 1.0;
    if (sep >= uSunAng + ang) s = 1.0;
    else if (ang >= uSunAng && sep <= ang - uSunAng) s = 0.0;
    else {
      float covered = min(1.0, (ang / uSunAng) * (ang / uSunAng));
      s = 1.0 - covered * (1.0 - smoothstep(abs(ang - uSunAng), uSunAng + ang, sep));
    }
    vis = min(vis, s);
  }
  return mix(uUmbraTint, vec3(1.0), vis);
}
`;

const BODY_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uRadius;
uniform float uLight;
uniform float uTime;
uniform float uDetailFreq;
varying vec3 vObj;
varying vec3 vRel;
varying vec3 vLocal;
varying vec3 vEast;
varying vec3 vNorth;
`;

export const SURFACE_FRAGMENT = NOISE_GLSL + BODY_UNIFORMS + ECLIPSE_GLSL + /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D uColorMap;
uniform sampler2D uAuxMap;
uniform sampler2D uRingMap;
uniform vec3 uSunDirObj;
uniform float uBump;
uniform float uCloudShift;
uniform float uCloudAlt;
uniform vec3 uRingNormal;
uniform vec2 uRingRange;
#ifdef HAS_ATMO
` + ATMOSPHERE_GLSL + /* glsl */ `
#else
` + RAY_SPHERE + /* glsl */ `
#endif

void main() {
  vec3 n = normalize(vRel);
  vec3 o = normalize(vObj);
  vec2 uv = sphereUV(o);
  vec4 tex = texture2D(uColorMap, uv);
  vec3 albedo = toLinear(tex.rgb);
  vec3 toCam = uCamLocal - vRel;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  vec3 L = uSunDir;
  // Detail noise only where the pixel resolves it: nothing from afar, up to five octaves close up
  float octaves = detailOctaves(vRel, uDetailFreq);
  float detail = clamp(octaves, 0.0, 1.0);
  int oct = int(ceil(octaves));

  float ocean = 0.0;
  vec4 aux = vec4(0.0);
#if defined(EARTH) || defined(IO)
  aux = texture2D(uAuxMap, uv);
#endif
#ifdef EARTH
  ocean = tex.a;
#endif

  // Relief: slopes east and north from the height map (central differences), in world units
  float slopeE = 0.0;
  float slopeN = 0.0;
#if defined(EARTH) || defined(HEIGHT_IN_ALPHA)
#ifdef EARTH
  #define HEIGHT_TEX uAuxMap
  #define HEIGHT_OF(t) (t).b
#else
  #define HEIGHT_TEX uColorMap
  #define HEIGHT_OF(t) (t).a
#endif
  vec2 texSize = vec2(textureSize(HEIGHT_TEX, 0));
  vec2 du = vec2(1.0 / texSize.x, 0.0);
  vec2 dv = vec2(0.0, 1.0 / texSize.y);
  float cosLat = max(sqrt(max(1.0 - o.y * o.y, 0.0)), 0.05);
  slopeE = (HEIGHT_OF(texture2D(HEIGHT_TEX, uv + du)) - HEIGHT_OF(texture2D(HEIGHT_TEX, uv - du))) * uBump
         / (2.0 * uRadius * cosLat * 2.0 * PI / texSize.x);
  slopeN = (HEIGHT_OF(texture2D(HEIGHT_TEX, uv + dv)) - HEIGHT_OF(texture2D(HEIGHT_TEX, uv - dv))) * uBump
         / (2.0 * uRadius * PI / texSize.y);
#endif

  // Close up, fine relief and grain take over where the map runs out of texels
  vec3 dp = o * uRadius * uDetailFreq;
#ifdef GAS
  // Eddies on two scales, the larger ones visible from farther away
  float swirlOctaves = clamp(octaves + 3.0, 0.0, 5.0);
  if (swirlOctaves > 0.0) {
    vec3 fq = vec3(dp.x * 0.5, dp.y * 2.5, dp.z * 0.5);
    float swirlFlow = fbm(fq * 0.12 + vec3(uTime * 0.01, 0.0, uTime * 0.007), int(ceil(swirlOctaves)));
    float flow = oct > 0 ? fbm(fq + vec3(swirlFlow * 3.0 + uTime * 0.03, 0.0, uTime * 0.02), oct) : 0.0;
    albedo *= 1.0 + swirlFlow * 0.22 * clamp(swirlOctaves, 0.0, 1.0) + flow * 0.14 * detail;
  }
#else
  if (oct > 0) {
    vec3 eastObj = normalize(vec3(-o.z, 0.0, o.x) + vec3(0.0, 0.0, 1e-6));
    vec3 northObj = cross(eastObj, o);
    float eps = 0.35;  // in noise units
    float d0 = fbm(dp, oct);
    float dE = fbm(dp + eastObj * eps, oct);
    float dN = fbm(dp + northObj * eps, oct);
    // Relief amplitude follows the feature size, so slopes stay natural at any planet size
    float land = (1.0 - ocean) * detail;
    slopeE += (dE - d0) / eps * 0.35 * land;
    slopeN += (dN - d0) / eps * 0.35 * land;
    albedo *= 1.0 + d0 * 0.22 * land;
  }
#endif

  vec3 N = normalize(n - slopeE * normalize(vEast) - slopeN * normalize(vNorth));

  float geo = dot(n, L);
  float lit = max(dot(N, L), 0.0) * smoothstep(-0.03, 0.08, geo);
  vec3 shade = eclipse(vRel, L);
  vec3 sun = vec3(1.0, 0.97, 0.93) * uLight * shade;
  vec3 color = albedo * sun * lit;
  // Earthshine on the Moon, Jupiter-shine on its moons: the ashen glow of the night side
  color += albedo * uShineCol * max(dot(N, uShineDir), 0.0);

#ifdef IO
  // Lava lakes glow orange-red, plain to see on the night side and in Jupiter's shadow
  float dark = 1.0 - clamp(lit * dot(shade, vec3(0.333)) * 1.5, 0.0, 1.0);
  float flicker = 0.85 + 0.15 * sin(uTime * 2.3 + aux.r * 37.0) * sin(uTime * 0.7 + o.x * 20.0);
  color += vec3(1.0, 0.30, 0.05) * aux.r * (0.12 + 1.8 * dark) * flicker;
#endif

#ifdef GAS
  // Limb darkening of a deep atmosphere
  float mu = max(dot(n, V), 0.0);
  color *= 0.5 + 0.5 * pow(mu, 0.35);
#endif

#ifdef EARTH
  // Cloud shadows, cast from the cloud deck along the sunlight
  vec3 shadowDir = normalize(o + uSunDirObj * (uCloudAlt / uRadius) / max(dot(o, uSunDirObj), 0.25));
  float cloudShadow = texture2D(uAuxMap, sphereUV(rotY(shadowDir, uCloudShift))).g;
  float cloudHere = texture2D(uAuxMap, sphereUV(rotY(o, uCloudShift))).g;
  color *= 1.0 - 0.55 * cloudShadow;

  // Sun glint on open water
  vec3 H = normalize(L + V);
  float nh = max(dot(n, H), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float glint = pow(nh, 900.0) * 2.5 + pow(nh, 80.0) * 0.04;
  color += ocean * sun * glint * (0.3 + fres) * smoothstep(0.0, 0.12, geo) * (1.0 - cloudShadow);
  color += ocean * vec3(0.05, 0.09, 0.14) * fres * uLight * smoothstep(-0.1, 0.2, geo) * 0.4;

  // City lights on the night side
  float night = 1.0 - smoothstep(-0.12, 0.04, geo);
  color += vec3(1.0, 0.66, 0.30) * aux.r * night * 1.6 * (1.0 - cloudHere * 0.75);
#endif

#ifdef RING_SHADOW
  float sn = dot(L, uRingNormal);
  if (abs(sn) > 1e-4) {
    float t = -dot(vRel, uRingNormal) / sn;
    if (t > 0.0) {
      float r = length(vRel + L * t) / uRadius;
      if (r > uRingRange.x && r < uRingRange.y) {
        float dens = texture2D(uRingMap, vec2((r - uRingRange.x) / (uRingRange.y - uRingRange.x), 0.5)).a;
        color *= 1.0 - 0.85 * dens;
      }
    }
  }
#endif

  color += albedo * 0.004;

#ifdef HAS_ATMO
  vec3 inscatter;
  vec3 transmit;
  atmosphere(uCamLocal, -V, camDist, L, uRadius, inscatter, transmit);
  color = color * transmit + inscatter;
#endif

  gl_FragColor = vec4(color, 1.0);
  #include <logdepthbuf_fragment>
}
`;

export const CLOUD_FRAGMENT = NOISE_GLSL + BODY_UNIFORMS + ECLIPSE_GLSL + /* glsl */ `
#include <logdepthbuf_pars_fragment>
#define ATMO_STEPS 6
uniform sampler2D uAuxMap;
` + ATMOSPHERE_GLSL + /* glsl */ `
void main() {
  vec3 n = normalize(vRel);
  vec3 o = normalize(vObj);
  float cover = texture2D(uAuxMap, sphereUV(o)).g;
  vec3 toCam = uCamLocal - vRel;
  float camDist = length(toCam);
  float octaves = detailOctaves(vRel, uDetailFreq * 0.6);
  float detail = clamp(octaves, 0.0, 1.0);
  if (octaves > 0.0) {
    float dn = fbm(o * uRadius * uDetailFreq * 0.6, int(ceil(octaves)));
    cover = clamp(cover + dn * detail * cover * (1.0 - cover) * 1.8, 0.0, 1.0);
  }
  if (cover < 0.01) discard;
  vec3 L = uSunDir;
  float geo = dot(n, L);
  // Cloud tops stay lit a little past the ground's terminator
  float lit = clamp((geo + 0.12) / 1.12, 0.0, 1.0) * smoothstep(-0.12, 0.04, geo);
  vec3 color = vec3(0.92, 0.93, 0.95) * uLight * lit * (0.8 + 0.2 * cover) * eclipse(vRel, L) + vec3(0.004);
  vec3 inscatter;
  vec3 transmit;
  atmosphere(uCamLocal, -toCam / camDist, camDist, L, uRadius, inscatter, transmit);
  color = color * transmit + inscatter;
  gl_FragColor = vec4(color, cover * 0.96);
  #include <logdepthbuf_fragment>
}
`;

// The sky part of an atmosphere: rays that miss the ground (the surface shader hazes the ground itself)
export const ATMOSPHERE_FRAGMENT = BODY_UNIFORMS + /* glsl */ `
#include <logdepthbuf_pars_fragment>
const float PI = 3.141592653589793;
` + ATMOSPHERE_GLSL + /* glsl */ `
void main() {
  vec3 rd = normalize(vRel - uCamLocal);
  // Slightly inside the true sphere, so the sky also fills the sliver between the polygon horizon and the exact one
  if (hitsSphere(uCamLocal, rd, uRadius * 0.9996)) discard;
  vec3 inscatter;
  vec3 transmit;
  atmosphere(uCamLocal, rd, 1e9, uSunDir, uRadius, inscatter, transmit);
  gl_FragColor = vec4(inscatter, 1.0 - dot(transmit, vec3(1.0 / 3.0)));
  #include <logdepthbuf_fragment>
}
`;

export const RING_FRAGMENT = NOISE_GLSL + BODY_UNIFORMS + RAY_SPHERE + /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D uRingMap;
uniform vec2 uRingRange;
uniform vec3 uRingNormal;
void main() {
  float r = length(vLocal.xz);
  float s = (r - uRingRange.x) / (uRingRange.y - uRingRange.x);
  if (s < 0.0 || s > 1.0) discard;
  vec4 ring = texture2D(uRingMap, vec2(s, 0.5));
  vec3 toCam = uCamLocal - vRel;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  // Close up, ringlets finer than the map
  float detail = clamp(detailOctaves(vRel, 0.7 / 6.283), 0.0, 1.0);
  float fine = 1.0 + detail * 0.35 * snoise(vec3(r * uRadius * 0.7, 1.3, 2.7));
  float dens = clamp(ring.a * fine, 0.0, 1.0);
  if (dens < 0.004) discard;

  vec3 alb = toLinear(ring.rgb);
  float sunSide = dot(uRingNormal, uSunDir);
  float viewSide = dot(uRingNormal, V);
  // The lit face reflects; the dark face only glows where the ring is thin enough to let light through
  float face = sunSide * viewSide >= 0.0 ? 1.0 : 0.3 + 0.6 * (1.0 - dens);
  float light = mix(0.2, 1.0, sqrt(abs(sunSide))) * face;
  float shadow = hitsSphere(vRel, uSunDir, uRadius) ? 0.03 : 1.0;
  float forward = pow(max(dot(-V, uSunDir), 0.0), 10.0) * 1.4 * (1.0 - dens);
  vec3 color = alb * uLight * (light + forward) * shadow + alb * 0.003;
  gl_FragColor = vec4(color, dens * 0.95);
  #include <logdepthbuf_fragment>
}
`;

export const SUN_FRAGMENT = NOISE_GLSL + BODY_UNIFORMS + /* glsl */ `
#include <logdepthbuf_pars_fragment>
void main() {
  vec3 n = normalize(vRel);
  vec3 o = normalize(vObj);
  vec3 V = normalize(uCamLocal - vRel);
  float mu = clamp(dot(n, V), 0.0, 1.0);
  float t = uTime;
  float gran = fbm(o * 46.0 + vec3(0.0, t * 0.02, t * 0.013), 4);
  float cells = 1.0 - abs(snoise(o * 120.0 + vec3(t * 0.04)));
  float large = fbm(o * 5.0 + vec3(t * 0.004), 3);
  float spots = smoothstep(0.38, 0.5, fbm(o * 7.0 + vec3(30.0, 0.0, t * 0.001), 4)) * smoothstep(0.75, 0.3, abs(o.y));
  float I = 1.0 + 0.3 * gran + 0.16 * cells + 0.18 * large;
  I *= 1.0 - 0.8 * spots;
  float limb = 0.3 + 0.7 * pow(mu, 0.5);
  vec3 hot = vec3(1.0, 0.8, 0.5);
  vec3 cool = vec3(1.0, 0.4, 0.1);
  gl_FragColor = vec4(mix(cool, hot, limb) * I * limb, 1.0);
  #include <logdepthbuf_fragment>
}
`;

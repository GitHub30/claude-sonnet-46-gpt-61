/** All GLSL ES 3.00 shaders as string constants */

// ─── GBuffer pass ────────────────────────────────────────────────────────────
export const GBUFFER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_tangent;

uniform mat4 u_M;
uniform mat4 u_V;
uniform mat4 u_P;
uniform mat4 u_prevMVP;
uniform mat3 u_N; // normal matrix

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out mat3 v_TBN;
out vec4 v_currClip;
out vec4 v_prevClip;

void main(){
  vec4 wp = u_M * vec4(a_pos,1.0);
  v_worldPos = wp.xyz;
  vec3 N = normalize(u_N * a_normal);
  vec3 T = normalize(u_N * a_tangent.xyz);
  T = normalize(T - dot(T,N)*N);
  vec3 B = cross(N,T)*a_tangent.w;
  v_TBN = mat3(T,B,N);
  v_normal = N;
  v_uv = a_uv;
  vec4 clip = u_P*u_V*wp;
  v_currClip = clip;
  v_prevClip = u_prevMVP * vec4(a_pos,1.0);
  gl_Position = clip;
}`;

export const GBUFFER_FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in mat3 v_TBN;
in vec4 v_currClip;
in vec4 v_prevClip;

layout(location=0) out vec4 gAlbedo;   // rgb=albedo,   a=roughness
layout(location=1) out vec4 gNormal;   // rgb=normal,   a=metallic
layout(location=2) out vec4 gEmissive; // rgb=emissive, a=ao
layout(location=3) out vec2 gMotion;   // motion vector

uniform sampler2D u_albedoTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_roughTex;
uniform sampler2D u_metalTex;
uniform sampler2D u_aoTex;
uniform sampler2D u_emissiveTex;
uniform vec3  u_albedoFactor;
uniform float u_roughFactor;
uniform float u_metalFactor;
uniform float u_emissiveFactor;
uniform bool  u_useNormalMap;
uniform float u_uvScale;

void main(){
  vec2 uv = v_uv * u_uvScale;
  vec3 alb  = pow(texture(u_albedoTex,uv).rgb,vec3(2.2)) * u_albedoFactor;
  float rgh = texture(u_roughTex,uv).r * u_roughFactor;
  float mtl = texture(u_metalTex,uv).r * u_metalFactor;
  float ao  = texture(u_aoTex,uv).r;
  vec3 ems  = texture(u_emissiveTex,uv).rgb * u_emissiveFactor;
  vec3 N;
  if(u_useNormalMap){
    vec3 ns = texture(u_normalTex,uv).rgb*2.0-1.0;
    N = normalize(v_TBN*ns);
  } else {
    N = normalize(v_normal);
  }
  vec2 curr = v_currClip.xy/v_currClip.w;
  vec2 prev = v_prevClip.xy/v_prevClip.w;
  gAlbedo   = vec4(alb, rgh);
  gNormal   = vec4(N*0.5+0.5, mtl);
  gEmissive = vec4(ems, ao);
  gMotion   = (curr-prev)*0.5;
}`;

// ─── Shadow depth pass ───────────────────────────────────────────────────────
export const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
uniform mat4 u_lightMVP;
void main(){ gl_Position = u_lightMVP * vec4(a_pos,1.0); }`;

export const SHADOW_FRAG = `#version 300 es
precision highp float;
void main(){}`;

// ─── Full-screen quad ────────────────────────────────────────────────────────
export const QUAD_VERT = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
out vec2 v_uv;
void main(){ v_uv=POS[gl_VertexID]*0.5+0.5; gl_Position=vec4(POS[gl_VertexID],0,1); }`;

// ─── Deferred PBR lighting ───────────────────────────────────────────────────
export const LIGHTING_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_gAlbedo;
uniform sampler2D u_gNormal;
uniform sampler2D u_gEmissive;
uniform sampler2D u_depth;
uniform sampler2D u_ssao;
uniform sampler2D u_shadowMap;

uniform mat4 u_invVP;
uniform mat4 u_lightMVP;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_sunIntensity;
uniform float u_ambientIntensity;
uniform vec3 u_skyColor;
uniform float u_time;

// Point lights (up to 32)
uniform int    u_numLights;
uniform vec3   u_lightPos[32];
uniform vec3   u_lightColor[32];
uniform float  u_lightRadius[32];

const float PI = 3.14159265;

vec3 reconstructWorldPos(vec2 uv, float depth){
  vec4 ndc = vec4(uv*2.0-1.0, depth*2.0-1.0, 1.0);
  vec4 wp  = u_invVP * ndc;
  return wp.xyz / wp.w;
}

float distributionGGX(float NdH, float rough){
  float a=rough*rough, a2=a*a;
  float d=(NdH*NdH*(a2-1.0)+1.0);
  return a2/(PI*d*d+1e-7);
}

float geometrySmith(float NdV, float NdL, float rough){
  float r=rough+1.0, k=r*r/8.0;
  float g1=NdV/(NdV*(1.0-k)+k);
  float g2=NdL/(NdL*(1.0-k)+k);
  return g1*g2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0){
  return F0+(1.0-F0)*pow(1.0-cosTheta,5.0);
}

float shadowPCF(vec4 shadowCoord){
  vec3 proj = shadowCoord.xyz/shadowCoord.w;
  proj = proj*0.5+0.5;
  if(proj.z>1.0) return 1.0;
  float shadow=0.0;
  float bias=0.002;
  float texel=1.0/2048.0;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++){
    float pcf=texture(u_shadowMap,proj.xy+vec2(x,y)*texel).r;
    shadow += (pcf < proj.z-bias) ? 0.0 : 1.0;
  }
  return shadow/25.0;
}

void main(){
  vec4 albedoR   = texture(u_gAlbedo,   v_uv);
  vec4 normalM   = texture(u_gNormal,   v_uv);
  vec4 emissiveA = texture(u_gEmissive, v_uv);
  float depth    = texture(u_depth,     v_uv).r;
  float ssao     = texture(u_ssao,      v_uv).r;

  if(depth >= 0.9999){
    // Sky will be composited later
    fragColor = vec4(0.0,0.0,0.0,0.0);
    return;
  }

  vec3 albedo   = albedoR.rgb;
  float rough   = max(albedoR.a, 0.04);
  vec3  N       = normalize(normalM.rgb*2.0-1.0);
  float metal   = normalM.a;
  vec3  emissive= emissiveA.rgb;
  float ao      = emissiveA.a * ssao;

  vec3 worldPos = reconstructWorldPos(v_uv, depth);
  vec3 V = normalize(u_camPos - worldPos);
  float NdV = max(dot(N,V), 0.0);

  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 Lo = vec3(0.0);

  // Sun directional light
  {
    vec3 L = normalize(-u_sunDir);
    vec3 H = normalize(V+L);
    float NdL = max(dot(N,L), 0.0);
    float NdH = max(dot(N,H), 0.0);

    float D = distributionGGX(NdH, rough);
    float G = geometrySmith(NdV, NdL, rough);
    vec3  F = fresnelSchlick(max(dot(H,V),0.0), F0);

    vec3 spec = D*G*F / (4.0*NdV*NdL + 1e-7);
    vec3 kd = (1.0-F)*(1.0-metal);
    vec3 radiance = u_sunColor * u_sunIntensity;

    // Shadow
    vec4 shadowCoord = u_lightMVP * vec4(worldPos, 1.0);
    float shadowFactor = shadowPCF(shadowCoord);

    Lo += (kd*albedo/PI + spec) * radiance * NdL * shadowFactor;
  }

  // Point lights (street lights, windows, etc.)
  for(int i=0; i<u_numLights; i++){
    vec3 diff = u_lightPos[i] - worldPos;
    float dist = length(diff);
    if(dist > u_lightRadius[i]) continue;
    vec3 L = diff/dist;
    vec3 H = normalize(V+L);
    float NdL = max(dot(N,L), 0.0);
    float NdH = max(dot(N,H), 0.0);
    float atten = 1.0 / (1.0 + (dist/u_lightRadius[i])*(dist/u_lightRadius[i]));
    atten *= smoothstep(u_lightRadius[i], u_lightRadius[i]*0.7, dist);

    float D = distributionGGX(NdH, rough);
    float G = geometrySmith(NdV, NdL, rough);
    vec3  F = fresnelSchlick(max(dot(H,V),0.0), F0);
    vec3 spec = D*G*F / (4.0*NdV*NdL + 1e-7);
    vec3 kd = (1.0-F)*(1.0-metal);
    Lo += (kd*albedo/PI + spec) * u_lightColor[i] * NdL * atten;
  }

  // Ambient (sky-based)
  vec3 ambient = u_skyColor * u_ambientIntensity * albedo * ao;
  vec3 color = ambient + Lo + emissive;

  fragColor = vec4(color, 1.0);
}`;

// ─── Procedural skybox ───────────────────────────────────────────────────────
export const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_depth;
uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_sunIntensity;
uniform float u_time;
uniform float u_weatherFactor; // 0=clear, 1=overcast

const float PI = 3.14159265;

// Rayleigh + Mie scattering
vec3 atmosphere(vec3 rayDir, vec3 sunDir){
  vec3 betaR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
  vec3 betaM = vec3(21e-3);
  float g = 0.76;
  int numSteps = 8;
  float tMax = 800.0;
  float dt = tMax / float(numSteps);
  vec3 sumR=vec3(0), sumM=vec3(0);
  float optDepthR=0.0, optDepthM=0.0;
  float mu = dot(rayDir, sunDir);
  float phaseR = 3.0/(16.0*PI)*(1.0+mu*mu);
  float mieD = (1.0-g*g)/pow(1.0+g*g-2.0*g*mu, 1.5)/(4.0*PI);
  for(int i=0;i<numSteps;i++){
    float t = (float(i)+0.5)*dt;
    vec3 samplePos = vec3(0,6360.0+max(rayDir.y,0.0)*t,0) + rayDir*t;
    float height = max(length(samplePos)-6360.0, 0.0);
    float hr = exp(-height/8.0)*dt;
    float hm = exp(-height/1.2)*dt;
    optDepthR += hr; optDepthM += hm;
    vec3 tau = betaR*optDepthR + betaM*1.1*optDepthM;
    vec3 attenuation = exp(-tau);
    sumR += hr*attenuation;
    sumM += hm*attenuation;
  }
  return (sumR*betaR*phaseR + sumM*betaM*mieD) * u_sunIntensity * 20.0;
}

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }

vec3 cloudColor(vec3 rayDir, vec3 sunDir, float time){
  if(rayDir.y < 0.01) return vec3(0);
  float t = 800.0/max(rayDir.y,0.01);
  vec2 uv = rayDir.xz * t * 0.0002 + time*0.002;
  float cloud = smoothstep(0.4, 0.8, fbm(uv*3.0));
  cloud *= u_weatherFactor*1.5 + 0.2;
  float lit = max(0.0, dot(normalize(vec3(uv,0)),sunDir.xz));
  vec3 cc = mix(vec3(1.0,1.0,1.0), vec3(0.6,0.6,0.7), cloud);
  return cc * cloud * max(0.5, u_sunIntensity*0.5) * 2.0;
}

void main(){
  float depth = texture(u_depth, v_uv).r;
  if(depth < 0.9999){ discard; return; }
  vec4 ndc = vec4(v_uv*2.0-1.0, 1.0, 1.0);
  vec4 wp  = u_invVP * ndc;
  vec3 dir = normalize(wp.xyz/wp.w - u_camPos);

  vec3 sunDir = normalize(-u_sunDir);
  vec3 sky = atmosphere(dir, sunDir);

  // Sun disk
  float sunDot = dot(dir, sunDir);
  float sunDisc = smoothstep(0.9995, 0.9998, sunDot);
  sky += u_sunColor * u_sunIntensity * sunDisc * 50.0;

  // Clouds
  sky += cloudColor(dir, sunDir, u_time);

  // Horizon glow
  float hFactor = 1.0 - abs(dir.y);
  sky += u_sunColor * pow(hFactor, 6.0) * u_sunIntensity * 0.3;

  // Ground (under horizon)
  if(dir.y < 0.0) sky = mix(sky, vec3(0.08,0.07,0.06), min(1.0, -dir.y*8.0));

  // Overcast darkening
  sky = mix(sky, vec3(dot(sky,vec3(0.3))*0.7), u_weatherFactor*0.7);

  fragColor = vec4(sky, 1.0);
}`;

// ─── SSAO ────────────────────────────────────────────────────────────────────
export const SSAO_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out float fragColor;

uniform sampler2D u_depth;
uniform sampler2D u_gNormal;
uniform sampler2D u_noise;
uniform mat4 u_P;
uniform mat4 u_V;
uniform mat4 u_invVP;
uniform vec3 u_samples[64];
uniform float u_radius;
uniform float u_bias;
uniform vec2  u_resolution;

vec3 reconstructPos(vec2 uv, float depth){
  vec4 ndc = vec4(uv*2.0-1.0, depth*2.0-1.0, 1.0);
  vec4 wp  = u_invVP * ndc;
  return wp.xyz/wp.w;
}

void main(){
  float depth = texture(u_depth, v_uv).r;
  if(depth >= 0.9999){ fragColor=1.0; return; }

  vec3 worldPos = reconstructPos(v_uv, depth);
  vec3 N = normalize(texture(u_gNormal, v_uv).rgb*2.0-1.0);

  // Build TBN in view space
  vec2 noiseScale = u_resolution/4.0;
  vec3 randomVec  = normalize(texture(u_noise, v_uv*noiseScale).xyz);
  vec3 T = normalize(randomVec - N*dot(randomVec,N));
  vec3 B = cross(N,T);
  mat3 TBN = mat3(T,B,N);

  float ao = 0.0;
  int nSamples = 32;
  for(int i=0;i<nSamples;i++){
    vec3 sampleDir = TBN * u_samples[i];
    vec3 samplePos = worldPos + sampleDir * u_radius;
    // Project to screen
    vec4 offset = u_P * u_V * vec4(samplePos,1.0);
    offset.xyz /= offset.w;
    offset.xyz  = offset.xyz*0.5+0.5;
    float sampleDepth = texture(u_depth, offset.xy).r;
    vec3 sampleWorld  = reconstructPos(offset.xy, sampleDepth);
    float rangeCheck  = smoothstep(0.0,1.0, u_radius/abs(worldPos.z - sampleWorld.z + 1e-5));
    ao += (length(sampleWorld-worldPos) < u_radius+u_bias ? 1.0 : 0.0) * rangeCheck;
  }
  fragColor = 1.0 - ao/float(nSamples);
}`;

export const SSAO_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out float fragColor;
uniform sampler2D u_ssao;
uniform vec2 u_texelSize;
void main(){
  float result=0.0;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++)
    result+=texture(u_ssao, v_uv+vec2(x,y)*u_texelSize).r;
  fragColor=result/25.0;
}`;

// ─── Bloom ───────────────────────────────────────────────────────────────────
export const BLOOM_EXTRACT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_hdr;
uniform float u_threshold;
void main(){
  vec3 c = texture(u_hdr, v_uv).rgb;
  float brightness = dot(c, vec3(0.2126,0.7152,0.0722));
  fragColor = brightness > u_threshold ? vec4(c,1.0) : vec4(0.0);
}`;

export const BLOOM_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform vec2 u_texelSize;
const float WEIGHTS[5] = float[](0.227027,0.1945946,0.1216216,0.054054,0.016216);
void main(){
  vec3 c = texture(u_src, v_uv).rgb * WEIGHTS[0];
  for(int i=1;i<5;i++){
    vec2 off = u_dir*float(i)*u_texelSize;
    c += texture(u_src, v_uv+off).rgb * WEIGHTS[i];
    c += texture(u_src, v_uv-off).rgb * WEIGHTS[i];
  }
  fragColor = vec4(c,1.0);
}`;

// ─── Motion blur ─────────────────────────────────────────────────────────────
export const MOTION_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_hdr;
uniform sampler2D u_motion;
uniform float u_strength;
void main(){
  vec2 vel = texture(u_motion, v_uv).rg * u_strength;
  // Clamp velocity to prevent NaN or extreme values from corrupting the sample
  vel = clamp(vel, vec2(-0.04), vec2(0.04));
  vec4 c = texture(u_hdr, v_uv);
  int nSamples = 8;
  for(int i=1;i<nSamples;i++){
    vec2 offset = vel * (float(i)/float(nSamples-1)-0.5);
    c += texture(u_hdr, v_uv+offset);
  }
  fragColor = c / float(nSamples);
}`;

// ─── Tone mapping + gamma ────────────────────────────────────────────────────
export const TONEMAP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_hdr;
uniform sampler2D u_bloom;
uniform float u_exposure;
uniform float u_bloomStrength;
uniform float u_time;
uniform vec2  u_resolution;

vec3 ACESFilmic(vec3 x){
  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}

void main(){
  vec3 hdr   = texture(u_hdr,   v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  vec3 color = hdr + bloom * u_bloomStrength;

  // Exposure
  color *= u_exposure;

  // ACES tone map
  color = ACESFilmic(color);

  // Vignette
  vec2 uv2 = v_uv - 0.5;
  float vig = 1.0 - dot(uv2,uv2)*1.8;
  color *= max(vig, 0.0);

  // Chromatic aberration
  float ca = 0.0015;
  float rOff = texture(u_hdr, v_uv+vec2(ca,0)).r;
  float bOff = texture(u_hdr, v_uv-vec2(ca,0)).b;
  color.r = mix(color.r, rOff*u_exposure, 0.3);
  color.b = mix(color.b, bOff*u_exposure, 0.3);
  color = ACESFilmic(color);

  // Gamma correction (sRGB)
  color = pow(max(color,0.0), vec3(1.0/2.2));

  fragColor = vec4(color, 1.0);
}`;

// ─── Instanced mesh (NPCs, props) ─────────────────────────────────────────────
export const INSTANCED_GBUFFER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=4) in mat4 a_instanceM; // locations 4,5,6,7

uniform mat4 u_V;
uniform mat4 u_P;
uniform mat4 u_prevVP;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out vec4 v_currClip;
out vec4 v_prevClip;

void main(){
  vec4 wp = a_instanceM * vec4(a_pos,1.0);
  v_worldPos = wp.xyz;
  mat3 nMat = mat3(transpose(inverse(a_instanceM)));
  v_normal   = normalize(nMat*a_normal);
  v_uv       = a_uv;
  vec4 clip  = u_P*u_V*wp;
  v_currClip = clip;
  v_prevClip = u_prevVP * wp;
  gl_Position = clip;
}`;

export const INSTANCED_GBUFFER_FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_currClip;
in vec4 v_prevClip;

layout(location=0) out vec4 gAlbedo;
layout(location=1) out vec4 gNormal;
layout(location=2) out vec4 gEmissive;
layout(location=3) out vec2 gMotion;

uniform sampler2D u_albedoTex;
uniform vec3  u_albedoFactor;
uniform float u_roughFactor;
uniform float u_metalFactor;

void main(){
  vec3 alb = pow(texture(u_albedoTex,v_uv).rgb,vec3(2.2))*u_albedoFactor;
  vec3 N = normalize(v_normal);
  vec2 curr = v_currClip.xy/v_currClip.w;
  vec2 prev = v_prevClip.xy/v_prevClip.w;
  gAlbedo   = vec4(alb, u_roughFactor);
  gNormal   = vec4(N*0.5+0.5, u_metalFactor);
  gEmissive = vec4(0.0,0.0,0.0,1.0);
  gMotion   = (curr-prev)*0.5;
}`;

// ─── Rain particles ───────────────────────────────────────────────────────────
export const RAIN_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
uniform mat4 u_VP;
uniform float u_time;
void main(){
  vec3 p = a_pos;
  p.y = mod(p.y - u_time*8.0, 40.0);
  gl_Position = u_VP * vec4(p,1.0);
  gl_PointSize = 2.0;
}`;

export const RAIN_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform float u_weatherFactor;
void main(){
  fragColor = vec4(0.7,0.8,1.0, 0.4*u_weatherFactor);
}`;

// ─── Water surface ────────────────────────────────────────────────────────────
export const WATER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=2) in vec2 a_uv;
uniform mat4 u_M;
uniform mat4 u_V;
uniform mat4 u_P;
uniform float u_time;
out vec3 v_worldPos;
out vec2 v_uv;
out vec3 v_normal;
void main(){
  vec3 p=a_pos;
  p.y += sin(p.x*0.3+u_time*1.2)*0.08 + cos(p.z*0.4+u_time*0.9)*0.06;
  v_worldPos=(u_M*vec4(p,1.0)).xyz;
  v_uv=a_uv;
  v_normal=vec3(0,1,0);
  gl_Position=u_P*u_V*u_M*vec4(p,1.0);
}`;

export const WATER_FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec2 v_uv;
in vec3 v_normal;
layout(location=0) out vec4 gAlbedo;
layout(location=1) out vec4 gNormal;
layout(location=2) out vec4 gEmissive;
layout(location=3) out vec2 gMotion;
uniform float u_time;
void main(){
  vec2 uv1=v_uv*4.0+vec2(u_time*0.05,u_time*0.03);
  vec2 uv2=v_uv*6.0-vec2(u_time*0.04,u_time*0.06);
  float w1=sin(uv1.x*6.28)*sin(uv1.y*6.28)*0.5+0.5;
  float w2=cos(uv2.x*6.28)*cos(uv2.y*6.28)*0.5+0.5;
  float wave=w1*0.5+w2*0.5;
  vec3 n=normalize(vec3(sin(uv1.x*6.28)*0.15, 1.0, cos(uv2.y*6.28)*0.15));
  vec3 color=vec3(0.05,0.2,0.5)*mix(0.8,1.2,wave);
  gAlbedo  =vec4(color,0.05);
  gNormal  =vec4(n*0.5+0.5, 0.05);
  gEmissive=vec4(vec3(0.02,0.08,0.2)*wave*0.5, 1.0);
  gMotion  =vec2(0.0);
}`;

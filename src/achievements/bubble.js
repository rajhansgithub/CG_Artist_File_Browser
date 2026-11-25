/* Emulsion badge: a live soap bubble with the app's mark inside (swap `logo()` / `pulseD()` per app; the example mark is a pulse line). One shared WebGL context draws every <canvas class="ach-bubble">.
   Thin-film interference (8 wavelengths, water film n = 1.33), Schlick Fresnel edge band, studio window + floor light, the mark seen through
   the film with refraction copies at the rim. Look params are the tuned reference (unchanged). Watching only. No network.
   Pauses off screen or in a hidden tab; one still frame with "reduce motion". ACHBubble.only(canvas) = the full view draws only that one.
   No WebGL: the canvas gets class "nogl". */
(function (root) {
  'use strict';
  /* The bubble's look, shared by the flat badge and the 3D bubble and set by the tuner (v4). Defaults = Rajhans's saved values
     (tuning/bubble, saved 2026-11-22 04:43 UTC). */
  const LOOK_DEFAULTS = { edgeWidth: 0.61, edgeVary: 1, edgeColour: 0.61, rimLine: 1, saturation: 1.1, filmInside: 1, filmThick: 540, flowSpeed: 2, reflection: 0.51, dotRefr: 0.1, dotRing: 0.75, refrPeriod: 20, glow: 0, breath: 4, motionAmt: 1, motionTime: 30, lqRefr: 0, lqRefl: 0, lqFilm: 0.5, lqTint: 1, lqWobble: 0.56, lqDrops: 0, lqDropSize: 0.4, lqMove: 0.2, turn: 0 };
  root.ACHLookDefaults = Object.freeze(Object.assign({}, LOOK_DEFAULTS));
  root.ACHLook = Object.assign({}, LOOK_DEFAULTS);
  const LOOK_U = { edgeWidth: 'uEdgeW', edgeVary: 'uEdgeVary', edgeColour: 'uEdgeCol', rimLine: 'uRim', saturation: 'uSat', filmInside: 'uFilmIn', filmThick: 'uThick', flowSpeed: 'uFlow', reflection: 'uRefl',
    dotRefr: 'uDotRefr', dotRing: 'uDotRing', refrPeriod: 'uRefrT', glow: 'uGlow', breath: 'uBreath', motionAmt: 'uMotAmt', motionTime: 'uMotT',
    lqRefr: 'uLqRefr', lqRefl: 'uLqRefl', lqFilm: 'uLqFilm', lqTint: 'uLqTint', lqWobble: 'uLqWob', lqDrops: 'uLqDrops', lqDropSize: 'uLqDropS', lqMove: 'uLqMove' };
  let LU = {};

  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uSeed;
uniform sampler2D uEnv; uniform float uEnvOn; uniform vec4 uEnvR; uniform vec4 uEnvK; uniform float uSee;   // uEnvK: front, back, distance, film tint; uSee: how see-through the bubble is   // the page behind, for a faint mirror reflection
uniform float uEdgeW, uEdgeVary, uEdgeCol, uSat, uFilmIn, uRefl, uFlow, uThick, uRim, uDotRefr, uDotRing, uRefrT, uGlow, uBreath, uMotAmt, uMotT;   // the look (ACHLook, the tuner)
uniform float uLqRefr, uLqRefl, uLqFilm, uLqTint, uLqWob, uLqDrops, uLqDropS, uLqMove;   // the liquid pulse
#define uVar 2.0
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec3 wl(float l){ return vec3(exp(-pow((l-605.)/48.,2.)) + .28*exp(-pow((l-425.)/28.,2.)), exp(-pow((l-545.)/42.,2.)), exp(-pow((l-455.)/32.,2.))); }
vec3 film(float d, float cosT){
  vec3 c=vec3(0.), s=vec3(0.);
  for(int i=0;i<8;i++){ float l=400.+float(i)*42.857; vec3 w=wl(l); float ph=6.2831853*2.*1.33*d*cosT/l; c+=w*(.5-.5*cos(ph)); s+=w; }
  vec3 f=2.*c/s;
  float y=dot(f,vec3(.299,.587,.114));
  return mix(vec3(y),f,uSat);
}
const float TAU=6.2831853;
// mark helpers: segment and triangle distances (icon units, 24 box)
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float tri(vec2 p, vec2 a, vec2 b, vec2 c){
  vec2 e0=b-a, e1=c-b, e2=a-c, v0=p-a, v1=p-b, v2=p-c;
  vec2 pq0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.,1.), pq1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.,1.), pq2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.,1.);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(pq0,pq0), s*(v0.x*e0.y-v0.y*e0.x)), vec2(dot(pq1,pq1), s*(v1.x*e1.y-v1.y*e1.x))), vec2(dot(pq2,pq2), s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
// CG Artist File Browser mark: the Layers icon (a rhombus over two chevrons), distance to its lines in icon units (24 box)
float markD(vec2 p){
  float d=min(min(seg(p,vec2(12.,3.2),vec2(19.4,6.2)),seg(p,vec2(19.4,6.2),vec2(12.,9.2))),min(seg(p,vec2(12.,9.2),vec2(4.6,6.2)),seg(p,vec2(4.6,6.2),vec2(12.,3.2))));
  d=min(d,min(seg(p,vec2(4.6,9.6),vec2(12.,12.6)),seg(p,vec2(12.,12.6),vec2(19.4,9.6))));
  return min(d,min(seg(p,vec2(4.6,12.6),vec2(12.,15.6)),seg(p,vec2(12.,15.6),vec2(19.4,12.6))));
}
// the app's mark (icon units, 24 box). This app: the Layers mark, centred; breathes very slightly.
vec4 logo(vec2 q, float aa){
  float cs=1.+uMotAmt*.05*sin(uTime*TAU/uMotT);
  q/=cs;
  vec2 p=vec2(12.+q.x*9., 9.4-q.y*9.);
  float a=aa*9.;
  float pl=markD(p)-.95;
  float m=smoothstep(a,-a,pl);
  return vec4(m,m,m,m);
}
vec3 glow(vec2 q, float k){
  vec3 g=vec3(0.);
  g+=vec3(.18,.45,1.)*exp(-dot((q-vec2(0.,.32))*vec2(1.3,2.4),(q-vec2(0.,.32))*vec2(1.3,2.4)))*.75;
  g+=vec3(.15,.77,1.)*exp(-dot((q-vec2(.28,.2))*vec2(2.,3.),(q-vec2(.28,.2))*vec2(2.,3.)))*.5;
  g+=vec3(.7,.3,1.)*exp(-dot((q-vec2(-.42,-.02))*vec2(2.4,3.6),(q-vec2(-.42,-.02))*vec2(2.4,3.6)))*.45;
  g+=vec3(1.)*exp(-dot(q*vec2(1.8,3.2),q*vec2(1.8,3.2)))*.8;
  g+=vec3(1.,.82,.25)*exp(-dot((q-vec2(0.,-.3))*vec2(1.4,2.6),(q-vec2(0.,-.3))*vec2(1.4,2.6)))*.7;
  g+=vec3(1.,.36,.16)*exp(-dot((q-vec2(.45,-.2))*vec2(2.4,3.4),(q-vec2(.45,-.2))*vec2(2.4,3.4)))*.55;
  return g*k*uGlow;
}
// the pulse as a tube of liquid seen from the front (same look as the 3D bubble's): distance to its centre line in icon units
float pulseD(vec2 p){
  return markD(p);
}
// shading of clear water at normal n (view straight on), over what is behind it (the glow, sampled bent by refraction)
vec3 water(vec3 n, vec2 q, vec3 dc, float k){
  float ndv=n.z;
  float Fl=.02+.98*pow(1.-ndv,5.);
  vec3 Rr=reflect(vec3(0.,0.,-1.),n);
  vec3 behind=glow(q-n.xy*.22*uLqRefr,k)*.9+vec3(.012);
  float edge=mix(1.,smoothstep(.05,.55,ndv),clamp(uLqRefr*1.6,0.,1.));
  vec3 trans=behind*(1.-Fl)*edge;
  float spec=(Fl*(.4+uRefl)*1.4+pow(max(dot(Rr,normalize(vec3(-.45,.55,.7))),0.),120.)*2.4+pow(max(dot(Rr,normalize(vec3(.6,.35,.72))),0.),400.)*2.)*uLqRefl*2.;
  vec3 fl=film(uThick*.5+220.*n.y+60.*sin(q.x*5.6+uTime*.4),ndv)*(Fl*2.2+.03)*uLqFilm*1.6;
  vec3 tint=dc*(.08+.5*pow(ndv,2.))*uLqTint*(.85+.25*k);
  return trans+vec3(spec)+fl+tint;
}
// rgb = the water pulse with its tiny bubbles (already over the glow behind it), a = coverage. dc = the logo colour here.
vec4 liquid(vec2 q, float aa, vec3 dc, float k){
  float t=uTime;
  vec2 w=q*.62;                                     // bubble units, as in the 3D pulse
  w.y-=.012*uLqMove*sin(t*.6);
  w=rot(.035*uLqMove*sin(t*.37))*w;
  float cs=1.+uMotAmt*.05*sin(t*TAU/uMotT);
  w/=cs;
  vec2 p=vec2(12.+w.x/.62*9., 9.4-w.y/.62*9.);
  float R=.95*(1.+(.006*sin(w.x*14.-t*2.1)+.003*sin(w.x*33.+w.y*9.+t*3.3))*uLqWob*2./.062);
  float d0=pulseD(p);
  float a=aa*9.;
  float m=smoothstep(a,-a,d0-R);
  vec3 n=vec3(0.,0.,1.);
  if(m>0.){
    float e=.06;
    vec2 gr=vec2(pulseD(p+vec2(e,0.))-pulseD(p-vec2(e,0.)), pulseD(p-vec2(0.,e))-pulseD(p+vec2(0.,e)))/(2.*e);
    float x=clamp(d0/R,0.,.999);
    n=normalize(vec3(gr*x,sqrt(1.-x*x)));
  }
  // tiny bubbles (spheres): the one in front wins
  for(int i=0;i<12;i++){
    float fi=float(i);
    if(fi>=12.*uLqDrops) break;
    vec3 c=vec3(-.6+fi*.105+.03*sin(fi*7.3), .30*sin(fi*2.39+.5)-.03, 0.);
    c.xy+=.014*uLqMove*vec2(sin(t*.5+fi), sin(t*.43+fi*2.));
    float r=(.013+.026*fract(fi*.618))*uLqDropS;
    vec2 v=(w-c.xy)/r; float l2=dot(v,v);
    float md=smoothstep(1.+aa*.62/r,1.-aa*.62/r,sqrt(l2));
    if(md>0.){
      vec3 nd=vec3(v,sqrt(max(1.-l2,0.)));
      if(md>=m || nd.z>n.z){ n=nd; }
      m=max(m,md);
    }
  }
  if(m<=0.) return vec4(0.);
  return vec4(water(n,q,dc,k),m);
}
vec3 content(vec2 q, float k, float aa){
  vec4 L=logo(q,aa);
  vec3 dotc=vec3(.95);
  vec3 g=glow(q,k);
  if(uVar>1.5 && uVar<2.5){
    float y=q.y; dotc=mix(vec3(1.,.42,.23), vec3(1.,.86,.45), smoothstep(-.9,-.3,y));
    dotc=mix(dotc, vec3(1.), smoothstep(-.25,0.,y)); dotc=mix(dotc, vec3(.55,.85,1.), smoothstep(.1,.45,y)); dotc=mix(dotc, vec3(.31,.55,1.), smoothstep(.5,.95,y));
    g*=.55;
  } else if(uVar>2.5){
    g=(vec3(1.)*exp(-dot(q,q)*9.)*1.1 + vec3(1.,.82,.3)*exp(-dot(q,q)*3.5)*.55 + vec3(.2,.7,1.)*exp(-dot(q,q)*1.4)*.25)*k*uGlow;
    dotc=vec3(1.)*(.45+.55*exp(-dot(q,q)*1.6));
  }
  if(uVar>1.5 && uVar<2.5){
    vec4 lq=liquid(q,aa,dotc,k);
    return g*(1.-lq.a)+lq.rgb*lq.a;
  }
  return g + L.a*dotc*(1.-.15*k);
}
void main(){
  float S=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/(.5*S);
  float r=length(p);
  float edgeAA=2./S;
  float inside=smoothstep(1.+edgeAA, 1.-edgeAA, r);
  if(inside<=0.){ gl_FragColor=vec4(0.); return; }
  float t=uTime+uSeed;
  float ft=t*uFlow;
  float rc=min(r,.9999);
  float z=sqrt(1.-rc*rc);
  float F=.02+.98*pow(1.-z,5.);
  float sinT=rc/1.33; float cosT=sqrt(1.-sinT*sinT);
  float k=.62+.38*sin(t*TAU/uBreath);

  // edge band: width varies around the outline (hairline here, broad there), slowly shifting
  float ang=atan(p.y,p.x);
  vec2 cp=vec2(cos(ang),sin(ang));
  float bw=fbm(cp*1.7+vec2(ft*.035,-ft*.028)) + .35*fbm(cp*4.1-vec2(ft*.05,ft*.04));
  float wf=mix(1.,mix(.14,3.2,smoothstep(.45,.95,bw)),uEdgeVary)*uEdgeW;
  float rB=clamp(1.-(1.-r)/max(wf,.01),0.,.9999);
  float FB=.02+.98*pow(1.-sqrt(1.-rB*rB),5.);

  // film thickness: smooth, large swirls (low warp, no contour term, so no stretched streaks)
  vec2 q=p*1.2;
  q=rot(.04*ft)*q;
  vec2 w=vec2(fbm(q*.8+vec2(0.,ft*.05)), fbm(q*.8+vec2(5.2,1.3)-ft*.04));
  float n=fbm(q+1.3*w+vec2(ft*.02,-ft*.015));
  float d=uThick+420.*(n-.5) - 120.*p.y;
  vec3 fc=film(max(d,20.),cosT);
  vec2 wp=rot(.5)*(p-vec2(-.36,.42));
  float win=smoothstep(.45,.05,length(max(abs(wp)-vec2(.2,.1),0.)));
  float floorr=smoothstep(-.2,-.95,p.y)*.6;
  float env=.25+uRefl*(win+floorr);
  float filmI=(uFilmIn*.05 + uEdgeCol*2.6*FB)*env;
  vec3 col=fc*filmI;

  float aa=1.6/(S*.5*.62);
  col+=content(p/.62,k,aa)*(1.-F);

  float sway=.26*sin(t*TAU/uRefrT)+.1*sin(t*TAU/(uRefrT*1.45));
  if(uDotRing>0.){
    float wr=smoothstep(.8,.88,r)*smoothstep(1.,.96,r);
    if(wr>0.){
      float s=(r-.8)/.195; float rr=(1.-s)*1.02;
      vec2 dir=-normalize(p)*rot(sway);
      float aa2=aa*3.;
      float cr=content(dir*rr*1.05,k,aa2).r, cg=content(dir*rr,k,aa2).g, cb=content(dir*rr*.95,k,aa2).b;
      col+=vec3(cr,cg,cb)*wr*.3*uDotRing*(.75+.25*k);
    }
  }
  if(uDotRefr>0.){
    for(int j=0;j<2;j++){
      float side=j==0?-1.:1.;
      float a2=(j==0? 3.1416 : 0.) + side*(.16*sin(t*TAU/uRefrT+float(j)*1.7)+.06*sin(t*TAU/(uRefrT*1.41))) - .1;
      vec2 nrm=vec2(cos(a2),sin(a2)); vec2 tng=vec2(-nrm.y,nrm.x);
      vec2 u=p-nrm*.8; vec2 lu=vec2(dot(u,tng), dot(u,nrm)*1.9);
      float sz=.19; vec2 qq=-lu/sz;
      float m=smoothstep(1.08,.8,length(qq))*smoothstep(.995,.94,r);
      if(m>0.){
        float aa3=aa*.62/sz*2.;
        float cr=content(qq*1.06,k,aa3).r, cg=content(qq,k,aa3).g, cb=content(qq*.94,k,aa3).b;
        col+=vec3(cr,cg,cb)*m*uDotRefr*(.7+.3*k);
      }
    }
  }
  col+=fc*smoothstep(.985,.997,r)*smoothstep(1.002,.996,r)*uRim;
  if(uEnvOn>0.){
    // The app behind, seen in the bubble the way a real one shows it (unit sphere, viewer at +z, the app a plane uEnvK.z radii
    // behind the bubble's centre). Only rays that end up going backward can see the app: that is the outer ring (r > 0.707).
    // Front surface = convex mirror: upright, squeezed toward the rim. Back wall from inside = concave mirror: upside down and
    // flipped (a small inverted image), weaker because the light passes the film twice. Both are tinted by the film colour.
    vec3 R1=vec3(2.*z*p, 2.*z*z-1.);
    float w1=smoothstep(0.,-.12,R1.z);
    if(w1>0.){
      vec2 h1=p+R1.xy*((uEnvK.z+z)/max(-R1.z,.05));
      vec3 e1=texture2D(uEnv,clamp(uEnvR.xy+h1*uEnvR.zw,.002,.998)).rgb;
      vec2 h2=p-R1.xy*((uEnvK.z-z)/max(-R1.z,.05));
      vec3 e2=texture2D(uEnv,clamp(uEnvR.xy+h2*uEnvR.zw,.002,.998)).rgb;
      vec3 tc=mix(vec3(1.),.55+.9*fc,uEnvK.w);
      col+=(e1*uEnvK.x + e2*uEnvK.y*(1.-F))*F*w1*tc*uEnvOn;
    }
  }
  col=1.-exp(-col*1.15);
  // a real bubble is clear: what is behind shows through wherever the film reflects little (premultiplied: col + behind*(1-a))
  float a=mix(1.,clamp(max(col.r,max(col.g,col.b))*1.2,0.,1.),uSee);
  gl_FragColor=vec4(col*inside, inside*a);
}`;

  let rr = 0; const BUDGET = 4;   // ms of drawing per frame (the owner 11-24: no lags or freezes)
  let gl = null, gc = null, off = false, uRes, uTime, uSeed, uEnvOn, uEnvR, uEnvK, uSee, env = null, envArea = null, envSkip = null, items = [], maxPx = 1, raf = 0, last = 0, io = null, t0 = 0, broken = false;
  // amount = overall, front = upright image (outer surface), back = upside-down image (inner back wall), distance = how far the app
  // is behind the bubble (in bubble radii), tint = film colour on it, blur = softness, see = how see-through the bubble is
  let solo = null;
  const RK = { amount: 4, front: 2, back: 1, distance: 3, tint: 0.1, blur: 0.5, see: 0.1 };   // the owner's tuned look, 2026-11-21
  const still = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function setup() {
    if (gl || broken) return !!gl;
    try {
      // One shared context. With OffscreenCanvas each frame goes to a badge as an ImageBitmap (no read-back from the GPU);
      // older browsers copy from a hidden canvas instead.
      off = typeof root.OffscreenCanvas === 'function' && typeof root.ImageBitmapRenderingContext === 'function';
      gc = off ? new root.OffscreenCanvas(64, 64) : document.createElement('canvas');
      gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
      if (!gl && off) { off = false; gc = document.createElement('canvas'); gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }); }
    } catch (e) { gl = null; }
    if (!gl) { broken = true; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    const pr = v && f && gl.createProgram();
    if (pr) { gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr); }
    if (!pr || !gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.info('[ACH] bubble: shader unavailable, using the plain look'); gl = null; broken = true; return false; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uRes = gl.getUniformLocation(pr, 'uRes'); uTime = gl.getUniformLocation(pr, 'uTime'); uSeed = gl.getUniformLocation(pr, 'uSeed');
    uEnvOn = gl.getUniformLocation(pr, 'uEnvOn'); uEnvR = gl.getUniformLocation(pr, 'uEnvR'); uEnvK = gl.getUniformLocation(pr, 'uEnvK'); uSee = gl.getUniformLocation(pr, 'uSee');
    LU = {}; for (const k in LOOK_U) LU[k] = gl.getUniformLocation(pr, LOOK_U[k]);
    gl.uniform1i(gl.getUniformLocation(pr, 'uEnv'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    t0 = performance.now();
    if ('IntersectionObserver' in root) io = new IntersectionObserver((es) => es.forEach((e) => { const it = items.find((x) => x.c === e.target); if (it) it.vis = e.isIntersecting; }));
    return true;
  }

  function draw(now) {
    const t = still() ? 14 : (now - t0) / 1000;
    const n = items.length, tA = performance.now(), budget = still() ? 1e9 : BUDGET;
    let drew = 0;
    for (let j = 0; j < n; j++) {
      const it = items[(rr + j) % n];
      if (solo && it.c !== solo) continue;
      if (drew && !it.fresh && performance.now() - tA > budget) { rr = (rr + j) % n; return; }   // out of time: the rest go next frame
      if (!it.vis && !it.fresh) continue;
      it.fresh = false;
      if (off && (gc.width !== it.px || gc.height !== it.px)) { gc.width = it.px; gc.height = it.px; }
      gl.viewport(0, 0, it.px, it.px);
      gl.uniform2f(uRes, it.px, it.px); gl.uniform1f(uTime, t); gl.uniform1f(uSeed, it.seed);
      for (const k in LU) gl.uniform1f(LU[k], +root.ACHLook[k]);
      const er = it.reflect && env && envRect(it.c);
      gl.uniform1f(uEnvOn, er ? RK.amount : 0);
      gl.uniform1f(uSee, it.reflect ? RK.see : 0);
      if (er) { gl.uniform4f(uEnvR, er[0], er[1], er[2], er[3]); gl.uniform4f(uEnvK, RK.front, RK.back, Math.max(1.05, RK.distance), RK.tint); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); drew++;
      if (off) { it.ctx.transferFromImageBitmap(gc.transferToImageBitmap()); continue; }
      it.ctx.clearRect(0, 0, it.px, it.px);
      it.ctx.drawImage(gc, 0, maxPx - it.px, it.px, it.px, 0, 0, it.px, it.px);
    }
  }
  function loop(now) {
    raf = 0;
    items = items.filter((it) => it.c.isConnected);
    if (!items.length) return;
    // 60 fps (the owner 11-21: 30 felt laggy); holds still while a full plaque view is open (data-ach-hold on <html>)
    if (!document.hidden && (!document.documentElement.hasAttribute('data-ach-hold') || solo) && now - last > 12) { draw(now); last = now; }
    if (!still()) raf = requestAnimationFrame(loop);
  }

  // Start every canvas.ach-bubble under `scope` that is not running yet. Safe to call after each render.
  function mount(scope) {
    const list = Array.from((scope || document).querySelectorAll('canvas.ach-bubble:not([data-live])'));
    if (!list.length) return 0;
    if (!setup()) { list.forEach((c) => { c.classList.add('nogl'); c.dataset.live = '0'; if (c.parentElement) c.parentElement.classList.add('is-nogl'); }); return 0; }
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    for (const c of list) {
      const css = parseFloat(c.getAttribute('data-size')) || c.clientWidth || 44;
      const px = Math.max(16, Math.round(css * dpr));
      c.width = px; c.height = px; c.dataset.live = '1';
      maxPx = Math.max(maxPx, px);
      items.push({ c, ctx: c.getContext(off ? 'bitmaprenderer' : '2d'), px, seed: (items.length % 5) * 7.3, vis: true, fresh: true, reflect: c.hasAttribute('data-reflect') });
      if (io) io.observe(c);
    }
    items.sort((a, b) => a.px - b.px); rr = 0;
    if (!off && (gc.width !== maxPx || gc.height !== maxPx)) { gc.width = maxPx; gc.height = maxPx; }
    if (still()) draw(performance.now());
    else if (!raf) raf = requestAnimationFrame(loop);
    return list.length;
  }

  /** Where a bubble sits in the reflected picture: centre and half size, 0-1, y up. */
  function envRect(c) {
    const r = c.getBoundingClientRect(), f = env.rect;
    if (!r.width || !f.width) return null;
    return [(r.left + r.width / 2 - f.left) / f.width, 1 - (r.top + r.height / 2 - f.top) / f.height, r.width / 2 / f.width, r.height / 2 / f.height];
  }

  /**
   * A small, soft picture of the page behind a moment, for the bubble's reflection (canvas[data-reflect]). Drawn from the layout
   * itself (boxes with a background, text lines, pictures that are safe to read), so no screenshot and no extra permission.
   * `area` is the element whose box is pictured (the page or a demo stage); `skip` is left out (the moment itself).
   */
  function reflect(area, skip) {
    if (!setup()) return false;
    envArea = area; envSkip = skip;
    const box = area === document.body || area === document.documentElement ? { left: 0, top: 0, width: root.innerWidth, height: root.innerHeight } : area.getBoundingClientRect();
    const W = 256, H = Math.max(64, Math.round(W * box.height / Math.max(1, box.width)));
    const pic = document.createElement('canvas'); pic.width = W; pic.height = H;
    const g = pic.getContext('2d');
    const sx = W / box.width, sy = H / box.height;
    const paint = (imgs) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = getComputedStyle(document.body).backgroundColor || '#151413'; g.fillRect(0, 0, W, H);
      const walk = document.createTreeWalker(area, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let el = walk.currentNode; el && n < 1500; el = walk.nextNode(), n++) {
        if (skip && skip.contains(el)) continue;
        if (el.nodeType === 3) {
          if (!el.data.trim() || !el.parentElement) continue;
          const cs = getComputedStyle(el.parentElement);
          if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
          const rg = document.createRange(); rg.selectNodeContents(el);
          g.fillStyle = cs.color; g.globalAlpha = .55;
          for (const q of rg.getClientRects()) g.fillRect((q.left - box.left) * sx, (q.top - box.top + q.height * .25) * sy, q.width * sx, q.height * .5 * sy);
          g.globalAlpha = 1;
          continue;
        }
        const q = el.getBoundingClientRect();
        if (!q.width || !q.height || q.right < box.left || q.bottom < box.top || q.left > box.left + box.width || q.top > box.top + box.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        const x = (q.left - box.left) * sx, y = (q.top - box.top) * sy, w = q.width * sx, h = q.height * sy;
        if (imgs && (el.tagName === 'IMG' || el.tagName === 'CANVAS') && !el.classList.contains('ach-bubble')) { try { g.drawImage(el, x, y, w, h); } catch (e) { /* not drawable */ } continue; }
        const bg = cs.backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      }
    };
    paint(true);
    let ok = true;
    try { g.getImageData(0, 0, 1, 1); } catch (e) { ok = false; }   // a picture from another site taints the canvas: draw again without pictures
    if (!ok) paint(false);
    const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
    const s2 = soft.getContext('2d'); s2.filter = `blur(${RK.blur}px)`; s2.drawImage(pic, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, soft); } catch (e) { env = null; return false; }
    env = { rect: box };
    return true;
  }

  /** Reflection settings (the owner tunes them on the design page). blur needs a new picture, the rest apply on the next frame. */
  function setReflect(o) {
    const blurWas = RK.blur;
    for (const k of Object.keys(RK)) if (o && Number.isFinite(+o[k])) RK[k] = +o[k];
    if (RK.blur !== blurWas && env && envArea && envArea.isConnected !== false) reflect(envArea, envSkip);
    if (still()) draw(performance.now());
    return Object.assign({}, RK);
  }

  /** Draw only this canvas (the full view); null = back to all. */
  function only(c) { solo = c || null; items.forEach((it) => { it.fresh = true; }); if (still()) draw(performance.now()); else if (!raf && items.length) raf = requestAnimationFrame(loop); }
  /** Draw every bubble again now (after a look change, when motion is reduced and nothing animates). */
  function redraw() { items.forEach((it) => { it.fresh = true; }); if (gl && still()) draw(performance.now()); }
  const api = { mount, reflect, setReflect, only, redraw, supported: () => setup() };
  root.ACHBubble = api;
})(typeof window !== 'undefined' ? window : globalThis);



// ES module entry for the app (the file above is the Achievements Lab source, unchanged)
export default (typeof window !== 'undefined' ? window : globalThis).ACHBubble;

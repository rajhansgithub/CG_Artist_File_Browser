/* Real 3D for the full view (v4+): Diamond and Ruby are ray traced as a round brilliant (73 facets: table, 8 bezel, 8 star,
   16 upper girdle, 16 girdle, 8 pavilion mains, 16 lower girdle). Light enters through the crown, bounces inside off the
   pavilion (total internal reflection), and leaves; diamond splits colour at the exit (fire), ruby absorbs green and blue along
   the path. Emulsion is a sphere of soap film: interference colour on the front and on the inside of the back wall, the film
   thinner at the top (it drains), and the app's mark (example: a pulse line) floating inside.
   One canvas at a time (the full view). ACH3D.start(canvas, 'dia'|'ruby'|'bubble'); ACH3D.rot(yaw, pitch, spin) in degrees;
   ACH3D.stop(). No WebGL: start() returns false and the caller keeps the flat medal. */
(function (root) {
  'use strict';
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const D2R = Math.PI / 180;

  /* ---- brilliant geometry (girdle radius 1, centred in z): table, 8 bezel, 8 star, 16 upper girdle, 16 girdle, 8 pavilion mains,
     16 lower girdle = 73 planes, walked in one loop over the 16 sectors (8-fold symmetry), so the shader stays small */
  function geo(shallow) {
    const gt = 0.02, gb = -0.02, rt = 0.56, cA = (shallow ? 30 : 34.5) * D2R, pA = (shallow ? 35 : 40.75) * D2R, sA = 21 * D2R, ugA = 42 * D2R, lgA = 42 * D2R;
    const zTab = gt + (1 - rt) * Math.tan(cA), zCul = gb - Math.tan(pA), zc = (zTab + zCul) / 2;
    // a plane tilted by th at azimuth phi through the point at radius r, height z: c = sin(th)*r + (+/-cos(th))*(z - zc)
    const cUp = (th, r, z) => Math.sin(th) * r + Math.cos(th) * (z - zc), cDn = (th, r, z) => Math.sin(th) * r - Math.cos(th) * (z - zc);
    const n = (x) => x.toFixed(6);
    return `
const float TABC=${n(zTab - zc)}; const float GIRZ=${n(gt - zc)};
const vec2 BEZ=vec2(${n(Math.sin(cA))},${n(Math.cos(cA))}); const float BEZC=${n(cUp(cA, 1, gt))};
const vec2 STA=vec2(${n(Math.sin(sA))},${n(Math.cos(sA))}); const float STAC=${n(cUp(sA, rt / Math.cos(Math.PI / 8), zTab))};
const vec2 UGI=vec2(${n(Math.sin(ugA))},${n(Math.cos(ugA))}); const float UGIC=${n(cUp(ugA, 1, gt))};
const vec2 PAV=vec2(${n(Math.sin(pA))},${n(-Math.cos(pA))}); const float PAVC=${n(cDn(pA, 1, gb))};
const vec2 LGI=vec2(${n(Math.sin(lgA))},${n(-Math.cos(lgA))}); const float LGIC=${n(cDn(lgA, 1, gb))};
const vec2 ROT8=vec2(${n(Math.cos(Math.PI / 8))},${n(Math.sin(Math.PI / 8))}); const vec2 HALF=vec2(${n(Math.cos(Math.PI / 16))},${n(Math.sin(Math.PI / 16))});`;
  }

  const COMMON = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform mat3 uR; uniform mat3 uRT; uniform float uKind;
const float PI=3.14159265; const float TAU=6.2831853;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
// eye at z=6 looking at the origin: a mild perspective so turning reads as 3D
void cam(out vec3 o, out vec3 d, out float pxw, float ext){
  float S=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/(.5*S)*ext;
  o=vec3(0.,0.,6.); d=normalize(vec3(p,0.)-o); pxw=2.*ext/S;
}`;

  const ENVS = `
float envS(vec3 d, float t){
  d.xy=rot(.12*sin(t*.21))*d.xy;
  float s=.09+.12*smoothstep(-.2,.9,d.y);
  vec3 a=normalize(vec3(-.42,.46,.78));
  vec3 ux=normalize(cross(vec3(0.,0.,1.),a)), uy=cross(a,ux);
  float ca=dot(d,a);
  if(ca>0.){ vec2 q=vec2(dot(d,ux),dot(d,uy))/ca; s+=2.6*smoothstep(.08,-.08,max(abs(q.x)-.55,abs(q.y)-.40))*(.8+.2*smoothstep(-.3,.3,q.y)); }
  vec3 b=normalize(vec3(.82,0.,.57)); float cb=dot(d,b);
  if(cb>0.){ vec3 bx=normalize(cross(vec3(0.,1.,0.),b)); vec2 q=vec2(dot(d,bx),d.y)/cb; s+=1.8*smoothstep(.05,-.05,max(abs(q.x)-.08,abs(q.y)-1.)); }
  s+=.32*smoothstep(-.05,-.7,d.y)*smoothstep(-.4,.2,d.z);
  s+=.25*exp(-pow((d.y+.1)/.03,2.))*smoothstep(-.5,.2,d.z);
  s+=9.*pow(max(dot(d,normalize(vec3(.3,.62,.72))),0.),700.);
  return s;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
`;
  const GEM = COMMON + (root.ACHWearGLSL || 'uniform vec3 uWear; uniform vec4 uAge[4]; vec3 aged(vec3 c,float a,vec2 p,float r,float f,float m,float aa){return c;}') + `
// studio (world space, +z = towards the viewer): soft ceiling, three strip lights, hard spots, and the viewer's dark head
float env(vec3 d){
  d.xy=rot(uTime*.05)*d.xy;
  float az=atan(d.y,d.x);
  float s=.03+.45*smoothstep(-.1,.9,d.z);
  s+=1.1*pow(max(cos(az*3.)*.5+.5,0.),5.)*smoothstep(-.2,.5,d.z)*smoothstep(.98,.75,d.z);
  s+=pow(max(dot(d,normalize(vec3(.55,.55,.63))),0.),140.)*8.;
  s+=pow(max(dot(d,normalize(vec3(-.72,.25,.64))),0.),100.)*5.;
  s+=pow(max(dot(d,normalize(vec3(.05,-.78,.62))),0.),180.)*7.;
  s+=pow(max(dot(d,normalize(vec3(.3,.1,-.95))),0.),30.)*1.2;    // a light behind, seen through the stone when it is turned
  s+=1.5*smoothstep(.72,.9,d.z)*smoothstep(.99,.95,d.z)*(.75+.25*cos(az*8.));   // a ring light round the viewer, like a jeweller's lamp
  s*=1.-.9*smoothstep(.975,.995,d.z);                             // the viewer's head: small and dark, straight in front
  return s;
}
${geo()}
#define P(N,C) { vec3 nn=N; float dn=dot(nn,d); float tt=(C-dot(nn,o))/dn; if(dn<0.){ if(tt>tIn){ tIn=tt; nIn=nn; } } else { if(tt<tOut){ tOut=tt; nOut=nn; } } }
// ray o + t d against the stone (a convex solid: inside every plane): entry t and facet, exit t and facet
void trav(vec3 o, vec3 d, out float tIn, out vec3 nIn, out float tOut, out vec3 nOut){
  tIn=-1e9; tOut=1e9; nIn=vec3(0.,0.,1.); nOut=vec3(0.,0.,1.);
  P(vec3(0.,0.,1.),TABC)
  vec2 cs=vec2(1.,0.);                                  // cos, sin of the sector angle k*pi/8
  for(int k=0;k<16;k++){
    vec2 ch=vec2(cs.x*HALF.x-cs.y*HALF.y, cs.y*HALF.x+cs.x*HALF.y);   // k*pi/8 + pi/16
    P(vec3(cs,0.),1.)                                   // girdle
    P(vec3(ch*UGI.x,UGI.y),UGIC)                        // upper girdle
    P(vec3(ch*LGI.x,LGI.y),LGIC)                        // lower girdle
    if(k==2*(k/2)){ P(vec3(cs*BEZ.x,BEZ.y),BEZC) P(vec3(cs*PAV.x,PAV.y),PAVC) }   // bezel + pavilion main
    else { P(vec3(cs*STA.x,STA.y),STAC) }               // star
    cs=vec2(cs.x*ROT8.x-cs.y*ROT8.y, cs.y*ROT8.x+cs.x*ROT8.y);
  }
}
float fres(float c, float ior){ float F0=pow((ior-1.)/(ior+1.),2.); return F0+(1.-F0)*pow(1.-clamp(c,0.,1.),5.); }
${ENVS}
uniform sampler2D uLens; uniform float uLensOn;
/* The lens barrel the stone is set in (the owner 11-24: "not just the whole diamond by itself"). Object space, girdle radius 1.
   Front to back: a dark inner bezel that holds the girdle, its polished wall, the name ring (black, white lettering, the red or
   ice ring), a chrome step, the frame-rate scale, the knurled grip, the engraved back, and the bore behind the stone.
   Flat rings and cylinders, solved exactly: no march, so it costs little next to the stone. */
const float RB=.95, R1=1.10, R2=1.52, R3=1.74, ZL=.36, ZF=.46, ZG=.30, ZB=-.64, EXT=2.;
void pz(vec3 o, vec3 d, float z, float ra, float rb, float s, float id, inout float bt, inout vec3 bn, inout float bm){
  if(d.z*s>=0.) return;
  float t=(z-o.z)/d.z; if(t<=0.||t>=bt) return;
  vec2 q=o.xy+d.xy*t; float r2=dot(q,q);
  if(r2<ra*ra||r2>rb*rb) return;
  bt=t; bn=vec3(0.,0.,s); bm=id;
}
void pc(vec3 o, vec3 d, float R, float za, float zb, float s, float id, inout float bt, inout vec3 bn, inout float bm){
  float A=dot(d.xy,d.xy); if(A<1e-7) return;
  float B=dot(o.xy,d.xy), C=dot(o.xy,o.xy)-R*R, h=B*B-A*C; if(h<0.) return;
  float t=(-B-s*sqrt(h))/A; if(t<=0.||t>=bt) return;
  float z=o.z+d.z*t; if(z<za||z>zb) return;
  bt=t; bn=vec3(s*(o.xy+d.xy*t)/R,0.); bm=id;
}
float barrel(vec3 o, vec3 d, out vec3 bn, out float bm){
  float bt=1e9; bn=vec3(0.,0.,1.); bm=0.;
  pz(o,d,ZL,RB,R1,1.,1.,bt,bn,bm);    // inner bezel
  pc(o,d,R1,ZL,ZF,-1.,2.,bt,bn,bm);   // its polished wall
  pz(o,d,ZF,R1,R2,1.,3.,bt,bn,bm);    // name ring
  pc(o,d,R2,ZG,ZF,1.,4.,bt,bn,bm);    // chrome step
  pz(o,d,ZG,R2,R3,1.,5.,bt,bn,bm);    // frame-rate scale
  pc(o,d,R3,ZB,ZG,1.,6.,bt,bn,bm);    // knurled grip
  pz(o,d,ZB,RB,R3,-1.,7.,bt,bn,bm);   // the back
  pc(o,d,RB,ZB,ZL,-1.,8.,bt,bn,bm);   // the bore behind the stone
  return bt;
}
vec3 rayD(vec2 fc){ float S=min(uRes.x,uRes.y); return normalize(vec3((fc-.5*uRes)/(.5*S)*EXT,-6.)); }
// satin metal: three reflections smeared along one direction (a turned or brushed finish), one for a mirror
float envA(vec3 dw, vec3 nw, vec3 aw, float k, float t){
  if(k<=0.) return envS(reflect(dw,nw),t);
  return (envS(reflect(dw,normalize(nw-aw*k)),t)+envS(reflect(dw,nw),t)+envS(reflect(dw,normalize(nw+aw*k)),t))/3.;
}
void main(){
  vec3 ow, dw; float pxw; cam(ow,dw,pxw,EXT);
  vec3 o=uRT*ow, d=uRT*dw;
  float b0=dot(o,d), h0=b0*b0-dot(o,o)+3.7;          // the whole lens fits a sphere of r 1.92
  if(h0<0.){ gl_FragColor=vec4(0.); return; }
  // the barrel, and four sub-pixel rays for a clean outline (cheap: no march)
  vec3 bn; float bm; float bt=barrel(o,d,bn,bm);
  vec3 sd=d; float hits=bm>0.?1.:0.;
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec2 of=vec2(mod(fi*3.,4.)-1.5,fi-1.5)*.25;          // a rotated grid
    vec3 di=uRT*rayD(gl_FragCoord.xy+of);
    vec3 n2; float m2; float t2=barrel(o,di,n2,m2);
    if(m2>0.){ hits+=1.; if(bm<=0.){ bt=t2; bn=n2; bm=m2; sd=di; } }
  }
  float bcov=hits*.2;
  bool ruby=uKind>.5;
  float tt=uTime;
  // ---- the barrel's surface
  vec3 bp=o+sd*bt;
  vec2 q=bm==7.?vec2(-bp.x,bp.y):bp.xy;             // face coordinates as you look at that face
  float r=length(q); vec2 rq=r>1e-4?q/r:vec2(1.,0.);
  float aa=pxw*1.4;
  // lettering (white paint on the front rings, engraved on the back): one strip texture, rows bent round the rings
  float top=step(0.,q.y);
  float ri=bm==3.?1.17:bm==5.?1.545:1.12, ro=bm==3.?1.40:bm==5.?1.715:1.50;
  float row=(bm==3.?0.:bm==5.?2.:3.)+(1.-top);
  float AT=1.396, AB=.96;
  float u=top>.5?atan(q.x,q.y)/(2.*AT)+.5:atan(q.x,-q.y)/(2.*AB)+.5;
  float vv=top>.5?(ro-r)/(ro-ri):(r-ri)/(ro-ri);
  float inBand=step(0.,u)*step(u,1.)*step(0.,vv)*step(vv,1.)*((bm==3.||bm==7.)?1.:(bm==5.?top:0.));
  float ink=texture2D(uLens,vec2(clamp(u,.002,.998),(row+.04+clamp(vv,0.,1.)*.92)/8.)).a*inBand*uLensOn;
  vec3 col=vec3(0.); float rec=0., flt=1.;
  if(bm>0.){
    vec3 n=bn, ax=vec3(rq,0.);                       // ax: the direction the finish smears the light
    vec3 alb=vec3(.02); vec3 F0=vec3(.045); float k=.35;
    vec3 acc=ruby?vec3(.62,.015,.04):mix(vec3(.62,.84,1.),vec3(.77,.78,1.),.5+.5*sin(atan(q.y,q.x)*2.+tt*.4));
    if(bm==1.){                                     // inner bezel: satin black, a polished edge where it holds the stone
      float e=smoothstep(RB+.035,RB+.01,r);
      n=normalize(vec3(-rq*mix(.18,.9,e),1.)); F0=mix(vec3(.05),vec3(.6,.61,.65),e); k=mix(.35,0.,e); rec=.8;
    } else if(bm==2.){ F0=vec3(.62,.63,.67); k=0.; alb=vec3(0.); flt=.3; ax=vec3(0.,0.,1.); }
    else if(bm==3.){
      float b1=smoothstep(R1+.045,R1+.03,r), b2=smoothstep(R2-.045,R2-.03,r);   // chamfers at both edges
      float ac=smoothstep(1.415-aa,1.415+aa,r)*smoothstep(1.47+aa,1.47-aa,r);      // the red / ice ring
      n=normalize(vec3(rq*(b2*.8-b1*.8),1.));
      F0=mix(vec3(.045),vec3(.7,.71,.75),max(b1,b2)); k=mix(.5,0.,max(b1,b2));
      alb=mix(alb,acc*.55,ac); F0=mix(F0,ruby?vec3(.09,.02,.03):acc*.6,ac);
      alb=mix(alb,vec3(.78,.78,.76),ink); rec=.25+.5*b1;
    } else if(bm==4.){ F0=vec3(.86,.87,.9); k=0.; alb=vec3(0.); flt=.3; }
    else if(bm==5.){
      float b2=smoothstep(R3-.035,R3-.02,r);
      n=normalize(vec3(rq*b2*.9,1.)); F0=mix(vec3(.05),vec3(.6,.61,.65),b2); k=mix(.4,0.,b2);
      alb=mix(alb,vec3(.8,.8,.78),ink); rec=.35;
    } else if(bm==6.){                              // diamond knurl, like a focus ring
      float A=atan(bp.y,bp.x)*48., Z=bp.z*48./R3;   // little pyramids: two sets of grooves crossing on the diagonals
      vec2 tg=vec2(-rq.y,rq.x);
      float fade=clamp(1.6-pxw*48./R3*3.,0.,1.);   // too fine to draw on a small canvas: smooth it out
      float s1=sin(A+Z), s2=sin(A-Z), c1=sign(s1)*cos(A+Z), c2=sign(s2)*cos(A-Z);
      float h=abs(s1)+abs(s2)-1.;
      n=normalize(n-(vec3(tg,0.)*(c1+c2)+vec3(0.,0.,1.)*(c1-c2))*.42*fade);
      alb=vec3(.035)*(.75+.25*h); F0=vec3(.08)*(.8+.2*h); k=0.; rec=.5-.3*h; flt=.35;
    } else if(bm==7.){                              // the back: spun gunmetal, the words engraved (a matte floor)
      float b1=smoothstep(RB+.06,RB+.03,r), b2=smoothstep(R3-.05,R3-.03,r);
      n=vec3(0.,0.,-1.)+vec3(rq*(b2-b1)*.8*vec2(-1.,1.),0.); n=normalize(n);
      F0=vec3(.52,.53,.57)*(1.-.7*ink); alb=vec3(.04)*ink; k=mix(.55,0.,max(b1,b2)); rec=.2+.8*ink;
      ax=vec3(rq*vec2(-1.,1.),0.);
    } else { F0=vec3(.03); alb=vec3(.008); k=0.; rec=1.; flt=.3; }
    vec3 nw=uR*n, aw=uR*ax, dW=uR*sd;
    float cv=clamp(-dot(nw,dW),0.,1.);
    vec3 F=F0+(1.-F0)*pow(1.-cv,5.)*(1.-.6*step(F0.r,.1));   // dielectric paints: a softer grazing sheen
    float en=envA(dW,nw,aw,k,tt);
    float dif=.12+.30*clamp(envS(nw,tt),0.,1.4);
    col=F*en+alb*dif;
    if(bm==1.||bm==8.) col*=.55+.45*smoothstep(RB-.2,R1,r);   // the hollow round the stone is darker
    col=aces(col*1.1);
    col=aged(col,1.,q/R3,rec,flt,1.,pxw/R3);
  }
  vec4 B=vec4(col*bcov,bcov);
  // ---- the stone: only where its own sphere is in front of the barrel
  float bs=dot(o,d), hs=bs*bs-dot(o,o)+1.1;
  if(hs<0. || -bs-sqrt(hs)>=bt){ gl_FragColor=B; return; }
  float tIn, tOut; vec3 nIn, nOut;
  trav(o,d,tIn,nIn,tOut,nOut);
  if(tIn>=tOut || tOut<0. || tIn>=bt){ gl_FragColor=B; return; }
  float cover=clamp((tOut-tIn)/(pxw*2.5),0.,1.);
  float ior=ruby?1.77:2.417;
  vec3 iorC=ruby?vec3(1.762,1.77,1.778):vec3(2.37,2.417,2.47);   // diamond fire a touch stronger than life so it reads on screen
  vec3 absorb=ruby?vec3(.12,3.4,2.7):vec3(.004,.006,.01);
  vec3 p=o+d*tIn;
  vec2 pe=p.xy;
  float ci=-dot(d,nIn);
  float Fr=fres(ci,ior);
  vec3 sc=vec3(Fr*env(uR*reflect(d,nIn)))*.8;
  vec3 di=refract(d,nIn,1./ior);
  vec3 thr=vec3(1.-Fr);
  for(int b=0;b<6;b++){
    float a1,a2; vec3 n1,n2;
    trav(p+di*1e-4,di,a1,n1,a2,n2);
    float L=max(a2,0.);
    thr*=exp(-absorb*L);
    p=p+di*L;
    float c=dot(di,n2);                         // leaving through the facet with outward normal n2
    vec3 outM=refract(di,-n2,ior);
    if(dot(outM,outM)<1e-4){ di=reflect(di,n2); continue; }   // total internal reflection: stays inside
    float Fo=fres(c,ior);
    vec3 e;
    vec3 oR=refract(di,-n2,iorC.r), oG=refract(di,-n2,iorC.g), oB=refract(di,-n2,iorC.b);
    e.r=dot(oR,oR)>1e-4?env(uR*oR):0.;
    e.g=env(uR*oG);
    e.b=dot(oB,oB)>1e-4?env(uR*oB):0.;
    sc+=thr*(1.-Fo)*e;
    thr*=Fo;
    di=reflect(di,n2);
  }
  sc+=thr*.04;
  if(ruby){
    sc*=vec3(1.,.55,.6);
    sc+=vec3(.16,.005,.025)+vec3(.5,.02,.06)*pow(.5+.5*sin(uTime*.8+dot(nIn,vec3(3.1,1.7,2.3))*4.),3.)*.35;   // its slow red glow
    sc=pow(sc,vec3(1.15));
  } else {
    sc=pow(sc*.8,vec3(1.7))*1.25+.01;          // a brilliant is mostly bright white and near black
  }
  sc=1.-exp(-max(sc,0.)*1.6);
  float lp=length(pe);
  sc=aged(sc,1.,pe/R3,smoothstep(.8,.97,lp)*.7,1.-.3*smoothstep(.5,1.,lp),0.,pxw/R3);   // dust gathers where the stone meets the bezel
  gl_FragColor=vec4(sc*cover,cover)+B*(1.-cover);
}`;

  const BUBBLE = COMMON + `
uniform float uBExt, uBS;   // camera extent and the bubble's radius (1.03, 1: the bubble alone; 1.22, the hole: in a housing)
uniform float uEdgeW, uEdgeVary, uEdgeCol, uSat, uFilmIn, uRefl, uFlow, uThick, uRim, uGlow, uBreath, uMotAmt, uMotT, uDotRefr, uDotRing, uRefrT;   // the look (ACHLook)
uniform float uLqRefr, uLqRefl, uLqFilm, uLqTint, uLqWob, uLqDrops, uLqDropS, uLqMove;   // the liquid pulse
float h3(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return v; }
vec3 wl(float l){ return vec3(exp(-pow((l-605.)/48.,2.)) + .28*exp(-pow((l-425.)/28.,2.)), exp(-pow((l-545.)/42.,2.)), exp(-pow((l-455.)/32.,2.))); }
vec3 film(float d, float cosT){
  vec3 c=vec3(0.), s=vec3(0.);
  for(int i=0;i<8;i++){ float l=400.+float(i)*42.857; vec3 w=wl(l); float ph=TAU*2.*1.33*d*cosT/l; c+=w*(.5-.5*cos(ph)); s+=w; }
  vec3 f=2.*c/s; float y=dot(f,vec3(.299,.587,.114));
  return mix(vec3(y),f,uSat);
}
// film thickness (nm) at a point of the sphere: swirls that turn with the bubble, thinner at the top where the film drains
float thick(vec3 pw){
  vec3 q=uRT*pw;
  float ft=uTime*.06*uFlow;
  vec3 w=vec3(fbm3(q*1.1+vec3(0.,ft,0.)), fbm3(q*1.1+vec3(5.2,1.3,-ft)), 0.);
  float n=fbm3(q*1.4+w*1.3+vec3(ft*.4,-ft*.3,ft*.2));
  return max(uThick+420.*(n-.5)-120.*pw.y, 20.);   // same range as the flat badge
}
// studio: a big soft window up left, a floor glow, a small hard light; +z = towards the viewer
float env(vec3 r){
  vec3 wd=normalize(vec3(-.45,.55,.7));
  vec3 u=normalize(cross(wd,vec3(0.,0.,1.))+vec3(0.,1e-4,0.)), v=cross(u,wd);
  vec2 q=vec2(dot(r,u),dot(r,v))/max(dot(r,wd),.05);
  float win=smoothstep(.16,0.,length(max(abs(q)-vec2(.16,.11),0.))-.04)*step(0.,dot(r,wd));   // a soft, rounded window
  float floorL=smoothstep(-.1,-.8,r.y)*.55;
  float spot=pow(max(dot(r,normalize(vec3(.6,.35,.72))),0.),300.)*6.;
  return .05+1.15*win+floorL+spot;
}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
// CG Artist File Browser mark: the Layers icon (a rhombus over two chevrons), distance to its lines in icon units (24 box)
float markD(vec2 p){
  float d=min(min(seg(p,vec2(12.,3.2),vec2(19.4,6.2)),seg(p,vec2(19.4,6.2),vec2(12.,9.2))),min(seg(p,vec2(12.,9.2),vec2(4.6,6.2)),seg(p,vec2(4.6,6.2),vec2(12.,3.2))));
  d=min(d,min(seg(p,vec2(4.6,9.6),vec2(12.,12.6)),seg(p,vec2(12.,12.6),vec2(19.4,9.6))));
  return min(d,min(seg(p,vec2(4.6,12.6),vec2(12.,15.6)),seg(p,vec2(12.,15.6),vec2(19.4,12.6))));
}
// the app's mark (example: a pulse line), floating in the middle of the bubble (same mark as the badge). Swap per app.
float logo(vec2 q, float aa){
  q/=1.+uMotAmt*.05*sin(uTime*TAU/uMotT);
  vec2 p=vec2(12.+q.x*9., 9.4-q.y*9.);
  float a=aa*9.;
  float pl=markD(p)-.95;
  return smoothstep(a,-a,pl);
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
vec3 mark(vec2 q, float k, float aa){
  float y=q.y;
  vec3 dc=mix(vec3(1.,.42,.23), vec3(1.,.86,.45), smoothstep(-.9,-.3,y));
  dc=mix(dc, vec3(1.), smoothstep(-.25,0.,y)); dc=mix(dc, vec3(.55,.85,1.), smoothstep(.1,.45,y)); dc=mix(dc, vec3(.31,.55,1.), smoothstep(.5,.95,y));
  return glow(q,k)*.55 + logo(q,aa)*dc*(1.-.15*k);
}
vec3 dcol(float y){   // the pulse's colour by height (mark units)
  vec3 dc=mix(vec3(1.,.42,.23), vec3(1.,.86,.45), smoothstep(-.9,-.3,y));
  dc=mix(dc, vec3(1.), smoothstep(-.25,0.,y)); dc=mix(dc, vec3(.55,.85,1.), smoothstep(.1,.45,y)); return mix(dc, vec3(.31,.55,1.), smoothstep(.5,.95,y));
}
// ---- the pulse as a liquid: a tube of liquid in the shape of the mark, floating inside the sphere (object space, turns with it)
float sg3(vec3 p, vec3 a, vec3 b){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float smn(float a, float b, float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
// tiny bubbles that belong to the pulse: fixed places round the line (same in the flat badge), drifting a little
vec4 drop(float fi, float t){
  vec3 c=vec3(-.6+fi*.105+.03*sin(fi*7.3), .30*sin(fi*2.39+.5)-.03, .08*sin(fi*1.7));
  c+=.014*uLqMove*vec3(sin(t*.5+fi), sin(t*.43+fi*2.), sin(t*.31+fi*1.3));
  return vec4(c,(.013+.026*fract(fi*.618))*uLqDropS);
}
float liq(vec3 p){
  float t=uTime;
  // alive, but calm: the pulse drifts and tilts very slightly
  p.y-=.012*uLqMove*sin(t*.6);
  p.xy=rot(.035*uLqMove*sin(t*.37))*p.xy;
  float sc=1.+uMotAmt*.05*sin(t*TAU/uMotT);
  p/=sc;
  // the Layers mark: icon points (x,y) -> ((x-12)*.06889, (9.4-y)*.06889). A rhombus on top, two chevrons under it.
  vec3 A=vec3(0.,.4271,0.), B=vec3(.5098,.2204,0.), C=vec3(0.,.0138,0.), D=vec3(-.5098,.2204,0.);
  vec3 E=vec3(-.5098,-.0138,0.), F=vec3(0.,-.2204,0.), G=vec3(.5098,-.0138,0.);
  vec3 H=vec3(-.5098,-.2204,0.), I=vec3(0.,-.4271,0.), J=vec3(.5098,-.2204,0.);
  float d=sg3(p,A,B);
  d=smn(d,sg3(p,B,C),.035); d=smn(d,sg3(p,C,D),.035); d=smn(d,sg3(p,D,A),.035);
  float c1=smn(sg3(p,E,F),sg3(p,F,G),.035), c2=smn(sg3(p,H,I),sg3(p,I,J),.035);
  d=min(d,min(c1,c2));
  float rad=.062+(.006*sin(p.x*14.-t*2.1)+.003*sin(p.x*33.+p.y*9.+t*3.3))*uLqWob*2.;
  d-=rad;
  for(int i=0;i<12;i++){
    float fi=float(i);
    if(fi>=12.*uLqDrops) break;
    vec4 q=drop(fi,t);
    d=smn(d,length(p-q.xyz)-q.w,.012);
  }
  return d*sc;
}
vec3 liqN(vec3 p){
  const vec2 e=vec2(.0015,-.0015);
  return normalize(e.xyy*liq(p+e.xyy)+e.yyx*liq(p+e.yyx)+e.yxy*liq(p+e.yxy)+e.xxx*liq(p+e.xxx));
}
void main(){
  vec3 o, d; float pxw; cam(o,d,pxw,uBExt); o/=uBS; pxw/=uBS;
  float b=dot(o,d), c=dot(o,o)-1., h=b*b-c;
  if(h<=0.){ gl_FragColor=vec4(0.); return; }
  float sh=sqrt(h);
  float cover=clamp(sh/(pxw*2.2),0.,1.);
  vec3 p1=o+d*(-b-sh), p2=o+d*(-b+sh);
  vec3 n1=normalize(p1), n2=normalize(p2);
  float k=.62+.38*sin(uTime*TAU/uBreath);
  // front film: Fresnel reflection, coloured by interference
  float c1=clamp(-dot(d,n1),0.,1.);
  // edge band: wider or narrower (edge width), uneven round the outline (unevenness), stronger colour (edge colour)
  // edge band exactly as the flat badge: Fresnel squeezed into a band of width wf (in outline radii), wf varying round the edge
  float ftb=uTime*uFlow;
  vec3 qn=uRT*n1;
  float bw=fbm3(qn*1.7+vec3(ftb*.035,-ftb*.028,0.))+.35*fbm3(qn*4.1-vec3(ftb*.05,ftb*.04,0.));
  float wf=mix(1.,mix(.14,3.2,smoothstep(.45,.95,bw)),uEdgeVary)*uEdgeW;
  float rS=sqrt(max(1.-c1*c1,0.));
  float rB=clamp(1.-(1.-rS)/max(wf,.01),0.,.9999);
  float F1=.02+.98*pow(1.-sqrt(1.-rB*rB),5.);
  float ct1=sqrt(1.-(1.-c1*c1)/1.77);
  vec3 f1=film(thick(p1),ct1);
  // same light model as the flat badge: a dark, clear middle (film colour only faintly, "film colour in the middle")
  // and the colour carried by the Fresnel edge band; reflections only brighten what the film already shows
  float e1=min(env(reflect(d,n1)),1.65);   // flat badge range: no hard glints in the clear middle
  vec3 col=f1*(uFilmIn*.05+uEdgeCol*2.6*F1)*(.25+uRefl*(e1-.05));
  // the inside of the back wall: a second, upside-down reflection, dimmer (the light crossed the front film twice)
  float c2=clamp(dot(d,n2),0.,1.);
  float rS2=sqrt(max(1.-c2*c2,0.)), rB2=clamp(1.-(1.-rS2)/max(wf,.01),0.,.9999);
  float F2=.02+.98*pow(1.-sqrt(1.-rB2*rB2),5.);
  float ct2=sqrt(1.-(1.-c2*c2)/1.77);
  vec3 f2=film(thick(p2),ct2);
  vec3 back=f2*(uFilmIn*.03+uEdgeCol*1.4*F2)*(.25+uRefl*(min(env(reflect(d,-n2)),1.65)-.05))*.6;
  float tz=(0.-o.z)/d.z; vec2 q0=(o+d*tz).xy;
  // the mark inside: a tube of liquid
  vec3 ro=p1, rdo=d;   // the mark stays upright and facing you: marched in view space, only the bubble's film turns (the owner 11-24)
  float tmax=2.*sh, tt=0., hmin=1e3; bool hit=false;
  // only march where the ray passes the pulse's box
  vec3 bi=1./rdo, t0=(-vec3(.75,.56,.2)-ro)*bi, t1=(vec3(.75,.56,.2)-ro)*bi;
  vec3 tn=min(t0,t1), tf=max(t0,t1);
  float ta=max(max(tn.x,tn.y),max(tn.z,0.)), tb=min(min(tf.x,tf.y),min(tf.z,tmax));
  vec3 inner=vec3(0.);
  if(ta<tb){
    tt=ta;
    for(int i=0;i<48;i++){
      float hh=liq(ro+rdo*tt);
      hmin=min(hmin,hh);
      if(hh<.0007){ hit=true; break; }
      tt+=hh*.9;
      if(tt>tb) break;
    }
  }
  // soft light round the pulse (centre light, breathing), in the bubble's space too
  vec3 ph=ro+rdo*clamp(-ro.z/(abs(rdo.z)>1e-3?rdo.z:1e-3),0.,tmax);
  inner+=glow(ph.xy/.62,k)*.38*smoothstep(.0,.35,abs(rdo.z));
  if(hit){
    // clear water: mostly what is behind it, bent (refraction), dark where the surface turns away (light leaves the
    // other way), the studio on its surface (reflection), a hint of soap-film colour, and a little of the logo's colour
    vec3 pp=ro+rdo*tt, no=liqN(pp), nw=no, pw=pp;
    float ndv=clamp(-dot(nw,d),0.,1.);
    float Fl=.02+.98*pow(1.-ndv,5.);
    vec3 R=reflect(d,nw);
    vec3 rr=normalize(mix(d,refract(d,nw,1./1.33),clamp(uLqRefr*2.,0.,1.)));
    float bb=dot(pw,rr), cc=dot(pw,pw)-1., hb=max(bb*bb-cc,0.);
    vec3 pb=pw+rr*(-bb+sqrt(hb)), nb=normalize(pb);
    float cb=clamp(dot(rr,nb),0.,1.);
    vec3 behind=film(thick(pb),sqrt(1.-(1.-cb*cb)/1.77))*(uFilmIn*.03+uEdgeCol*1.4*(.02+.98*pow(1.-cb,5.)))*.6;
    vec3 ro2=pw, rd2=rr;
    vec3 pg=ro2+rd2*clamp(-ro2.z/(abs(rd2.z)>1e-3?rd2.z:1e-3),0.,2.);
    behind+=glow(pg.xy/.62,k)*.38+min(env(rr),2.)*.05;
    float edge=mix(1.,smoothstep(.05,.55,ndv),clamp(uLqRefr*1.6,0.,1.));
    vec3 trans=behind*(1.-Fl)*edge;
    float spec=(min(env(R),3.)*Fl*1.8+pow(max(dot(R,normalize(vec3(-.45,.55,.7))),0.),120.)*2.4+pow(max(dot(R,normalize(vec3(.6,.35,.72))),0.),400.)*2.)*uLqRefl*2.;
    vec3 fl=film(uThick*.5+220.*nw.y+60.*sin(pp.x*9.+uTime*.4),ndv)*(Fl*2.2+.03)*uLqFilm*1.6;
    vec3 tint=dcol(pp.y/.62)*(.08+.5*pow(ndv,2.))*uLqTint*(.85+.25*k);
    inner=trans+vec3(spec)+fl+tint;
    back=vec3(0.);
  } else {
    inner+=vec3(.8,.9,1.)*exp(-hmin*70.)*.05*uLqRefl;   // a faint glint where a ray only grazes the water
  }
  col+=(back+inner*.95)*(1.-F1);
  // the mark's refraction copies near the rim, as on the flat badge (screen space: p = position on the outline disc, radius 1)
  vec2 pd=q0/1.0142; float rd=length(pd);
  float aa=pxw*1.6/.62;
  float sway=.26*sin(uTime*TAU/uRefrT)+.1*sin(uTime*TAU/(uRefrT*1.45));
  if(uDotRing>0.){
    float wr=smoothstep(.8,.88,rd)*smoothstep(1.,.96,rd);
    if(wr>0.){
      float s=(rd-.8)/.195; float rr=(1.-s)*1.02;
      vec2 dir=-normalize(pd)*rot(sway);
      float cr=mark(dir*rr*1.05,k,aa*3.).r, cg=mark(dir*rr,k,aa*3.).g, cb=mark(dir*rr*.95,k,aa*3.).b;
      col+=vec3(cr,cg,cb)*wr*.3*uDotRing*(.75+.25*k);
    }
  }
  if(uDotRefr>0.){
    for(int j=0;j<2;j++){
      float side=j==0?-1.:1.;
      float a2=(j==0? 3.1416 : 0.) + side*(.16*sin(uTime*TAU/uRefrT+float(j)*1.7)+.06*sin(uTime*TAU/(uRefrT*1.41))) - .1;
      vec2 nrm=vec2(cos(a2),sin(a2)); vec2 tng=vec2(-nrm.y,nrm.x);
      vec2 u=pd-nrm*.8; vec2 lu=vec2(dot(u,tng), dot(u,nrm)*1.9);
      float sz=.19; vec2 qq=-lu/sz;
      float m=smoothstep(1.08,.8,length(qq))*smoothstep(.995,.94,rd);
      if(m>0.){
        float aa3=aa*.62/sz*2.;
        float cr=mark(qq*1.06,k,aa3).r, cg=mark(qq,k,aa3).g, cb=mark(qq*.94,k,aa3).b;
        col+=vec3(cr,cg,cb)*m*uDotRefr*(.7+.3*k);
      }
    }
  }
  // a thin bright rim where the film is seen edge-on
  col+=f1*smoothstep(.25,0.,c1)*.35*uRim/.3;
  col=1.-exp(-col*1.15);
  float a=clamp(max(col.r,max(col.g,col.b))*1.25,.06,1.);
  gl_FragColor=vec4(col*cover,a*cover);
}`;


  // ---- a struck metal medal as a real object: a thick disc with a rounded edge, reeded rim, the icon engraved on the
  // front, the name engraved on the back. Same studio and metal as the flat medal, plus age.
  const MEDAL = COMMON + (root.ACHWearGLSL || 'uniform vec3 uWear; uniform vec4 uAge[4]; vec3 aged(vec3 c,float a,vec2 p,float r,float f,float m,float aa){return c;}') + `
uniform vec3 uMetal; uniform sampler2D uIcon; uniform float uIconOn; uniform sampler2D uBack; uniform float uBackOn; uniform sampler2D uRing; uniform float uRingOn;
uniform float uForm, uIconK;   // the award's outline (0 coin, 1 film reel, 2 film frame, 3 clapperboard, 4 aperture hex, 5 crew pass) and the emblem's size
${ENVS}const float TH=.075, RND=.05;
float sdBox2(vec2 p, vec2 b, float r){ vec2 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
float sdHex2(vec2 p, float r){ const vec3 k=vec3(-.866025404,.5,.577350269); p=abs(p); p-=2.*min(dot(k.xy,p),0.)*k.xy; p-=vec2(clamp(p.x,-k.z*r,k.z*r),r); return length(p)*sign(p.y); }
// the outline in face space: < 0 inside. Every shape fits inside the unit circle (the march's bounding sphere). Holes are real holes.
float sh2(vec2 p){
  if(uForm<.5) return length(p)-1.;
  if(uForm<1.5){   // film reel: a disc with six windows round the hub
    float sec=TAU/6., a=atan(p.y,p.x), an=mod(a+sec*.5,sec)-sec*.5;
    vec2 w=length(p)*vec2(cos(an),sin(an));
    return max(length(p)-1., -(length(w-vec2(.555,0.))-.215));
  }
  if(uForm<2.5){   // a 35 mm film frame: sprocket holes punched along the top and bottom
    vec2 s=vec2(mod(p.x+.08,.16)-.08, abs(p.y)-.45);
    return max(sdBox2(p,vec2(.82,.56),.06), -sdBox2(s,vec2(.045,.04),.016));
  }
  if(uForm<3.5){   // clapperboard: the slate, and its clapper bar a little open on the hinge
    float body=sdBox2(p-vec2(0.,-.2),vec2(.66,.42),.05);
    vec2 H=vec2(-.66,.26), b=rot(.12)*(p-H)+H;
    return min(body, sdBox2(b-vec2(0.,.39),vec2(.66,.13),.04));
  }
  if(uForm<4.5) return sdHex2(rot(PI/6.)*p,.80)-.06;   // aperture: the hexagon the iris blades leave open
  return max(sdBox2(p,vec2(.56,.80),.1), -sdBox2(p-vec2(0.,.64),vec2(.15,.035),.035));   // crew pass: a lanyard slot at the top
}
float sdDisc(vec3 p){ vec2 d=vec2(sh2(p.xy)+RND, abs(p.z)-(TH-RND)); return min(max(d.x,d.y),0.)+length(max(d,0.))-RND; }
float tex(sampler2D s, vec2 p, float k){ vec2 iu=p/k*.5+.5; vec2 c=clamp(iu,.001,.999); float m=step(0.,iu.x)*step(iu.x,1.)*step(0.,iu.y)*step(iu.y,1.); return texture2D(s,vec2(c.x,1.-c.y)).a*m; }   // sampled in every pixel: no early return (that broke the mip choice at the edge: lines)
void main(){
  vec3 ow, dw; float pxw; cam(ow,dw,pxw,1.12);
  vec3 ro=uRT*ow, rd=uRT*dw;
  float b=dot(ro,rd), c=dot(ro,ro)-1.03, h=b*b-c;
  if(h<0.){ gl_FragColor=vec4(0.); return; }
  float t=-b-sqrt(h), tmax=-b+sqrt(h), md=1e3; bool hit=false;
  for(int i=0;i<72;i++){ float dd=sdDisc(ro+rd*t); md=min(md,dd); if(dd<.0004){ hit=true; break; } t+=dd; if(t>tmax) break; }
  if(!hit){ gl_FragColor=vec4(0.); return; }
  vec3 p=ro+rd*t;
  vec2 e=vec2(.0008,0.);
  vec3 n=normalize(vec3(sdDisc(p+e.xyy)-sdDisc(p-e.xyy),sdDisc(p+e.yxy)-sdDisc(p-e.yxy),sdDisc(p+e.yyx)-sdDisc(p-e.yyx)));
  float tt=uTime;
  bool front=n.z>.6, back=n.z<-.6;
  vec2 q=front?p.xy:vec2(-p.x,p.y);                 // face coordinates as you look at that face
  float r=length(q); vec2 rq=r>1e-4?q/r:vec2(1.,0.);
  float RIM=uForm>.5?.88:.83, spin=0., matte=0., rec=0.;   // a narrower bead on the shaped awards
  // distance in from the face's edge (coin: .95 - r) and the outward direction of that edge, for every outline
  float eg=-sh2(q)-RND; vec2 go=rq;
  if(uForm>.5){ const float h2=.004; go=vec2(sh2(q+vec2(h2,0.))-sh2(q-vec2(h2,0.)), sh2(q+vec2(0.,h2))-sh2(q-vec2(0.,h2))); go=length(go)>1e-6?normalize(go):rq; }
  float er=.95-eg;                                 // = r on the coin, so the coin is drawn exactly as before
  // the coin is a lens (the owner 11-24: "uniquely made for this app"): a tick scale just inside the rim, the app's name
  // round the iris like the name ring of a lens, a ribbed grip on the rim and a knurled edge
  bool lens=uForm<.5 && front;
  float la=atan(q.x,q.y), top=step(0.,q.y);
  float lu=top>.5?la/2.792+.5:atan(q.x,-q.y)/1.92+.5;
  float lv=top>.5?(.765-r)/.11:(r-.655)/.11;
  float ink=texture2D(uRing,vec2(clamp(lu,.002,.998),(5.+(1.-top)+.04+clamp(lv,0.,1.)*.92)/8.)).a*uRingOn*step(0.,lu)*step(lu,1.)*step(0.,lv)*step(lv,1.)*(lens?1.:0.);
  float tst=TAU/60., ti=floor(la/tst+.5), tf=abs(la-ti*tst)*r, tmaj=step(abs(mod(ti,5.)),.01);
  float tick=lens?smoothstep(mix(.0045,.007,tmaj)+pxw,mix(.0045,.007,tmaj),tf)*smoothstep(mix(.795,.776,tmaj)-pxw,mix(.795,.776,tmaj)+pxw,r)*smoothstep(.822+pxw,.822-pxw,r):0.;
  ink=max(ink,tick);
  vec3 nq=vec3(0.,0.,1.);                           // normal in face space (z out of that face)
  float aa=pxw*1.2;
  if(front||back){
    if(er>RIM){
      float x=clamp((er-RIM)/(.95-RIM),0.,1.);
      nq=normalize(vec3(-go*cos(x*PI)*1.1,1.));    // the raised, rounded bead (round every edge and every hole)
      if(uForm<.5){ vec2 tg=vec2(-rq.y,rq.x); float ga=atan(q.y,q.x); nq=normalize(nq+vec3(tg*sin(ga*120.)*.32*smoothstep(.35,.55,x)*clamp(2.2-pxw*260.,0.,1.),0.)); rec+=.25*smoothstep(.35,.55,x)*(.5+.5*cos(ga*120.)); }   // the grip
    } else {
      nq=normalize(vec3(q*(uForm>.5?.12:.22),1.));
      float ring=uForm>.5?sin(q.y*900.)*.5+.5:sin(r*900.)*.5+.5;   // coin: spun face; other shapes: brushed straight
      nq=normalize(nq+vec3((uForm>.5?vec2(0.,1.):rq)*(ring-.5)*.012,0.));
      spin=1.;
      rec=smoothstep(RIM-.12,RIM,er)*.3;
    }
    // engraving: the icon on the front, the name on the back. Floor = matte (sandblasted), walls = polished.
    float k=front?uIconK:.92;
    if(er<RIM && ((front && uIconOn>0.) || (back && uBackOn>0.))){
      float dd=1.4*pxw;
      float m=front?tex(uIcon,q,k):tex(uBack,q,k);
      float gx=front?tex(uIcon,q+vec2(dd,0.),k)-tex(uIcon,q-vec2(dd,0.),k):tex(uBack,q+vec2(dd,0.),k)-tex(uBack,q-vec2(dd,0.),k);
      float gy=front?tex(uIcon,q+vec2(0.,dd),k)-tex(uIcon,q-vec2(0.,dd),k):tex(uBack,q+vec2(0.,dd),k)-tex(uBack,q-vec2(0.,dd),k);
      float w=clamp(length(vec2(gx,gy))*1.6,0.,1.);
      nq=normalize(mix(nq,normalize(vec3(vec2(gx,gy)*2.2,1.)),w*.9));
      matte=smoothstep(.15,.85,m)*(1.-w);
      rec+=m;
      if(m>.15) spin=0.;
    }
    if(ink>0.){ matte=max(matte,smoothstep(.1,.8,ink)*.92); rec+=ink; if(ink>.15) spin=0.; }   // engraved like the icon: a matte floor
    rec+=smoothstep(.1,0.,abs(er-RIM))*.8;
  } else {
    // the edge: fine reeding all round
    float ang=atan(p.y,p.x);
    vec3 tg=vec3(-sin(ang),cos(ang),0.);
    if(uForm<.5){ float A=ang*90., Z=p.z*90., s1=sin(A+Z), s2=sin(A-Z), c1=sign(s1)*cos(A+Z), c2=sign(s2)*cos(A-Z); n=normalize(n-(tg*(c1+c2)+vec3(0.,0.,1.)*(c1-c2))*.2); rec=.45-.3*(abs(s1)+abs(s2)-1.); }   // diamond knurl, like a focus ring
    rec=max(rec,.15);
  }
  vec3 nl=(front||back)?(front?nq:vec3(-nq.x,nq.y,-nq.z)):n;   // back: undo the mirror and face -z
  vec3 nw=uR*nl;
  float cv=clamp(-dot(nw,dw),0.,1.);
  vec3 F=uMetal+(1.-uMetal)*pow(1.-cv,5.);
  float en=0.;
  if(spin>.5){
    vec2 bd=uForm>.5?vec2(0.,1.):rq;
    vec3 rw=uR*(front?vec3(bd,0.):vec3(-bd.x,bd.y,0.));
    for(int j=0;j<4;j++){ float o=(float(j)-1.5)/1.5; en+=envS(reflect(dw,normalize(nw+rw*o*.28)),tt); }
    en*=.25*.92;
  } else en=envS(reflect(dw,nw),tt);
  vec3 col=F*en;
  if(matte>0.){ float grain=.85+.3*hash(floor(gl_FragCoord.xy)); col=mix(col,uMetal*(.10+.10*envS(vec3(-.35,.4,.85),tt))*grain,matte); }
  if(front||back){
    col*=1.-.35*smoothstep(RIM-.12,RIM,er)*step(er,RIM);
    col*=1.-smoothstep(aa*1.5,0.,abs(er-RIM))*.7;
  }
  col=aces(col*1.1);
  col=aged(col,1.,(front||back)?q:p.xy,rec,(front||back)?nq.z:mix(.6,1.,smoothstep(0.,.9,p.y/max(length(p.xy),1e-4))),1.,pxw);   // steep walls stay clean; the top of the edge collects dust
  float cover=clamp(-md/pxw+1.,0.,1.);
  gl_FragColor=vec4(col,1.);
}`;

  /* v6 designs in 3D (the owner 11-24: "I wanna see the medals in 3d, full screen"). The housing is a real disc; its faces
     are drawn by the very code that draws the flat badge (gem.js, F_DESIGN), lit by the world as it turns. Diamond and Ruby
     are the real traced brilliant, set in the seat with the girdle under the bezel; turn it over and you see the pavilion
     through the open back. */
  const HOUSE_MAIN = `
uniform float uSeatR;      // 1: a real stone sits in the seat (Diamond, Ruby)
uniform float uHH;         // half the housing's thickness: deep enough that the whole stone sits inside it
#define HH uHH
const float DEP=1.8;                    // relief depth (the owner 11-24: "should feel deeper")
const float HMAX=.06*DEP, HDEP=.035*DEP;
bool gStone(){ return uKind<1.5 && uSeatR>0.; }
float hBead(float r, float r0, float b, float H){ float x=clamp((r-r0)/(1.-r0),0.,1.); return mix(b,0.,smoothstep(.5,1.,x))+H*sqrt(max(sin(PI*x),0.)); }
float hSeat(vec2 q, float g){            // q in seat units: a domed cabochon with the icon cut in; the stones' seat is open
  if(uKind<1.5) return -HDEP;
  float m=uIconOn>0.?icR(q,.80):0.;
  return -.022+.032*sqrt(max(1.-g*g,0.))-.006*m;
}
uniform float uHole;       // Emulsion: the housing is a ring, open inside this radius; the live bubble sits in it
uniform float uPass;       // Emulsion: 1 = only what lies behind the bubble's front, 2 = only what is in front of it
uniform float uLip;        // Diamond, Ruby: the collar's height at the stone (the stone rests on it, its girdle above the face)
float hBez(float g, float g1, float top){ return mix(uLip>0.?uLip:-.015,top,smoothstep(1.,g1,g)); }   // a bezel: down to the seat, or up to the stone as a collar
// ---- the face in real relief (the owner 11-24: "doesn't look 3D"): a height field per design, ray marched
#if DSH==3
float hAny(vec2 p){
  float r=length(p); const float HX=.50;
  if(r>.885) return hBead(r,.885,.03,.025);
  if(r>.835){ float la=atan(p.x,p.y), s6=PI/30., ti=floor(la/s6+.5), tf=abs(la-ti*s6)*r, maj=step(mod(ti,5.),.01), ri=mix(.862,.846,maj);
    return .03-.005*step(tf,.0055)*step(ri,r); }
  float hx=max(max(abs(p.y),abs(dot(p,vec2(.8660254,.5)))),abs(dot(p,vec2(.8660254,-.5))));
  if(hx>HX){ float a=atan(p.y,p.x), f=(a+2.4*(r-.5))/(PI/3.); return .004+.022*fract(f); }   // each leaf rises to the next one's edge: a real step
  const float RH=.465;
  if(hx>RH) return hBez(hx/RH,HX/RH,.004);                // the lip round the hexagonal seat
  return hSeat(p/RH*1.08,hx/RH);
}
#elif DSH==4
float hAny(vec2 p){
  float r=length(p); const vec2 C=vec2(0.,.15); const float A=.52, B=.36;
  if(r>.82) return r>.925?hBead(r,.925,.03,.02):.03;
  if(r>.80) return .03*smoothstep(.80,.82,r);
  vec2 q=p-C; float gR=abs(q.x)/A+abs(q.y)/B;
  if(gR<1.) return hSeat(q/.40,gR);
  if(gR<1.16) return hBez(gR,1.16,.014);
  float w=.042, dl=9.;
  for(int k=0;k<2;k++){
    float y0=C.y-B-.13-float(k)*.17;
    vec2 a0=vec2(-A*.86,y0+.69*A*.86), b0=vec2(0.,y0), c0=vec2(A*.86,y0+.69*A*.86);
    dl=min(dl,min(length(segv(p,a0,b0)),length(segv(p,b0,c0))));
  }
  float x=dl/w; return x<1.?.018*sqrt(1.-x*x):0.;
}
#elif DSH==5
float hAny(vec2 p){
  float r=length(p); const float RS=.46;
  if(r>.90) return hBead(r,.90,0.,.04);
  float a=atan(p.y,p.x), k=floor(a/(PI/6.)+.5);
  vec2 lp=rot(k*PI/6.)*p-vec2(.70,0.);
  float d=sdRBox(lp,vec2(.09),.02);
  if(d<0.){
    float h=-.03*smoothstep(0.,-.016,d);
    if(uKind>1.5){ vec2 m=lp;
      float t1=max(abs(m.x+.022)*1.05+(m.y+.002)*.8-.032,-(m.y+.045)), t2=max(abs(m.x-.030)*1.1+(m.y+.018)*.9-.028,-(m.y+.045)), sn=length(m-vec2(.036,.040))-.014;
      h+=.009*step(min(min(t1,t2),sn),0.); }
    return h;
  }
  if(r<RS) return hSeat(p/RS,r/RS);
  if(r<RS*1.14) return hBez(r/RS,1.14,.008);
  return .008;
}
#elif DSH==6
float hAny(vec2 p){
  float r=length(p); const float RS=.48;
  if(r>.885){
    float la=atan(p.x,p.y), s3=PI/60., ti=floor(la/s3+.5), tf=abs(la-ti*s3)*r, maj=step(mod(ti,5.),.01), ro=mix(.94,.965,maj);
    float h=r>.972?.03*sqrt(max(1.-pow((r-.972)/.028,2.),0.)):.03;
    return h-.004*step(tf,.005)*step(r,ro)*step(.895,r);
  }
  if(r>.86) return mix(-.015,.03,smoothstep(.86,.885,r));
  if(r>.585){
    float la=atan(p.x,p.y), s=PI/24., pi=floor(la/s+.5), pa=abs(la-pi*s)*r;
    float hole=min(sdRBox(vec2(pa,r-.62),vec2(.013,.011),.004),sdRBox(vec2(pa,r-.825),vec2(.013,.011),.004));
    return hole<0.?-.026:-.015;
  }
  if(r>.56) return mix(.012,-.015,smoothstep(.56,.585,r));
  if(r<RS) return hSeat(p/RS,r/RS);
  return hBez(r/RS,.56/RS,.012);
}
#else
float hAny(vec2 p){
  float r=length(p); const float RS=.31, EA=.78, EB=.40;
  if(r<RS) return hSeat(p/RS,r/RS);
  if(r<RS*1.16) return hBez(r/RS,1.16,.012);
  if(r>.90) return hBead(r,.90,0.,.04);
  float bd=9.;
  for(int i=0;i<3;i++){
    float ang=PI*.5+float(i)*2.0944; vec2 q=rot(ang)*p;
    vec2 qa=q/vec2(EA,EB); float l=length(qa); vec2 gr=q/vec2(EA*EA,EB*EB)/max(l,1e-4);
    bd=min(bd,abs((l-1.)/max(length(gr),1e-4)));
  }
  float x=bd/.032, h=x<1.?.02*sqrt(1.-x*x):0.;
  for(int i=0;i<3;i++){
    float ang=PI*.5+float(i)*2.0944; vec2 dq=(p-vec2(cos(ang),sin(ang))*EA)/.075; float dd=dot(dq,dq);
    if(dd<1.) h=max(h,.045*sqrt(1.-dd));
  }
  return h;
}
#endif
#ifndef NO_STONE
// ---- the stone: any convex outline (the seat's own shape: hexagon, lozenge, round), cut as a brilliant. Its planes come from
// page code (stoneGeo) in the housing's own space: uPl[0..uNG) the girdle, then table, crown and pavilion. Fewer planes than
// the old round brilliant, and it fills the seat exactly. uSB: a sphere round it (centre, radius) to skip the rest of the medal.
uniform vec4 uPl[64]; uniform float uNG, uNP; uniform vec4 uSB;
void trav(vec3 o, vec3 d, out float tIn, out vec3 nIn, out float tOut, out vec3 nOut){
  tIn=-1e9; tOut=1e9; nIn=vec3(0.,0.,1.); nOut=nIn;
  for(int i=0;i<64;i++){
    if(float(i)>=uNP) break;
    vec4 pl=uPl[i]; float dn=dot(pl.xyz,d), tt=(pl.w-dot(pl.xyz,o))/dn;
    if(dn<0.){ if(tt>tIn){ tIn=tt; nIn=pl.xyz; } } else if(tt<tOut){ tOut=tt; nOut=pl.xyz; }
  }
}
float inSeat(vec2 p){ float m=-1e9; for(int i=0;i<16;i++){ if(float(i)>=uNG) break; m=max(m,dot(uPl[i].xy,p)-uPl[i].w); } return m; }   // < 0: inside the stone's outline
float envG(vec3 d){
  float az=atan(d.y,d.x);
  float s=.03+.45*smoothstep(-.1,.9,d.z);
  s+=1.1*pow(max(cos(az*3.)*.5+.5,0.),5.)*smoothstep(-.2,.5,d.z)*smoothstep(.98,.75,d.z);
  s+=pow(max(dot(d,normalize(vec3(.55,.55,.63))),0.),140.)*8.;
  s+=pow(max(dot(d,normalize(vec3(-.72,.25,.64))),0.),100.)*5.;
  s+=pow(max(dot(d,normalize(vec3(.05,-.78,.62))),0.),180.)*7.;
  s+=pow(max(dot(d,normalize(vec3(.3,.1,-.95))),0.),30.)*1.2;
  s+=1.5*smoothstep(.72,.9,d.z)*smoothstep(.99,.95,d.z)*(.75+.25*cos(az*8.));
  // crisp studio panels (the owner 11-24: face on, the stones looked flat): two rings of light boxes with dark gaps, so each
  // facet catches a hard edge of light or dark and the pattern breaks up as the stone turns
  float pa=fract(az*1.9099+.25), pb=fract(az*1.9099+.75);
  s+=1.6*smoothstep(0.,.05,pa)*smoothstep(.6,.55,pa)*smoothstep(.30,.34,d.z)*smoothstep(.62,.58,d.z);
  s+=2.2*smoothstep(0.,.05,pb)*smoothstep(.45,.40,pb)*smoothstep(.70,.73,d.z)*smoothstep(.88,.85,d.z);
  s*=1.-.6*smoothstep(.88,.97,d.z);                 // the viewer's own head blocks the light straight above: the dark arrows face on
  // a room full of small lights: each a few degrees across, so inside one facet the view drifts across them and a facet is
  // never one flat colour; as the stone turns they flash on and off (scintillation). One hash, no noise: cheap.
  vec3 q=d*26.; float h=fract(sin(dot(floor(q),vec3(12.9898,78.233,37.719)))*43758.5453);
  s+=step(.80,h)*pow(max(0.,1.-length(fract(q)-.5)*2.3),2.)*smoothstep(-.1,.45,d.z)*(2.+6.*fract(h*17.));
  return s;
}
float fres(float c, float ior){ float F0=pow((ior-1.)/(ior+1.),2.); return F0+(1.-F0)*pow(1.-clamp(c,0.,1.),5.); }
// light leaving the stone: down into the housing it meets the polished cup and bounces back up (a set stone is lit from its
// seat; without this every pavilion exit saw black and the Diamond read as a black stone)
float envO(vec3 v){ float k=1.; if(v.z<0.){ v.z=-v.z; k=.8; } return envG(uR*v)*k+(1.-k)*.6; }
#endif
// the housing: a disc of radius 1, faces at z = +-HH. Returns t; side: 1 front, -1 back, 2 edge, 0 miss
float slab(vec3 o, vec3 d, out float side){
  float bt=1e9; side=0.; float h2=uHole*uHole;
  if(abs(d.z)>1e-6){
    float t1=(HH-o.z)/d.z; vec2 q1=o.xy+d.xy*t1; float r1=dot(q1,q1); if(d.z<0. && t1>0. && r1<1. && r1>=h2){ bt=t1; side=1.; }
    float t2=(-HH-o.z)/d.z; vec2 q2=o.xy+d.xy*t2; float r2=dot(q2,q2); if(d.z>0. && t2>0. && t2<bt && r2<1. && r2>=h2){ bt=t2; side=-1.; }
  }
  float A=dot(d.xy,d.xy);
  if(A>1e-7){ float B=dot(o.xy,d.xy), C=dot(o.xy,o.xy)-1., h=B*B-A*C; if(h>=0.){ float t=(-B-sqrt(h))/A; float z=o.z+d.z*t; if(t>0. && t<bt && abs(z)<HH){ bt=t; side=2.; } }
    if(uHole>0.){ float Ci=dot(o.xy,o.xy)-h2, hi=B*B-A*Ci; if(hi>=0.){ float t=(-B+sqrt(hi))/A; float z=o.z+d.z*t; if(t>0. && t<bt && abs(z)<HH){ bt=t; side=3.; } } }   // the ring's inner wall
  }
  return bt;
}
float hF(vec2 p, float hk){ return dot(p,p)<uHole*uHole?-9.:max(hAny(p)*hk,-HDEP); }   // the face's height (none over the ring's hole)
vec3 rayD(vec2 fc, float ext){ float S=min(uRes.x,uRes.y); return normalize(vec3((fc-.5*uRes)/(.5*S)*ext,-6.)); }
vec4 face(vec2 q, float r, float aa, float t){ return dAny(q,r,aa,t); }   // one design per program (DSH)
// the back: spun metal, the certificate engraved across all of it (closed: nothing shows through)
vec4 backFace(vec2 q, float r, float aa, float t){
  vec3 base=dBase(), v=gV; vec2 rq=r>1e-4?q/r:vec2(1.,0.);
  vec3 col; gRec=.15;
  if(r>.90) col=dLit(dBead(rq,r,.90),base,v,t,0.,rq);
  else {
    col=dLit(vec3(rq*.05,1.),base,v,t,.25,rq);
    vec2 iu=q/.92*.5+.5; vec2 c=clamp(iu,.001,.999);
    float m=texture2D(uDet,vec2(c.x,1.-c.y)).a*uDetOn*step(abs(q.x),.92)*step(abs(q.y),.92);
    col=mix(col,dFloor(base,t),m*.9); gRec=.2+m;
  }
  return dDone(col,r,aa,vec4(0.));
}
void main(){
  const float EXT=1.22;
  float S=min(uRes.x,uRes.y);
  vec3 ow=vec3(0.,0.,6.), dw=rayD(gl_FragCoord.xy,EXT); float pxw=2.*EXT/S;
  vec3 o=uRT*ow, d=uRT*dw;
  float b0=dot(o,d), h0=b0*b0-dot(o,o)+1.12;          // everything fits a sphere of r 1.06
  if(h0<0.){ gl_FragColor=vec4(0.); return; }
  float t=uTime, aa=pxw*1.3;
  float side; float bt=slab(o,d,side); vec3 sd=d;
  // the front face in relief: real geometry at every angle (the owner 11-25: "do not fake things"; it used to flatten the relief
  // when turned edge on, so the middle read as a painted normal map). The ray is marched through the relief's own slab, from
  // above or from below the face plane, so seen edge on the raised parts stand up in silhouette and the hollows sink.
  float hk=DEP;
#ifdef NOREL
  hk=0.;
#endif
  if(abs(d.z)>1e-5 && hk>0.){
    float z1=(HH+HMAX*hk-o.z)/d.z, z2=(HH-HDEP-o.z)/d.z, tA=min(z1,z2), tB=max(z1,z2);
    float A=dot(d.xy,d.xy), B=dot(o.xy,d.xy), C=dot(o.xy,o.xy)-1., hc=B*B-A*C;
    if(A>1e-7){ if(hc>0.){ float sq=sqrt(hc); tA=max(tA,(-B-sq)/A); tB=min(tB,(-B+sq)/A); } else tB=-1.; }
    if(side==-1. || side>1.5) tB=min(tB,bt);           // the back or the edge got there first
    tA=max(tA,0.);
    vec3 p0=o+d*tA;
    if(tB>tA && p0.z-HH-hF(p0.xy,hk)>0.){              // starts above the surface (below it: the ray came in through the edge)
      float N=clamp(floor(6.+(tB-tA)*length(d.xy)/.009),6.,80.), dt=(tB-tA)/N, lo=tA, hi=-1.;   // face on: few steps; edge on: many
      for(int i=1;i<=80;i++){ if(float(i)>N) break; float tt=tA+dt*float(i); vec3 pp=o+d*tt; if(pp.z-HH-hF(pp.xy,hk)<=1e-5){ hi=tt; lo=tt-dt; break; } }
      if(hi>0.){
        for(int k=0;k<6;k++){ float m=.5*(lo+hi); vec3 pm=o+d*m; if(pm.z-HH-hF(pm.xy,hk)<=0.) hi=m; else lo=m; }
        bt=hi; side=1.; sd=d;
      } else if(side>.5 && side<1.5) side=0.;          // over a hollow at the rim's edge: no face here after all
    }
  }
  vec3 hp=o+sd*bt;
  // the outline: four more rays, only where an outline can be (the rim, the edge, the background)
  float hits=side!=0.?1.:0.;
  if(side==0. || side>1.5 || dot(hp.xy,hp.xy)>.93 || (uHole>0. && dot(hp.xy,hp.xy)<(uHole+.04)*(uHole+.04))){
    for(int i=0;i<4;i++){
      float fi=float(i); vec2 of=vec2(mod(fi*3.,4.)-1.5,fi-1.5)*.25;
      vec3 di=uRT*rayD(gl_FragCoord.xy+of,EXT); float s2; float t2=slab(o,di,s2);
      if(s2!=0.){ hits+=1.; if(side==0.){ bt=t2; side=s2; sd=di; hp=o+sd*bt; } }
    }
  } else hits=5.;
  if(uPass>.5){                                         // Emulsion: the bubble is drawn between the two passes
    float bS=dot(o,d), hS=bS*bS-dot(o,o)+uHole*uHole, tS=hS>0.?-bS-sqrt(hS):1e9;
    bool behind=side!=0. && bt>tS;
    if(side==0. || (uPass<1.5)!=behind){ gl_FragColor=vec4(0.); return; }
  }
  vec4 Hc=vec4(0.);
  vec2 agP=hp.xy, agP2=hp.xy; float agW=1., agR=.15, agF=1., agM=1., agA=aa, holeF=0.;
  if(side!=0.){
    if(side>2.5){                                       // Emulsion: the ring's inner wall, polished
      vec2 rq=normalize(hp.xy); vec3 n=vec3(-rq,0.);
      gF=mat3(1.); gV=-sd;
      Hc=vec4(aces(dLit(n,dBase(),gV,t,0.,vec2(-rq.y,rq.x))*.95),1.);
      gNoWeb=1.; agR=.4; agF=.5;
    } else if(side>1.5){                                       // the edge: fine reeding
      float ang=atan(hp.y,hp.x); vec2 rq=normalize(hp.xy), tg=vec2(-rq.y,rq.x);
      vec3 n=normalize(vec3(rq+tg*sin(ang*180.)*.15*clamp(1.6-pxw*60.,0.,1.),0.));   // the reeds fade out before they would shimmer
      gF=mat3(1.); gV=-sd;
      Hc=vec4(aces(dLit(n,dBase(),gV,t,0.,tg)*1.1),1.);
      // dust on the edge (the owner 11-24: "follow front to side to back, seamless"): the face's own dust map, unfolded over the
      // rim at true scale. From the front corner it carries on outward (front + edge = one flat sheet, no seam), from the back
      // corner the back's map does the same; the two meet in a soft band in the middle of the edge.
      agP=rq*(1.+HH-hp.z); agP2=vec2(-rq.x,rq.y)*(1.+HH+hp.z); agW=smoothstep(-.3*HH,.3*HH,hp.z);
      gNoWeb=1.; agR=.3; agF=mix(.55,1.,smoothstep(-.3,.7,rq.y));   // the edge's upper side catches dust like the face; its sides and underside shed it
       agA=aa/max(abs(dot(rq,sd.xy)),.035);
    } else if(side>0.){
      gF=mat3(1.); gV=-sd;
      vec2 q=hp.xy; float r=length(q); float aF=aa/max(-sd.z,.035);
      float ins=1.;
#ifndef NO_STONE
      if(gStone()) ins=inSeat(q);
#endif
      if(ins<-aF*2.){ Hc=vec4(aces(dBase()*.2),1.); holeF=1.; }   // deep in the seat: the stone covers it, skip the face's work
      else {
      Hc=face(q,r,aF,t);
      if(hk>.02){                                       // the real slope: walls lit as walls, hollows shaded by what stands round them
        float e=.004, h0=hAny(q)*hk;
        vec3 nH=normalize(vec3(-(hAny(q+vec2(e,0.))*hk-h0),-(hAny(q+vec2(0.,e))*hk-h0),e));
        float wall=smoothstep(.8,.35,nH.z);
        if(wall>0.){ vec3 wc=aces(dLit(nH,dBase(),gV,t,0.,normalize(nH.xy+1e-5))*1.1)*.85; Hc.rgb=mix(Hc.rgb,wc*Hc.a,wall); }
        float k2=.028, oc=max(hAny(q+vec2(k2,0.))*hk-h0,0.)+max(hAny(q-vec2(k2,0.))*hk-h0,0.)+max(hAny(q+vec2(0.,k2))*hk-h0,0.)+max(hAny(q-vec2(0.,k2))*hk-h0,0.);
        Hc.rgb*=1.-clamp(oc*9.,0.,.55);
        gAgN=nH; gAgAO=1.-clamp(oc*7.,0.,.5); agF=mix(1.,nH.z,.8);   // the dust lies on the real relief: shaded by it, thin on its walls
      }
      agP=q; agR=gRec; agA=aF; gAgV=-sd; gAgL=uRT*normalize(vec3(.55,.55,.63));
      holeF=1.-smoothstep(-aF*1.5,0.,ins);              // the seat is open: the stone fills it
      }
    } else {
      gF=mat3(1.,0.,0., 0.,-1.,0., 0.,0.,-1.); gV=gF*(-sd);
      vec2 q=vec2(hp.x,-hp.y); float r=length(q); float aF=aa/max(sd.z,.035);   // reads the right way up after the click turn (about the horizontal)
      Hc=backFace(q,r,aF,t);
      agP=vec2(-hp.x,hp.y); gAgV=vec3(sd.x,-sd.y,sd.z); { vec3 lo=uRT*normalize(vec3(.55,.55,.63)); gAgL=vec3(-lo.x,lo.y,-lo.z); }                             // the back's dust: its own pattern, settled with real gravity (+y up), like the face's agR=gRec; agA=aF;
    }
    Hc*=hits*.2;
  }
  vec4 F=Hc;
#ifndef NO_STONE
  if(gStone()){
    vec4 Hcup=vec4(Hc.rgb*(1.-holeF*.78),Hc.a);    // where a ray in the seat misses the stone: the dark polished cup
    Hc*=1.-holeF;                                  // the seat itself never hides the stone
    F=Hcup;
    vec3 oc=o-uSB.xyz; float bs=dot(oc,d), hs=bs*bs-dot(oc,oc)+uSB.w*uSB.w;
    if(hs>0.){
      float tIn, tOut; vec3 nIn, nOut;
      trav(o,d,tIn,nIn,tOut,nOut);
      if(tIn<tOut && tOut>0. && !(Hc.a>.01 && tIn>=bt)){
        float cover=clamp((tOut-tIn)/(pxw*2.5),0.,1.);
        bool ruby=uKind>.5;
        float ior=ruby?1.77:2.417;
        vec3 iorC=ruby?vec3(1.762,1.77,1.778):vec3(2.37,2.417,2.47);
        vec3 absorb=(ruby?vec3(.12,3.4,2.7):vec3(.004,.006,.01))/max(uSB.w,.2)*.5;
        vec3 p=o+d*tIn;
        float Fr=fres(-dot(d,nIn),ior);
        vec3 sc=vec3(Fr*envG(uR*reflect(d,nIn)))*.8;
        vec3 di=refract(d,nIn,1./ior); vec3 thr=vec3(1.-Fr);
#ifndef NB
#define NB 5
#endif
        for(int b=0;b<NB;b++){
          float a1,a2; vec3 n1,n2;
          trav(p+di*1e-4,di,a1,n1,a2,n2);
          float L=max(a2,0.);
          thr*=exp(-absorb*L); p=p+di*L;
          vec3 outM=refract(di,-n2,ior);
          if(dot(outM,outM)<1e-4){ di=reflect(di,n2); continue; }
          if(n2.z<-.2){ thr*=ruby?vec3(.9,.8,.8):vec3(.94); di=reflect(di,n2); continue; }   // the Ruby's back is foiled (closed setting): its shallow pavilion would leak the light out
                                                                               // (a window), so face on it read as one flat pink star
          float Fo=fres(dot(di,n2),ior); vec3 e;
          e=vec3(envO(outM));
          if(b<2){ vec3 oR=refract(di,-n2,iorC.r), oB=refract(di,-n2,iorC.b); e.r=dot(oR,oR)>1e-4?envO(oR):e.g*.5; e.b=dot(oB,oB)>1e-4?envO(oB):e.g*.5; }   // fire on the first two exits; later ones are faint
          sc+=thr*(1.-Fo)*e; thr*=Fo; di=reflect(di,n2);
        }
        sc+=thr*.04;
        if(ruby){ sc*=vec3(1.,.55,.6); sc+=vec3(.16,.005,.025)+vec3(.5,.02,.06)*pow(.5+.5*sin(uTime*.8+dot(nIn,vec3(3.1,1.7,2.3))*4.),3.)*.35; sc=pow(sc,vec3(1.15)); }
        else sc=pow(sc,vec3(1.3))*1.7+.03;                // a set brilliant reads white with dark facet lines, never a black stone
        sc=1.-exp(-max(sc,0.)*1.6);
        F=vec4(sc*cover,cover)+Hcup*(1.-cover);
        if(cover>.5){ gNoWeb=0.; vec3 pe=o+d*tIn; float de=-inSeat(pe.xy); agP=pe.xy; agR=smoothstep(.06,.01,de)*.7; agF=1.; agM=0.; agA=aa; }   // dust gathers where the stone meets the bezel
      }
    }
  }
#endif
  // dust and cobwebs, on whatever is in front: once per pixel (twice only in the edge's middle band, one call site)
  vec3 Fa=vec3(0.);
  for(int i=0;i<2;i++){ float w=i==0?agW:1.-agW; if(w>.001) Fa+=aged(F.rgb,F.a,i==0?agP:agP2,agR,agF,agM,agA)*w; }
  F.rgb=Fa;
  gl_FragColor=F;
}`;
  const HOUSE = (key) => { const [, sh, st] = String(key || 'house|3|1').split('|'); return 'precision highp float;\nuniform mat3 uR; uniform mat3 uRT;\nmat3 gF=mat3(1.);\n#define ENV_ROT(d) (uR*(gF*(d)))\n#define F_DESIGN\n#define NO_MAIN\n#define NO_FLAT_SEAT\n#define WEB_TEX\n#define DSH ' + sh + '\n' + (st === '1' ? '' : '#define NO_BRILL\n#define NO_STONE\n') + (root.__achDef || '') + 'uniform float uSeatR;\n' + (root.ACHGemFS || '') + HOUSE_MAIN.replace('uniform float uSeatR;', ''); };
  /* Emulsion's housing: open inside its outer ring, the bubble sits there (the owner 11-24: "keep the bubble inside the green area") */
  const HOLE = { iris: .835, layers: .80, sheet: .88, reel: .86, orbit: .88 };
  root.ACHHole = HOLE;
  const HSHAPE = { iris: [3], layers: [4], sheet: [5], reel: [6], orbit: [7] };
  /* The stone for each housing: the seat's own outline (edge normals, distance from the centre), cut as a brilliant, and the
     housing's thickness from it: deep enough that the whole stone, culet and all, sits inside (the owner 11-24: no bulge on the
     back, no stone showing there, the back's text clear). Planes in the housing's space: [nx, ny, nz, w] with n.p <= w inside. */
  const SEATS = {
    iris: { C: [0, 0], ed: Array.from({ length: 6 }, (_, k) => [(30 + 60 * k) * D2R, .47]) },
    layers: (() => { const A = .52 * 1.01, B = .36 * 1.01, L = Math.hypot(A, B), ap = A * B / L; const a0 = Math.atan2(A, B); return { C: [0, .15], ed: [[a0, ap], [Math.PI - a0, ap], [Math.PI + a0, ap], [-a0, ap]] }; })(),
    sheet: { C: [0, 0], ed: Array.from({ length: 8 }, (_, k) => [(22.5 * (2 * k + 1)) * D2R, .465]) },   // round seat: an octagon whose corners tuck under the bezel
    reel: { C: [0, 0], ed: Array.from({ length: 8 }, (_, k) => [(22.5 * (2 * k + 1)) * D2R, .485]) },   // round seat: an octagon whose corners tuck under the bezel
    orbit: { C: [0, 0], ed: Array.from({ length: 8 }, (_, k) => [(22.5 * (2 * k + 1)) * D2R, .315]) },   // round seat: an octagon whose corners tuck under the bezel
  };
  const GEO = {};
  function stoneGeo(shape) {
    if (GEO[shape]) return GEO[shape];
    const S = SEATS[shape] || SEATS.iris, N = S.ed.length, [cx, cy] = S.C;
    const n = S.ed.map(([a]) => [Math.cos(a), Math.sin(a)]), c = S.ed.map(([, w]) => w);
    const ap = Math.min(...c), tc = Math.tan(30 * D2R), tp = Math.tan(27 * D2R), gtk = .018 * ap;
    /* the owner 11-24: the housing a third thinner, the stone pushed out. The girdle rises just above the face, the crown stands
       proud of it, and the culet still stops short of the back (nothing shows there, the text stays clear) */
    const HH = .65 * Math.max(.10, (.056 + gtk + Math.tan(31 * D2R) * ap) / 2);
    const zg = Math.max(HH + .012, -HH + .012 + gtk + tp * ap), gt = zg + gtk, gb = zg - gtk;
    const V = n.map((nk, k) => { const nj = n[(k + 1) % N], det = nk[0] * nj[1] - nk[1] * nj[0]; return [(c[k] * nj[1] - c[(k + 1) % N] * nk[1]) / det, (nk[0] * c[(k + 1) % N] - nj[0] * c[k]) / det]; });
    const P = [];
    const plane = (nx, ny, nz, px, py, pz) => { const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; P.push(nx, ny, nz, nx * px + ny * py + nz * pz); };
    n.forEach((nk, k) => plane(nk[0], nk[1], 0, cx + nk[0] * c[k], cy + nk[1] * c[k], 0));                 // girdle
    plane(0, 0, 1, 0, 0, gt + tc * ap * .44);                                                              // table
    const sA = Math.sin(Math.atan(tc)), cA = Math.cos(Math.atan(tc)), sP = Math.sin(Math.atan(tp)), cP = Math.cos(Math.atan(tp));
    n.forEach((nk, k) => {
      const fx = cx + nk[0] * c[k], fy = cy + nk[1] * c[k];
      plane(nk[0] * sA, nk[1] * sA, cA, fx, fy, gt);                                                       // crown, on each side
      plane(nk[0] * sP, nk[1] * sP, -cP, fx, fy, gb);                                                      // pavilion, on each side
      const nj = n[(k + 1) % N]; let mx = nk[0] + nj[0], my = nk[1] + nj[1]; const ml = Math.hypot(mx, my); mx /= ml; my /= ml;
      const cf = nk[0] * mx + nk[1] * my, a2 = Math.atan(.82 * tc * cf), p2 = Math.atan(.82 * tp * cf);
      plane(mx * Math.sin(a2), my * Math.sin(a2), Math.cos(a2), cx + V[k][0], cy + V[k][1], gt);           // crown, at each corner
      plane(mx * Math.sin(p2), my * Math.sin(p2), -Math.cos(p2), cx + V[k][0], cy + V[k][1], gb);          // pavilion, at each corner
    });
    const vr = Math.max(...V.map((v) => Math.hypot(v[0], v[1]))), R = Math.max(Math.hypot(vr, gtk), tc * ap * .44 + gtk, tp * ap + gtk) + .01;
    return (GEO[shape] = { pl: new Float32Array(P), ng: N, np: P.length / 4, HH, lip: Math.max(0, gb - HH - .004) / 1.8, sb: [cx, cy, zg, R] });   // lip /1.8: the relief's DEP
  }
  const LOOK3 = { lqRefr: 'uLqRefr', lqRefl: 'uLqRefl', lqFilm: 'uLqFilm', lqTint: 'uLqTint', lqWobble: 'uLqWob', lqDrops: 'uLqDrops', lqDropSize: 'uLqDropS', lqMove: 'uLqMove', dotRefr: 'uDotRefr', dotRing: 'uDotRing', refrPeriod: 'uRefrT', edgeWidth: 'uEdgeW', edgeVary: 'uEdgeVary', edgeColour: 'uEdgeCol', rimLine: 'uRim', saturation: 'uSat', filmInside: 'uFilmIn', filmThick: 'uThick', flowSpeed: 'uFlow', reflection: 'uRefl', glow: 'uGlow', breath: 'uBreath', motionAmt: 'uMotAmt', motionTime: 'uMotT' };
  let cv = null, gl = null, progs = {}, cur = null, raf = 0, t0 = 0, kind = 'dia', R = [1, 0, 0, 0, 1, 0, 0, 0, 1], dirty = true, still = false, wear = [0, 0], opt = {}, texI = null, texB = null, texL = null;
  /* Speed (the owner 11-24: no lags or freezes). One WebGL context lives for the whole page on an OffscreenCanvas; it is never
     lost between medals. Each program compiles once (in the background with KHR_parallel_shader_compile, warmed up when the page
     is idle), textures are cached, and each frame goes to the visible canvas through 'bitmaprenderer' (no read-back).
     Browsers without OffscreenCanvas use the old path: a context per canvas. */
  let oc = null, ogl = null, par = null, tgt = null, persist = false, pend = null, tok = 0;
  /* Resolution follows the machine: when frames take too long (a weak GPU, a big window), the medal is drawn at fewer pixels
     and the canvas scales it up; when there is time again, it climbs back. Kept between medals, so it does not re-learn. */
  let ds = 1, ema = 16, lastT = 0, slowT = 0, fastT = 0;
  function pace(now) {
    if (lastT && !still && persist) {
      const d = Math.min(200, now - lastT);
      ema = ema * .9 + d * .1;
      if (ema > 24) { slowT += d; fastT = 0; if (slowT > 250 && ds > .5) { ds = Math.max(.5, ds * .82); slowT = 0; } }
      else if (ema < 15) { fastT += d; slowT = 0; if (fastT > 2500 && ds < 1) { ds = Math.min(1, ds / .85); fastT = 0; } }
      else { slowT = fastT = 0; }
    }
    lastT = now;
  }
  const PC = {}, TEX = new Map();
  /* The cobweb for the 3D housing, baked (speed, the owner 11-24 "still lags"): it depends only on where it is on the disc, so it is
     drawn once into a 1024 px texture (and again when the medal ages or is polished), not traced every frame for every pixel. */
  const WEB_MAIN = `
void main(){
  vec2 p=gl_FragCoord.xy/uRes*2.-1.;
  wS=uWear.y; wC=2.175+(wS-.5)*2.;
  gl_FragColor=wWeb(p,uWear.z*uAge[1].z,min(uWear.x,1.),2.6/uRes.x);
}`;
  const WEB = { key: '', tex: null, fb: null, none: null, g: null };
  function webTex(g) {
    if (WEB.g !== g) { WEB.g = g; WEB.tex = WEB.fb = WEB.none = null; WEB.key = ''; }
    if (!WEB.none) { WEB.none = g.createTexture(); g.bindTexture(g.TEXTURE_2D, WEB.none); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4)); }
    const av = root.ACHAgeVec ? Array.from(root.ACHAgeVec()) : [];
    if (!(wear[2] > 0) || !av.length) return WEB.none;              // no cobweb yet
    const key = wear.map((x) => (+x || 0).toFixed(4)).join() + '|' + av.map((x) => (+x).toFixed(3)).join();
    if (key === WEB.key && WEB.tex) return WEB.tex;
    const e = queue(g, 'webbake'), P = finish(g, e);
    if (!P) { scheduleWeb(); return WEB.key && WEB.tex ? WEB.tex : WEB.none; }   // still compiling: the old web (or none) for now
    const N = 1024;
    if (!WEB.tex) {
      WEB.tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, WEB.tex);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, N, N, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      WEB.fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, WEB.fb);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, WEB.tex, 0);
    } else g.bindFramebuffer(g.FRAMEBUFFER, WEB.fb);
    g.viewport(0, 0, N, N); g.useProgram(P.p);
    g.uniform2f(P.U.uRes, N, N); if (P.U.uWear) g.uniform3f(P.U.uWear, wear[0], wear[1], wear[2] || 0); if (P.U.uAge) g.uniform4fv(P.U.uAge, av);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    // mipmaps + anisotropic filtering: seen at a low angle the web no longer breaks into steps (the owner 11-24)
    g.bindTexture(g.TEXTURE_2D, WEB.tex); g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    const an = g.getExtension('EXT_texture_filter_anisotropic'); if (an) g.texParameterf(g.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    WEB.key = key; return WEB.tex;
  }
  let webT = 0;
  function scheduleWeb() { if (webT) return; webT = setTimeout(() => { webT = 0; dirty = true; }, 150); }   // look again once it has compiled
  const SRC = { bubble: () => BUBBLE, medal: () => MEDAL, gem: () => GEM, house: HOUSE };
  const progKey = (k, o) => (k === 'bubble' ? 'bubble' : k === 'medal' ? 'medal' : k === 'house' ? 'house|' + ((HSHAPE[o && o.shape] || HSHAPE.iris)[0]) + '|' + (o && (o.tier === 5 || o.tier === 6) ? 1 : 0) : 'gem');
  const UNI = ['uRes', 'uTime', 'uR', 'uRT', 'uKind', 'uWear', 'uAge', 'uMetal', 'uIcon', 'uIconOn', 'uBack', 'uBackOn', 'uForm', 'uIconK', 'uLens', 'uLensOn', 'uRing', 'uRingOn', 'uShape', 'uPx', 'uSeed', 'uTilt', 'uDet', 'uDetOn', 'uSeatR', 'uHH', 'uLip', 'uHole', 'uPass', 'uBExt', 'uBS', 'uPl[0]', 'uNG', 'uNP', 'uSB', 'uWebT'];
  function ensure() {
    if (ogl && !ogl.isContextLost()) return ogl;
    ogl = null; for (const k in PC) delete PC[k]; TEX.clear();
    if (typeof OffscreenCanvas === 'undefined') return null;
    try { oc = new OffscreenCanvas(256, 256); ogl = oc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }); } catch (e) { ogl = null; }
    if (!ogl) return null;
    par = ogl.getExtension('KHR_parallel_shader_compile');
    const buf = ogl.createBuffer(); ogl.bindBuffer(ogl.ARRAY_BUFFER, buf);
    ogl.bufferData(ogl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ogl.STATIC_DRAW);
    ogl.enableVertexAttribArray(0); ogl.vertexAttribPointer(0, 2, ogl.FLOAT, false, 0, 0);
    return ogl;
  }
  /** Compile and link without waiting (no status query here: that is what blocks). */
  function queue(g, key) {
    if (PC[key]) return PC[key];
    const sh = (type, src) => { const x = g.createShader(type); g.shaderSource(x, src); g.compileShader(x); return x; };
    const v = sh(g.VERTEX_SHADER, VS), f = sh(g.FRAGMENT_SHADER, key.slice(0, 5) === 'house' ? HOUSE(key) : key === 'webbake' ? 'precision highp float;\n#define F_DESIGN\n#define NO_MAIN\n#define NO_BRILL\n#define DSH 3\n' + (root.ACHGemFS || '') + WEB_MAIN : SRC[key]());
    const p = g.createProgram(); g.attachShader(p, v); g.attachShader(p, f); g.bindAttribLocation(p, 0, 'a'); g.linkProgram(p);
    return (PC[key] = { p, v, f, ready: false, bad: false });
  }
  const done = (g, e) => !par || g.getProgramParameter(e.p, par.COMPLETION_STATUS_KHR);
  /** The program, once linked: uniform locations read once. null while the browser is still compiling it. */
  function finish(g, e) {
    if (e.ready || e.bad) return e.bad ? null : e;
    if (!done(g, e)) return null;
    if (!g.getProgramParameter(e.p, g.LINK_STATUS)) { console.info('[ACH] 3d shader:', g.getShaderInfoLog(e.f) || g.getProgramInfoLog(e.p)); e.bad = true; return null; }
    e.U = {}; for (const k of UNI) e.U[k] = g.getUniformLocation(e.p, k);
    e.L = {}; for (const k in LOOK3) e.L[k] = g.getUniformLocation(e.p, LOOK3[k]);
    e.ready = true; return e;
  }
  /** Warm-up: queue all three programs when the page is idle, so the first full view opens without a compile stall. */
  function warm() {
    const idle = root.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => { const g = ensure(); if (!g) return; for (const k of ['medal', 'gem', 'bubble']) queue(g, k); }, { timeout: 3000 });
  }
  /** Warm-up for one v6 housing: its metal and its stone program compile in the background while the user looks at the
      cards, so the 3D view and the step to Diamond open straight away (the owner 11-24: stuck flat, could not rotate). */
  function warmHouse(shape) {
    const idle = root.requestIdleCallback || ((f) => setTimeout(f, 120));
    idle(() => {
      const g = ensure(); if (!g) return;
      const keys = [progKey('house', { shape, tier: 3 }), progKey('house', { shape, tier: 5 }), 'webbake', 'bubble'];
      for (const k of keys) queue(g, k);
      // A compiled program still costs its first draw (the driver finishes it then): one 1 px draw each, one per idle
      // moment, so opening the full view never pays it (the owner 11-25: smooth, no stutter).
      const step = () => {
        if (g !== ogl || g.isContextLost()) return;
        const k = keys.find((x) => PC[x] && !PC[x].warm && !PC[x].bad);
        if (!k) return;
        const P = finish(g, PC[k]);
        if (P) {
          g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, 1, 1); g.useProgram(P.p);
          if (P.U.uRes) g.uniform2f(P.U.uRes, 1, 1);
          if (k === 'bubble') { g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); }   // drawn blended in the ring
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4); g.disable(g.BLEND); g.flush();
          PC[k].warm = true; dirty = true;
        }
        idle(step, { timeout: 1500 });
      };
      idle(step, { timeout: 1500 });
    }, { timeout: 1200 });
  }
  function prog(src) {   // the old path: a context per canvas
    const sh = (type, s) => { const x = gl.createShader(type); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { console.info('[ACH] 3d shader:', gl.getShaderInfoLog(x)); return null; } return x; };
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, src);
    if (!v || !f) return null;
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    const U = {}; for (const k of UNI) U[k] = gl.getUniformLocation(p, k);
    const L = {}; for (const k in LOOK3) L[k] = gl.getUniformLocation(p, LOOK3[k]);
    return { p, U, L };
  }
  /* Test hook: draw one frame now and wait for the GPU to finish it; returns the time in ms (-1: not ready). */
  let benching = false; const PX = new Uint8Array(4);
  function benchOne() {
    if (!gl || (!cur && !pend)) return -1;
    if (!cur) { cur = finish(gl, pend); if (!cur) return -1; pend = null; }
    cancelAnimationFrame(raf); raf = 0; benching = true; dirty = true;
    const a = performance.now(); frame(a); cancelAnimationFrame(raf); raf = 0;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PX); benching = false;
    const ms = performance.now() - a; raf = requestAnimationFrame(frame); return ms;
  }
  function frame(now) {
    raf = 0;
    if (!gl) return;
    if (!cur && pend) { cur = finish(gl, pend); if (cur) { pend = null; dirty = true; } else if (pend.bad) { pend = null; return; } }
    if (cur && !document.hidden && (dirty || !still)) {
      const t = still ? 9 : (now - t0) / (kind === 'bubble' ? 1000 : 3000);   // stones move at a third of real time
      pace(now);
      if (root.__achDS) ds = root.__achDS;   // test hook: a fixed resolution
      const wtx = kind === 'house' ? webTex(gl) : null;   // (may draw the cobweb texture first: before the viewport below)
      const rw = persist ? Math.max(64, Math.round(cv.width * ds)) : cv.width, rh = persist ? Math.max(64, Math.round(cv.height * ds)) : cv.height;
      if (persist && (oc.width !== rw || oc.height !== rh)) { oc.width = rw; oc.height = rh; }
      gl.viewport(0, 0, rw, rh);
      gl.useProgram(cur.p);
      gl.uniform2f(cur.U.uRes, rw, rh); gl.uniform1f(cur.U.uTime, t); gl.uniform1f(cur.U.uKind, kind === 'ruby' ? 1 : 0);
      // column-major for GL: R maps object -> world
      gl.uniformMatrix3fv(cur.U.uR, false, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
      gl.uniformMatrix3fv(cur.U.uRT, false, R);
      const look = root.ACHLook || {};
      for (const k in cur.L) if (cur.L[k]) gl.uniform1f(cur.L[k], +(look[k] != null ? look[k] : 0));
      if (cur.U.uWear) gl.uniform3f(cur.U.uWear, wear[0], wear[1], wear[2] || 0);
      if (cur.U.uAge && root.ACHAgeVec) gl.uniform4fv(cur.U.uAge, root.ACHAgeVec());
      if (kind === 'medal') {
        gl.uniform3fv(cur.U.uMetal, opt.metal || [1, .77, .33]);
        gl.uniform1f(cur.U.uForm, +opt.form || 0); gl.uniform1f(cur.U.uIconK, opt.iconK || .66);
        gl.uniform1i(cur.U.uIcon, 0); gl.uniform1i(cur.U.uBack, 1);
        gl.uniform1f(cur.U.uIconOn, texI ? 1 : 0); gl.uniform1f(cur.U.uBackOn, texB ? 1 : 0);
        gl.uniform1i(cur.U.uRing, 2); gl.uniform1f(cur.U.uRingOn, texL && !opt.form ? 1 : 0);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texL);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texI);
      } else if (kind === 'house') {
        const hs = HSHAPE[opt.shape] || HSHAPE.iris, tr = +opt.tier || 1, sg = stoneGeo(HSHAPE[opt.shape] ? opt.shape : 'iris'), st = tr === 5 || tr === 6;
        gl.uniform1f(cur.U.uHH, sg.HH); gl.uniform1f(cur.U.uLip, st ? sg.lip : 0);
        if (cur.U['uPl[0]']) { gl.uniform4fv(cur.U['uPl[0]'], sg.pl); gl.uniform1f(cur.U.uNG, sg.ng); gl.uniform1f(cur.U.uNP, sg.np); gl.uniform4f(cur.U.uSB, sg.sb[0], sg.sb[1], sg.sb[2], sg.sb[3]); }
        gl.uniform1f(cur.U.uKind, tr === 6 ? 1 : tr === 5 ? 0 : tr === 7 ? 3 : 2);   // 3: Emulsion's pearl housing
        gl.uniform1f(cur.U.uHole, tr === 7 ? (HOLE[opt.shape] || HOLE.iris) : 0); gl.uniform1f(cur.U.uPass, 0);
        gl.uniform3fv(cur.U.uMetal, opt.metal || [1, .77, .33]);
        gl.uniform1f(cur.U.uShape, hs[0]); gl.uniform1f(cur.U.uSeatR, st ? 1 : 0); gl.uniform1f(cur.U.uPx, rw); gl.uniform1f(cur.U.uSeed, 0); gl.uniform2f(cur.U.uTilt, 0, 0);
        gl.uniform1i(cur.U.uIcon, 0); gl.uniform1i(cur.U.uDet, 1); gl.uniform1i(cur.U.uWebT, 2);
        gl.uniform1f(cur.U.uIconOn, texI ? 1 : 0); gl.uniform1f(cur.U.uDetOn, texB ? 1 : 0);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, wtx);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texI);
      } else if (kind !== 'bubble') {
        gl.uniform1i(cur.U.uLens, 0); gl.uniform1f(cur.U.uLensOn, texL ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texL);
      }
      if (kind === 'bubble') { gl.uniform1f(cur.U.uBExt, 1.03); gl.uniform1f(cur.U.uBS, 1); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const B = kind === 'house' && +opt.tier === 7 && persist ? finish(gl, queue(gl, 'bubble')) : null;
      if (kind === 'house' && +opt.tier === 7 && persist && !B) scheduleWeb();   // the bubble is still compiling: look again shortly
      if (B) {
        // Emulsion in its housing: the ring behind the bubble, then the bubble, then the ring in front of it
        gl.uniform1f(cur.U.uPass, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(B.p);
        gl.uniform2f(B.U.uRes, rw, rh); gl.uniform1f(B.U.uTime, t * 3); gl.uniform1f(B.U.uKind, 0);
        gl.uniformMatrix3fv(B.U.uR, false, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]); gl.uniformMatrix3fv(B.U.uRT, false, R);
        for (const k in B.L) if (B.L[k]) gl.uniform1f(B.L[k], +(look[k] != null ? look[k] : 0));
        gl.uniform1f(B.U.uBExt, 1.22); gl.uniform1f(B.U.uBS, (HOLE[opt.shape] || HOLE.iris) + .01);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.useProgram(cur.p); gl.uniform1f(cur.U.uPass, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND);
      } else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (persist && tgt && !benching) { try { tgt.transferFromImageBitmap(oc.transferToImageBitmap()); } catch (e) { /* canvas gone */ } }
      dirty = false;
      if (cv && !cv.dataset.drawn) { cv.dataset.drawn = '1'; try { cv.dispatchEvent(new Event('ach3d-ready')); } catch (e) { /* ignore */ } }
    }
    raf = requestAnimationFrame(frame);
  }
  /** A 512 px alpha texture from a canvas, mipmapped (power of two). */
  function upload(c) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  }
  /** Cached textures (persistent context only): at most 32, the oldest dropped. */
  function cacheTex(key, tx) {
    if (!persist) return tx;
    TEX.delete(key); TEX.set(key, tx);
    while (TEX.size > 32) { const [k0, tx0] = TEX.entries().next().value; TEX.delete(k0); if (tx0 !== texI && tx0 !== texB && tx0 !== texL) gl.deleteTexture(tx0); }
    return tx;
  }
  /* The lettering on the lens (the owner 11-24: "uniquely made for this app"), white on clear, one 1024 x 512 strip, 8 rows
     of 64 px. The shader bends each row round its ring, so each row is drawn pre-squeezed to the ring's own length.
     Stones: 0 name ring top, 1 name ring bottom, 2 frame-rate scale, 3 back top, 4 back bottom. Coin: 5 face ring top, 6 bottom. */
  const LROW = [[1.17, 1.40, 1.396], [1.17, 1.40, .96], [1.545, 1.715, 1.396], [1.12, 1.50, 1.396], [1.12, 1.50, .96], [.655, .765, 1.396], [.655, .765, .96]];
  const serial = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ('000' + ((h >>> 0) % 9000 + 1000)).slice(-4); };
  function lensTexture(o, k) {
    const app = String(root.ACHApp || 'Your App').toUpperCase(), tier = String(o.sub || '').split(' · ')[0].toUpperCase() || (k === 'ruby' ? 'RUBY' : k === 'dia' ? 'DIAMOND' : '');
    const key = 'l|' + k + '|' + (o.title || '') + '|' + (o.sub || '') + '|' + app;
    if (persist && TEX.has(key)) { texL = TEX.get(key); cacheTex(key, texL); return; }
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const font = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
    const kx = (i) => { const [ri, ro, sp] = LROW[i]; return (1024 / (2 * sp * (ri + ro) / 2)) / (64 / (ro - ri)); };
    const line = (i, txt, size, weight) => {
      const sx = kx(i); let f = size;
      x.font = `${weight} ${f}px ${font}`;
      while (x.measureText(txt).width * sx > 990 && f > 10) { f -= 1; x.font = `${weight} ${f}px ${font}`; }
      x.save(); x.translate(512, i * 64 + 33); x.scale(sx, 1); x.fillText(txt, 0, 0); x.restore();
    };
    const title = String(o.title || '').toUpperCase(), sn = 'No. ' + (app.split(' ').map((w) => w[0]).join('') || 'AP') + '-' + serial(k + (o.title || '') + (o.sub || ''));
    if (k === 'medal') {
      line(5, 'EMULSION LENS  ·  ' + app, 38, 600);
      line(6, title + '  ·  ' + tier, 36, 600);
    } else {
      line(0, 'EMULSION LENS  ·  ' + app, 36, 600);
      line(1, title + '  ·  1:1.4  ·  ' + tier, 34, 600);
      // the frame-rate scale, where a lens has its focus scale: ticks along the outer edge, the numbers under them
      const fps = ['12', '24', '25', '30', '48', '60', '120'], sx = kx(2), w = 1024 / (fps.length + 1);
      x.font = `600 30px ${font}`;
      for (let j = 0; j < fps.length; j++) {
        const cx = w * (j + 1);
        x.save(); x.translate(cx, 2 * 64 + 40); x.scale(sx, 1); x.fillText(fps[j], 0, 0); x.restore();
        x.fillRect(cx - 2, 2 * 64 + 4, 4, 16);
        if (j < fps.length - 1) for (let m = 1; m < 5; m++) x.fillRect(cx + (w * m) / 5 - 1.5, 2 * 64 + 4, 3, 9);
      }
      x.save(); x.translate(w * (fps.length + .55), 2 * 64 + 40); x.scale(sx, 1); x.font = `600 24px ${font}`; x.fillText('fps', 0, 0); x.restore();
      line(3, 'MADE FOR  ' + app, 34, 600);
      line(4, sn + '  ·  EARNED, NEVER BOUGHT', 30, 600);
    }
    texL = cacheTex(key, upload(c)); dirty = true;
  }
  function medalTextures(o, my) {
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 512; return c; };
    const bk = 'b|' + (o.title || '') + '|' + (o.sub || '') + '|' + (o.form || 0) + '|' + (root.ACHApp || '');
    if (persist && TEX.has(bk)) { texB = TEX.get(bk); cacheTex(bk, texB); } else {
      const b = mk(), x = b.getContext('2d');
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const font = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
      x.font = `700 ${o.title && o.title.length > 14 ? 40 : 50}px ${font}`; x.fillText(o.title || '', 256, 236);
      x.font = `600 26px ${font}`; x.fillText((o.sub || '').toUpperCase(), 256, 296);
      const ring = String(root.ACHApp || 'Your App').toUpperCase() + '  ·  CERTIFIED  ·  ', R0 = 196;
      x.font = `600 24px ${font}`;
      const tot = x.measureText(ring + ring).width, step = Math.PI * 2 / tot;
      let a = -Math.PI / 2 - (x.measureText(ring).width * step) / 2;
      if (!o.form) for (const ch of ring + ring) { const w = x.measureText(ch).width; x.save(); x.translate(256 + Math.cos(a + w * step / 2) * R0, 256 + Math.sin(a + w * step / 2) * R0); x.rotate(a + w * step / 2 + Math.PI / 2); x.fillText(ch, 0, 0); x.restore(); a += w * step; }
      if (!o.form) { x.lineWidth = 4; x.strokeStyle = '#fff'; x.beginPath(); x.arc(256, 256, 168, 0, Math.PI * 2); x.stroke(); }
      texB = cacheTex(bk, upload(b));
    }
    dirty = true;
    const src = o.emblem || (root.ACHIconSrc && o.icon ? root.ACHIconSrc(o.icon) : '');   // emblem: a whole face drawn for that outline
    if (!src) return;
    const fk = 'f|' + src;
    if (persist && TEX.has(fk)) { texI = TEX.get(fk); cacheTex(fk, texI); return; }
    const img = new Image();
    img.onload = () => {
      if (my !== tok || !gl) return;   // a newer medal started meanwhile
      const c = mk(), y = c.getContext('2d');
      if ('filter' in y) y.filter = 'blur(1.4px)';
      y.drawImage(img, 0, 0, 512, 512);
      texI = cacheTex(fk, upload(c)); dirty = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" fill="none" stroke="#fff" color="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${src}</svg>`);
  }
  /** Start on `canvas` (sized by the caller: width/height in device px). Returns false without WebGL or if the shader fails. */
  function start(canvas, k, reduced, o) {
    stop();
    const my = ++tok;
    cv = canvas; kind = k; still = !!reduced; opt = o || {}; texI = texB = texL = null; wear = opt.wear || [0, 0, 0];
    const g = opt.keep ? null : ensure();   // keep: the caller reads the canvas back (needs its own context)
    let r = null;
    if (g) { try { r = canvas.getContext('bitmaprenderer'); } catch (e) { r = null; } }
    if (g && r) {
      persist = true; gl = g; tgt = r;
      pend = queue(g, progKey(k, opt)); cur = finish(g, pend); if (cur || pend.bad) pend = null;
      if (!cur && !pend) { gl = null; cv = null; tgt = null; return false; }
    } else {
      persist = false; tgt = null; pend = null;
      try { gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: !!opt.keep }); } catch (e) { gl = null; }
      if (!gl) { cv = null; return false; }
      progs = {};
      cur = prog(k === 'bubble' ? BUBBLE : k === 'medal' ? MEDAL : k === 'house' ? HOUSE(progKey(k, opt)) : GEM);
      if (!cur) { gl = null; cv = null; return false; }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    if (k === 'medal') { medalTextures(opt, my); if (!opt.form) lensTexture(opt, 'medal'); }
    else if (k === 'house') medalTextures(opt, my);
    else if (k !== 'bubble') lensTexture(opt, k);
    t0 = performance.now(); dirty = true; lastT = 0; ema = 16; slowT = fastT = 0;
    raf = requestAnimationFrame(frame);
    return true;
  }
  /** Orientation in degrees: yaw about the vertical axis, pitch about the horizontal axis (screen), spin about the stone's own axis. */
  function rot(yaw, pitch, spin) {
    const a = yaw * D2R, b = pitch * D2R, s = (spin || 0) * D2R;
    const Ry = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
    const Rx = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)];
    const Rz = [Math.cos(s), -Math.sin(s), 0, Math.sin(s), Math.cos(s), 0, 0, 0, 1];
    const mul = (A, B) => { const C = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
    R = mul(mul(Ry, Rx), Rz);   // row-major, object -> world
    dirty = true;
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0; cur = null; pend = null; tok++;
    if (gl && !persist) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }   // the shared context stays
    gl = null; cv = null; tgt = null;
  }
  /** Orientation as a matrix (row-major 3x3, object -> world), for callers that keep their own (trackball drag). */
  function rotM(m) { R = m.slice(0, 9); dirty = true; }
  root.ACH3D = { start, rot, rotM, warm, warmHouse, benchOne, stop, redraw: () => { dirty = true; }, active: () => !!cur, canvas: () => cv, scale: () => ds, wear: (w) => { wear = [+w[0] || 0, +w[1] || 0, +w[2] || 0]; dirty = true; } };
})(typeof window !== 'undefined' ? window : globalThis);

// ES module entry for the app (the file above is the Achievements Lab source, unchanged)
export default (typeof window !== 'undefined' ? window : globalThis).ACH3D;

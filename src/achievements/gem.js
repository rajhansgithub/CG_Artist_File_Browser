/* Live materials for earned tiers 1-6 (reference gem.js, maths unchanged). One shared WebGL context draws every <canvas class="ach-gemgl" data-kind="bronze|silver|gold|platinum|dia|ruby" data-icon="...">.
   data-shape="round" (the default v4 medal): a struck round medal (polished rim, spun face with fine rings, icon engraved) for metals and the round brilliant for Diamond / Ruby.
   Shapes plaque / award are kept for the earlier theme options (v1). uTilt (ACHGem.set(c, {tilt})) moves the studio lights with the full view's pointer tilt.
   60 fps. ACHGem.only(canvas) draws only that canvas (the full view) while the rest hold still. data-dpr caps the pixel ratio.
   No network. Pauses off screen and in a hidden tab; one still frame with "reduce motion". No WebGL: the parent gets .is-nogl. */
(function (root) {
  'use strict';
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `
precision highp float;
#ifndef ENV_ROT
#define ENV_ROT(d) (d)
#endif
uniform vec2 uRes; uniform float uTime; uniform float uSeed; uniform float uKind; uniform sampler2D uIcon; uniform float uIconOn; uniform float uPx; uniform sampler2D uDet; uniform float uDetOn; uniform vec2 uTilt;
const float PI=3.14159265;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
// studio: soft ceiling, strip lights round the side that turn slowly, hard spots for sparkle,
// and the viewer's own dark head straight above (this gives a brilliant its black-and-white mosaic)
float env(vec3 d, float t){
  d.xy=rot(t*.23)*d.xy;
  float az=atan(d.y,d.x);
  float s=.03+.45*smoothstep(-.1,.9,d.z);
  s+=1.1*pow(max(cos(az*3.)*.5+.5,0.),5.)*smoothstep(-.2,.5,d.z)*smoothstep(.98,.75,d.z);
  s+=pow(max(dot(d,normalize(vec3(.55,.55,.63))),0.),60.)*7.;
  s+=pow(max(dot(d,normalize(vec3(-.72,.25,.64))),0.),40.)*4.;
  s+=pow(max(dot(d,normalize(vec3(.05,-.78,.62))),0.),80.)*6.;
  s*=1.-.95*smoothstep(.94,.985,d.z);
  return s;
}
// light that enters through a facet (normal n), bounces off two pavilion mains and leaves through the crown.
// Worked out once per facet (from its centre c), so every facet is one clean flat tone, like a real stone.
float inner(vec2 c, vec3 v, vec3 n, float ior, float t){
  vec3 T=refract(-v,n,1./ior);
  if(dot(T,T)<.01) return 0.;
  vec2 q=c+T.xy*.7;
  float az=atan(q.y,q.x);
  float ps=(floor(az/(PI/4.))+.5)*(PI/4.);
  float th=radians(40.8);
  vec3 np=vec3(cos(ps)*sin(th),sin(ps)*sin(th),-cos(th));
  vec3 D1=reflect(T,np);
  vec2 q2=q+D1.xy*.8;
  float az2=atan(q2.y,q2.x);
  float ps2=(floor(az2/(PI/4.))+.5)*(PI/4.);
  vec3 np2=vec3(cos(ps2)*sin(th),sin(ps2)*sin(th),-cos(th));
  vec3 D2=reflect(D1,np2);
  if(D2.z<=0.) return .02;
  vec3 O=refract(D2,vec3(0.,0.,-1.),ior);
  if(dot(O,O)<.01) return .05;
  return env(normalize(O),t);
}
// ---- struck metal medals (tiers 1-4): polished raised rim, spun face with fine rings, icon engraved (frosted floor, bright cut walls)
uniform vec3 uMetal;

#ifdef NO_AGE
uniform vec3 uWear; uniform vec4 uAge[4];
vec3 aged(vec3 col, float a, vec2 p, float recess, float flt, float metal, float aa){ return col; }
#else
// ---- age: dust and cobwebs (uWear = dust, unused, cobweb, 0..1). 1 real hour = 1 day on the shelf; polishing removes it.
// Dust is grains, not a film: a few grains first, more as it builds, until they join into a grainy grey layer (a year).
// It lies thick on flat surfaces and piles up in hollows (the engraving, the groove under the rim); steep walls stay
// almost clean and glossy; the top gets it before the bottom. Each grain is lit from the top left. Lint fibres lie on top.
// Cobweb: it grows, it never scales. Every thread has a fixed place and a birth time (from a hash); time only reveals
// them: first a few hair-thin threads from the rim, then more between them, drop lines with beads, then torn gauze
// sheets between the ropes and the rim. Dust thickens the threads into grey furry ropes and makes them sag.
// uWear.x = dust (the clock already applied the dust amount), .y = this medal's seed, .z = cobweb age.
// uAge = the tuner (ACHAge): [0] (dust amount: used by the clock), patchiness, top first, hides reflections; [1] grit, lint, web amount,
// how many threads; [2] thread thickness, glint, gauze, dust on silk; [3] rainbow.
uniform vec3 uWear;
uniform vec4 uAge[4];
float wS, wC;   // this medal's seed (uWear.y, from its id) and the angle its cobweb hangs at: every medal gets its own web and dust
float wN(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y); }
float wF(vec2 p){ return .5*wN(p)+.25*wN(p*2.03+3.1)+.125*wN(p*4.01+7.7); }
vec2 wSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return vec2(length(pa-ba*h),h); }
// short curled fibres, one per cell of size 1/sc. dens = how many of them exist yet (each has its own fixed place).
float wHair(vec2 p, float sc, float w, float aa, float dens){
  if(dens<=.001) return 0.;   // none yet: skip the 9 cells
  vec2 q=(p+(vec2(wN(p*11.+2.),wN(p*11.+8.))-.5)*.07)*sc, id=floor(q);
  float m=0.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 c=id+vec2(float(i),float(j));
    if(hash(c+13.7)<dens){
      vec2 o=c+vec2(hash(c+3.1),hash(c+5.3));
      float an=hash(c+7.9)*3.1416;
      vec2 dir=vec2(cos(an),sin(an))*(.25+.45*hash(c+11.));
      float d=wSeg(q,o-dir,o+dir).x/sc;
      m=max(m,(1.-smoothstep(max(w-aa,0.)*.4,w+aa,d))*(.5+.5*hash(c+17.)));
    }
  }
  return m*min(1.,w*2.4/(aa*1.5+1e-4));
}
// rope i of the web: where it is tied (a on the rim; b on the rim for even i, on the face for odd i) and how far it sags
void wRope(float i, float G, out vec2 a, out vec2 b, out float sg){
  float sd=wS*61.7, h1=hash(vec2(i*1.31+.7+sd,2.9)), h2=hash(vec2(i*2.17+4.1,7.3+sd)), h3=hash(vec2(i*.73+9.2+sd,1.1));
  float a1=wC-1.175+2.35*fract(i*.381966+.13+wS*.37);
  a=vec2(cos(a1),sin(a1))*.955;
  float a2=clamp(a1+(h1>.5?1.:-1.)*(.6+.8*h2),wC-1.425,wC+1.425);
  vec2 f=vec2(-.55+.7*h1,.6-.7*h2); float r0=wC-2.175, cs=cos(r0), sn=sin(r0);
  b=mod(i,2.)<.5 ? vec2(cos(a2),sin(a2))*.955 : vec2(f.x*cs-f.y*sn,f.x*sn+f.y*cs);
  sg=(.05+.11*h3)*length(b-a)*(.5+.9*clamp((G-i*.055)*1.2,0.,1.));   // dust loads it: it sags more with age
}
// the point at t along rope i
vec2 wOn(float i, float t, float G){
  vec2 a,b; float sg; wRope(i,G,a,b,sg);
  vec2 cu=normalize(b-a), nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
  return mix(a,b,t)+nn*sg*4.*t*(1.-t);
}
// one thin sagging thread from a to b: uneven width, beads of dust, a soft fuzz. grow: 0..1+ how much of it is spun yet.
float wLine(vec2 p, vec2 a, vec2 b, float sg, float w, float aa, float seed, float grow, float fuzz){
  vec2 ch=b-a; float L=length(ch); vec2 cu=ch/L, nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
  float u=dot(p-a,cu)/L, h=dot(p-a,nn);
  float uc=clamp(u,0.,1.), s=sg*4.*uc*(1.-uc), ds=sg*4.*(1.-2.*uc)/L;
  float d=abs(h-s)/sqrt(1.+ds*ds);
  if(u<-.03||u>1.03||d>w*9.+aa*3.) return 0.;
  float ww=w*(.55+.9*wN(vec2(uc*L*26.,seed)))*(1.+1.6*smoothstep(.78,.95,wN(vec2(uc*L*64.,seed+3.))));
  float core=(1.-smoothstep(max(ww-aa,0.)*.4,ww+aa,d))*min(1.,ww*2.4/(aa*1.5+1e-4));
  float halo=(1.-smoothstep(0.,ww*4.5+aa*2.,d))*.22*fuzz*(.6+.8*wN(p*110.+seed));
  return max(core,halo)*smoothstep(-.02,.01,u)*(1.-smoothstep(.99,1.02,u))*(1.-smoothstep(grow-.08,grow,uc));
}
// the cobweb: rgb = its light (premultiplied, never above a), a = how much it covers
#ifndef WEB_TEX
vec4 wWeb(vec2 p, float amt, float dust, float aa){
  if(amt<=.001 || dot(p,vec2(cos(wC),sin(wC)))<-.5) return vec4(0.);   // it lives on this medal's upper side (left, top or right)
  float G=min(amt,1.3), keep=.75*uAge[1].w, W=uAge[2].x;
  float rope=0., fine=0., gz=0., shd=0.;
  float thrH=.24+.18*smoothstep(.55,1.,G);                      // old gauze tears: the holes only grow
  for(int i=0;i<8;i++){
    float fi=float(i), age=G-fi*.055;
    if(age>0. && (i<2 || hash(vec2(fi+wS*53.,3.3))<keep)){
      vec2 a,b; float sg; wRope(fi,G,a,b,sg);
      vec2 ch=b-a; float L=length(ch); vec2 cu=ch/L, nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
      float u=dot(p-a,cu)/L, h=dot(p-a,nn);
      if(u>-.03 && u<1.03){
        float uc=clamp(u,0.,1.), s=sg*4.*uc*(1.-uc), ds=sg*4.*(1.-2.*uc)/L;
        float e=h-s, d=abs(e)/sqrt(1.+ds*ds);
        float w=(i<2?.016:.006+.008*hash(vec2(fi+wS*53.,8.8)))*W*(.12+.88*smoothstep(0.,.6,age))*(.6+.6*dust*uAge[2].w);
        shd=max(shd,(1.-smoothstep(0.,w*5.+.01,abs(e-.014-w)))*smoothstep(-.02,.03,u)*(1.-smoothstep(.97,1.02,u))*min(age*8.,1.));   // its soft shadow on the medal
        if(d<w*9.+aa*3.){
          float ww=w*(.55+.9*wN(vec2(uc*L*26.,fi*7.+1.)))*(1.+1.6*smoothstep(.78,.95,wN(vec2(uc*L*64.,fi*5.+3.))));
          float dr=d+(wN(p*75.+fi*3.)-.5)*ww*1.3;                // a ragged, furry outline
          float core=(1.-smoothstep(ww*.25,ww*1.15+aa,dr))*min(1.,ww*2.4/(aa*1.5+1e-4))*(.62+.3*wN(vec2(uc*L*40.,e*160.)+fi));
          float halo=(1.-smoothstep(ww*.5,ww*3.4+aa*2.,dr))*.42*smoothstep(0.,.4,age)*(.35+1.1*wN(p*130.+fi));   // fur
          rope=max(rope,max(core,halo)*smoothstep(-.02,.01,u)*(1.-smoothstep(.99,1.02,u))*(1.-smoothstep(age/.07-.08,age/.07,uc)));
        }
        float gage=age-.2-.2*hash(vec2(fi+wS*53.,6.1));               // gauze: later, on the rim-to-rim ropes
        if(gage>0. && u>0. && u<1.){
          float skirt=(.03+.16*wF(vec2(uc*L*6.,fi*3.+2.)))*min(gage*3.,1.);   // a ragged hem hangs below the rope
          float reg=e<0. ? (mod(fi,2.)<.5 ? smoothstep(0.,.05,.955-length(p)) : 0.) : 1.-smoothstep(skirt*.3,skirt,e);
          if(reg>0.){
            float holes=smoothstep(thrH-.12,thrH+.1,wF(p*5.5+fi*3.7+wS*9.));
            float fibre=(.55+.45*wN(vec2(uc*L*9.+fi,e*85.)))*(.7+.3*wN(p*70.));
            gz=max(gz,reg*holes*(.4+.6*fibre)*smoothstep(0.,.35,gage)*smoothstep(0.,.05,uc)*(1.-smoothstep(.95,1.,uc)));
          }
        }
      }
    }
  }
  for(int k=0;k<12;k++){                                       // fine threads from rope to rope
    float fk=float(k);
    float ia=floor(hash(vec2(fk+wS*53.,1.2))*7.99), ib=mod(ia+1.+floor(hash(vec2(fk+wS*53.,2.6))*2.99),8.);
    float age=G-max(.08+.065*fk,max(ia,ib)*.055+.03);
    if(age>0. && hash(vec2(fk+wS*53.,4.4))<keep && (ia<1.5||hash(vec2(ia+wS*53.,3.3))<keep) && (ib<1.5||hash(vec2(ib+wS*53.,3.3))<keep)){
      vec2 a=wOn(ia,.15+.7*hash(vec2(fk+wS*53.,5.5)),G), b=wOn(ib,.15+.7*hash(vec2(fk+wS*53.,6.6)),G);
      float m=wLine(p,a,b,.03*length(b-a),.0017*W*(.45+.55*smoothstep(0.,.5,age)),aa,fk*3.1,age/.06,smoothstep(0.,.5,age));
      if(G>.8 && hash(vec2(fk+wS*53.,9.9))>.7){ float u=wSeg(p,a,b).y; m*=smoothstep(.0,.1,abs(u-.5)-.1*smoothstep(.8,1.,G)); }   // an old one snaps
      fine=max(fine,m);
    }
  }
  for(int k=0;k<6;k++){                                        // drop lines hanging from the ropes, beaded with dust
    float fk=float(k), ia=floor(hash(vec2(fk+wS*53.,11.2))*7.99);
    float age=G-max(.05+.08*fk,ia*.055+.02);
    if(age>0. && hash(vec2(fk+wS*53.,14.4))<keep && (ia<1.5||hash(vec2(ia+wS*53.,3.3))<keep)){
      vec2 a=wOn(ia,.2+.6*hash(vec2(fk+wS*53.,15.5)),G);
      vec2 b=a+vec2((hash(vec2(fk+wS*53.,16.6))-.5)*.1,-(.09+.2*hash(vec2(fk+wS*53.,17.7))));
      fine=max(fine,wLine(p,a,b,.004,.0016*W*(.45+.55*smoothstep(0.,.5,age)),aa,fk*5.3+40.,age/.05,smoothstep(0.,.5,age)));
    }
  }
  float gza=clamp(gz*uAge[2].z*2.3,0.,.8);
  float al=clamp(max(rope,fine*.5)+gza*(1.-rope),0.,.94);
  vec3 silk=vec3(.86,.85,.83), dusty=vec3(.70,.69,.66);
  float lit=.86+.14*smoothstep(-1.,1.,p.y)+.12*uAge[2].y*fine*(1.-dust*.6)-.14*gza*(1.-rope);   // fresh silk glints; dusty silk does not
  vec3 rgb=mix(silk,dusty,clamp(uAge[2].w*(.45+.55*dust),0.,1.))*al*lit
          +uAge[3].x*max(rope,fine)*(1.-dust)*.3*(.5+.5*cos(6.283*(p.x*5.+p.y*3.+vec3(0.,.33,.67))));
  return vec4(min(rgb,vec3(al)),al+(1.-al)*max(shd*.4,gza*.15));
}
#else
uniform sampler2D uWebT; float gNoWeb=0.;   // gNoWeb: the coin's edge has no web (it hung off the face and smeared across the edge)
// 3D view: the cobweb baked once into a texture over the disc (it only depends on where it is)
#endif
// 3D view: where the viewer and the light are, in this surface's own frame (+z out of it). The aging has depth: the cobweb
// hangs above the surface (it slides against the metal as the medal turns, and casts a shadow on it), the dust grains are lit
// by the real light, and seen at a low angle the dust layer thickens (the eye looks through more of it). Flat badges: face on.
vec3 gAgV=vec3(0.,0.,1.), gAgL=vec3(.5,.5,.71), gAgN=vec3(0.,0.,1.); float gAgAO=1.;   // gAgN, gAgAO: the relief's own slope and shelter under the dust
// age a (premultiplied) colour. p: on the face (radius 1, +y up). recess: how sheltered (dust piles up there).
// flt: 1 on a flat surface, lower on a steep wall (dust slides off). metal: 1 metal, 0 stone.
vec3 aged(vec3 col, float a, vec2 p, float recess, float flt, float metal, float aa){
  float dust=min(uWear.x,1.), web=uWear.z*uAge[1].z;
  wS=uWear.y; wC=2.175+(wS-.5)*2.;   // upper left on average; from the top right to the left side
  vec2 ps=p+wS*vec2(3.7,5.3);         // this medal's own dust pattern
  if(dust+web<.002 || a<=0.) return col;
  float rc=min(recess,1.);
  // how much has settled here: the top first (the bottom's share = dust^(1+2*how low)), little on steep walls, more in hollows
  float low=1.-smoothstep(-1.,1.,p.y+(wF(p*2.5+3.)-.5)*.3);
  float dl=pow(max(dust,1e-4),1.+2.*low*uAge[0].z);
  float wall=1.-smoothstep(.72,.97,flt);
  float T=dl*mix(1.,mix(.05,.7,dl*dl),wall)*(1.+1.3*rc);
  float Tc=min(T,1.);
  // grains: clumps, coarse grains, fine grains. A grain is there once the layer passes its own threshold, so more dust =
  // more grains (none ever moves). Small tiles cannot show the fine ones (f1, f2 fade them out: no shimmer).
  float f1=clamp(2.-aa*38.,0.,1.), f2=clamp(2.-aa*95.,0.,1.), f3=clamp(1.6-aa*170.,0.,1.);
  float clump=wF(ps*4.3+11.)/.875;
  float g1=wN(ps*38.+1.), g2=wN(ps*95.+7.), g3=wN(ps*170.+4.);
  float n=mix(.5,clump,uAge[0].y)*.42+mix(.5,g1,f1)*.2+mix(.5,g2,f2)*.24+mix(.5,g3,f3)*.14;
  float thr=.80-.72*Tc;
  float cov=smoothstep(thr-.03,thr+.05,n)*smoothstep(0.,.04,T);
#ifdef WEB_TEX
  float vz=clamp(gAgV.z,.12,1.);
  cov=1.-pow(1.-cov,mix(1.,1./vz,.6));                      // a low look goes through more of the layer: it reads thicker
#endif
  float thick=smoothstep(0.,.3,n-thr);
#ifdef WEB_TEX
  vec2 Ld=normalize(gAgL.xy+vec2(1e-4))*.006;               // towards the real light
#else
  vec2 Ld=vec2(-.6,.8)*.006;                                  // towards the light
#endif
  float sh=clamp(1.+((g1-wN((ps+Ld)*38.+1.))*.35*f1+(g2-wN((ps+Ld*.5)*95.+7.))*.65*f2)*1.1,.78,1.22);
  // a thin layer: the mirror goes hazy (dust scatters the light), the colour still shows through
  float mx=max(max(col.r,col.g),max(col.b,.001));
  vec3 matte=(col/mx*(.17+.07*smoothstep(-1.,1.,p.y))+vec3(.15,.145,.135))*a*(1.-.12*rc);
#ifdef WEB_TEX
  float lit=(.42+.72*clamp(dot(gAgN,gAgL),0.,1.))*gAgAO;   // dust follows the relief: lit slopes bright, slopes away and hollows dim
  col=mix(col,matte*lit,min(smoothstep(0.,.6,T)*uAge[0].w*mix(1.,1./vz,.35),1.));
#else
  col=mix(col,matte,smoothstep(0.,.6,T)*uAge[0].w);
  const float lit=1.;
#endif
  // the grains themselves: light grey, each a little different, lit from the top left; dark specks and pale grains
  vec3 dc=vec3(.60,.585,.55);
  float tone=(.50+.10*smoothstep(-1.,1.,p.y)+.16*thick)*(.80+.22*mix(.5,g2,f2)+.22*mix(.5,g3,f3)+.25*(clump-.5)+.3*(wF(ps*13.+2.)-.44))*sh*(1.-.18*rc);
  vec3 dustc=dc*tone*lit;
  dustc*=1.-.5*smoothstep(.86,.95,wN(ps*150.+3.))*f2*uAge[1].x;
  dustc+=dc*.22*smoothstep(.9,.97,wN(ps*60.+9.))*f1*uAge[1].x;
  col=mix(col,dustc*a,cov*(.45+.52*thick));
  // lint: long fibres lie anywhere (on clean metal too), short fuzz grows in the thick dust
  float lint=wHair(ps,8.,.0022,aa,.4*smoothstep(.05,.7,dl)*uAge[1].y);
  float fuzz=wHair(ps+5.3,19.,.0017,aa,.8*smoothstep(.3,.9,T)*uAge[1].y);
  col=mix(col,vec3(.72,.71,.68)*a,lint*.5);
  col=mix(col,vec3(.70,.69,.66)*a,fuzz*.4);
#ifdef WEB_TEX
  vec4 wb=vec4(0.);
  if(web>.001&&gNoWeb<.5){
    const float HW=.03;                                      // the web hangs this high above the surface
    vec2 pv=gAgV.xy/vz*HW; pv*=min(1.,.25/max(length(pv),1e-4));      // seen through: it sits nearer the viewer
    vec2 pl=gAgL.xy/max(gAgL.z,.2)*HW; pl*=min(1.,.3/max(length(pl),1e-4));
    float ws=gAgL.z>0.?texture2D(uWebT,clamp((p+pl)*.5+.5,0.,1.)).a:0.;   // its shadow on the surface below
    col*=1.-.55*ws*smoothstep(0.,.25,gAgL.z);
    wb=texture2D(uWebT,clamp((p+pv)*.5+.5,0.,1.));
    wb.rgb*=.8+.35*clamp(gAgL.z,0.,1.);
  }
#else
  vec4 wb=wWeb(p,web,dust,aa);
#endif
  col=col*(1.-wb.a)+wb.rgb*a;
  return col;
}
#endif
float envM(vec3 d, float t){
  d.xy=rot(t*.25)*d.xy;
  float s=.10+.30*smoothstep(-.3,1.,d.z);
  s+=1.5*pow(max(dot(d,normalize(vec3(.5,.45,.75))),0.),9.);
  s+=.7*pow(max(dot(d,normalize(vec3(-.65,-.25,.7))),0.),14.);
  s+=.35*smoothstep(.2,-.4,d.y)*smoothstep(-.6,.3,d.z);
  s+=4.*pow(max(dot(d,normalize(vec3(.45,.55,.7))),0.),220.);
  return s;
}
float icA(vec2 p){ vec2 iu=p/.66*.5+.5; return texture2D(uIcon,vec2(iu.x,1.-iu.y)).a; }
// studio for the metals: a dark room with a big softbox up left (close to the camera, so the face catches part of it),
// a tall strip light right, a warm floor bounce, a thin horizon line and one hard glint. Moves with the full view's tilt.
float envS(vec3 d, float t){
  d.xy=rot(.12*sin(t*.21)+uTilt.x*.8)*d.xy;
  d.yz=rot(uTilt.y*.6+.04*sin(t*.17))*d.yz;
  float s=.09+.12*smoothstep(-.2,.9,d.y);
  vec3 a=normalize(vec3(-.42,.46,.78));
  vec3 ux=normalize(cross(vec3(0.,0.,1.),a)), uy=cross(a,ux);
  float ca=dot(d,a);
  if(ca>0.){ vec2 q=vec2(dot(d,ux),dot(d,uy))/ca; s+=2.6*smoothstep(.08,-.08,max(abs(q.x)-.55,abs(q.y)-.40))*(.8+.2*smoothstep(-.3,.3,q.y)); }
  vec3 b=normalize(vec3(.82,.0,.57)); float cb=dot(d,b);
  if(cb>0.){ vec3 bx=normalize(cross(vec3(0.,1.,0.),b)); vec2 q=vec2(dot(d,bx),d.y)/cb; s+=1.8*smoothstep(.05,-.05,max(abs(q.x)-.08,abs(q.y)-1.)); }
  s+=.32*smoothstep(-.05,-.7,d.y)*smoothstep(-.4,.2,d.z);
  s+=.25*exp(-pow((d.y+.1)/.03,2.))*smoothstep(-.5,.2,d.z);
  s+=9.*pow(max(dot(d,normalize(vec3(.3,.62,.72))),0.),700.);
  return s;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float gRec=0.;
#ifdef F_ROUND
vec4 medal(vec2 p, float r, float aa, float t){
  vec3 base=uMetal;
  vec3 v=normalize(vec3(-p*.30,1.));                      // a near camera
  vec2 rd=r>1e-4?p/r:vec2(1.,0.);
  vec2 tg=vec2(-rd.y,rd.x);
  float RIM=.83;
  vec3 col;
  if(r>RIM){
    // polished raised rim: a rounded bead, then a crisp outer edge. Mirror finish: one sharp reflection.
    float x=clamp((r-RIM)/(.975-RIM),0.,1.);
    float sl=cos(x*PI)*1.25;
    sl=mix(sl,-2.6,smoothstep(.972,.99,r));
    float gN=floor(clamp(uPx*.6,36.,120.)), ga=atan(p.y,p.x)*gN;     // the grip: ribs on the outer half, like a focus ring
    vec3 n=normalize(vec3(-rd*sl+tg*sin(ga)*.32*smoothstep(.35,.55,x),1.));
    vec3 R=reflect(-v,n);
    float cv=clamp(dot(n,v),0.,1.);
    vec3 F=base+(1.-base)*pow(1.-cv,5.);
    col=F*envS(R,t);
    col*=1.-.45*smoothstep(.16,0.,x);                    // the face's shadow where the bead rises
  } else {
    // spun face, very slightly domed: the rings smear each reflection along the radius (the bow-tie of real spun metal)
    vec3 n=normalize(vec3(p*.22,1.));
    float ring=sin(r*uPx*.9)*.5+.5;
    n=normalize(n+vec3(rd*(ring-.5)*.012,0.));
    float e=0.;
    for(int k=0;k<4;k++){ float o=(float(k)-1.5)/1.5; e+=envS(reflect(-v,normalize(n+vec3(rd*o*.28,0.))),t); }
    e*=.25;
    float cv=clamp(dot(n,v),0.,1.);
    vec3 F=base+(1.-base)*pow(1.-cv,5.);
    col=F*e*.92;
    col*=1.-.35*smoothstep(RIM-.12,RIM,r);              // occlusion under the rim
  }
  // a fine groove where the rim meets the face
  col*=1.-smoothstep(aa*1.5,0.,abs(r-RIM))*.7;
  // engraved icon: sunken, sandblasted floor (matte, darker) and polished walls that catch the studio
  if(uIconOn>0. && r<RIM){
    float d=1.6/max(uPx,40.);
    float m=icA(p);
    float gx=icA(p+vec2(d,0.))-icA(p-vec2(d,0.));
    float gy=icA(p+vec2(0.,d))-icA(p-vec2(0.,d));
    if(m+abs(gx)+abs(gy)>0.){
      float grain=.85+.3*hash(floor(gl_FragCoord.xy));
      float diff=.10+.10*envS(vec3(-.35,.4,.85),t);
      vec3 floorC=base*diff*grain;
      col=mix(col,floorC,smoothstep(.15,.85,m));
      vec3 nw=normalize(vec3(vec2(gx,gy)*2.2,1.));
      float w=clamp(length(vec2(gx,gy))*1.6,0.,1.);
      vec3 Rw=reflect(-v,nw);
      col=mix(col,base*envS(Rw,t)*1.1,w*.9);
    }
  }
  if(r<RIM){
    float la=atan(p.x,p.y), st=PI/30., ti=floor(la/st+.5), tf=abs(la-ti*st)*r, maj=step(mod(ti,5.),.01);
    float tw=mix(.0045,.007,maj)+aa*.5, rin=mix(.795,.776,maj);
    float eng=smoothstep(tw+aa,tw,tf)*smoothstep(rin-aa,rin+aa,r)*smoothstep(.822+aa,.822-aa,r);
    // the app's name round the iris, as fine print (only on list-size badges; the full view has the real lettering)
    float top=step(0.,p.y), sA=top>.5?la:atan(p.x,-p.y);
    float w=.03, ap=sA*r/w, cf=fract(ap);
    float band=smoothstep(.672-aa,.672+aa,r)*smoothstep(.748+aa,.748-aa,r)*step(abs(sA),top>.5?1.396:.96)*step(uPx,240.);
    eng=max(eng,band*step(.18,hash(vec2(floor(ap),top*7.)))*smoothstep(0.,.15,cf)*smoothstep(.75,.6,cf)*.8);
    if(eng>0.){ float grain=.85+.3*hash(floor(gl_FragCoord.xy)); col=mix(col,base*(.10+.10*envS(vec3(-.35,.4,.85),t))*grain,eng*.9); }
    gRec=eng;
  }
  float inside=smoothstep(1.+aa,1.-aa,r);
  col=aces(col*1.1);
  return vec4(col*inside,inside);
}
#endif
float segd(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
// ---- plaque shapes (the owner 2026-11-21: metals as plaques; Diamond and Ruby in a plaque-like cut) ----
uniform float uShape;
const vec2 PB=vec2(.97,.74);   // plaque half size (4:3)
float sdRBox(vec2 p, vec2 b, float rr){ vec2 q=abs(p)-b+rr; return length(max(q,0.))+min(max(q.x,q.y),0.)-rr; }
#ifdef F_PLAQUE
float icP(vec2 p, float k){ vec2 iu=p/k*.5+.5; return texture2D(uIcon,vec2(iu.x,1.-iu.y)).a; }
// metal plaque: polished bevelled frame, brushed face (fine horizontal lines), icon engraved
vec4 plaqueM(vec2 p, float aa, float t){
  vec3 base=uMetal;
  float d=sdRBox(p,PB,.2);
  float inside=smoothstep(aa,-aa,d);
  if(inside<=0.) return vec4(0.);
  vec3 v=normalize(vec3(-p*.3+vec2(.06*sin(t*.5),.05*sin(t*.37+1.)),1.));
  float e2=1.5/max(uPx,40.);
  vec2 g=normalize(vec2(sdRBox(p+vec2(e2,0.),PB,.2)-sdRBox(p-vec2(e2,0.),PB,.2), sdRBox(p+vec2(0.,e2),PB,.2)-sdRBox(p-vec2(0.,e2),PB,.2))+1e-6);
  float W=.16;                                  // frame width
  vec3 n=vec3(0.,0.,1.); bool frame=d>-W;
  if(frame){
    float x=clamp((d+W)/(W*.92),0.,1.);
    float sl=cos(x*PI)*1.05;
    sl=mix(sl,-2.3,smoothstep(-.03,-.008,d));
    n=normalize(vec3(g*sl,1.));
  } else {
    n=normalize(vec3(0.,(sin(p.y*uPx*1.1)*.5)*.05+(hash(vec2(floor(p.y*uPx*.55),3.))-.5)*.04,1.));   // brushed: fine horizontal hairlines
  }
  vec3 R=reflect(-v,n);
  float e=envM(R,t);
  vec3 col;
  if(frame) col=base*e*1.25+vec3(e*e*.04);
  else {
    // brushing smears the light into a soft band that slides across the face as the lights turn
    float la=t*.25+.7;
    float band=exp(-pow(dot(p,vec2(cos(la),sin(la)))-.35*sin(t*.3),2.)*5.);
    col=base*(e*.8+band*.45+.08);
  }
  col*=1.-smoothstep(aa*1.5,0.,abs(d+W))*.55;   // groove where the frame meets the face
  if(uIconOn>0. && !frame){
    float k=.34, dd=1.6/max(uPx,40.);   // icon at half the face
    float m=icP(p,k);
    float gx=icP(p+vec2(dd,0.),k)-icP(p-vec2(dd,0.),k);
    float gy=icP(p+vec2(0.,dd),k)-icP(p-vec2(0.,dd),k);
    if(m+abs(gx)+abs(gy)>0.){
      float grain=.82+.36*hash(floor(gl_FragCoord.xy));
      col=mix(col,base*(.40+.14*envM(vec3(0.,0.,1.),t))*grain,smoothstep(.15,.85,m));
      vec3 nw=normalize(vec3(vec2(gx,gy)*2.2,1.));
      col=mix(col,base*envM(reflect(-v,nw),t)*1.3,clamp(length(vec2(gx,gy))*1.6,0.,1.)*.9);
    }
  }
  col=1.-exp(-col*1.6);
  return vec4(col*inside,inside);
}
// emerald (step) cut, the plaque-shaped stone: a table and three rows of steps round a rectangle with cut corners
vec4 emerald(vec2 p, float aa, float t){
  float ruby=uKind;
  vec2 B=PB; float C=.30;                       // cut corners
  vec2 q=abs(p);
  float cx=q.x-B.x, cy=q.y-B.y, cc=(q.x+q.y-(B.x+B.y-C))*.7071;
  float d=max(max(cx,cy),cc);
  float inside=smoothstep(aa,-aa,d);
  if(inside<=0.) return vec4(0.);
  // which side: 0 = left/right, 1 = top/bottom, 2 = corner
  float side; vec2 o; float sec;
  if(cc>=cx && cc>=cy){ side=2.; o=normalize(sign(p+1e-6)); }
  else if(cx>=cy){ side=0.; o=vec2(sign(p.x+1e-6),0.); }
  else { side=1.; o=vec2(0.,sign(p.y+1e-6)); }
  sec=side*4.+(p.x>0.?1.:0.)+(p.y>0.?2.:0.);
  float top2=max(max(min(cx,cy),min(cx,cc)),min(cy,cc));   // second biggest: the line between two sides
  float ed=(d-top2)*.75;
  float T=.30;                                   // crown steps take this much from the edge
  vec3 n; float fid; vec2 cen;
  float tabT=-T;
  if(d>tabT){
    float band=clamp(floor((d-tabT)/T*3.),0.,2.);
    n=normalize(vec3(o*sin(.30+band*.2),cos(.30+band*.2)));
    fid=band*12.+sec;
    float lv=tabT+(band+.5)*T/3.;
    cen=p-o*0.;  cen=o*(1.+lv)*.8;
    ed=min(ed,abs(fract((d-tabT)/T*3.+.5)-.5)*T/3.);
  } else {
    // the table: you see the pavilion steps mirrored in it, nested rectangles (the "hall of mirrors")
    float k=floor((tabT-d)/.13);
    n=normalize(vec3(-o*sin(.07+.05*mod(k,3.)),1.));
    fid=60.+k*12.+sec;
    cen=o*(.62-k*.13)+vec2(-o.y,o.x)*.2*mod(k,2.);
    ed=min(ed,abs(fract((tabT-d)/.13+.5)-.5)*.13);
    ed=min(ed,abs(d-tabT));
  }
  vec3 v=normalize(vec3(.09*sin(t*.47),.08*sin(t*.31+1.),1.));
  n=normalize(n+vec3((hash(vec2(fid,3.1))-.5)*.08,(hash(vec2(fid,7.7))-.5)*.08,0.));
  float ior=mix(2.417,1.77,ruby);
  float F0=pow((ior-1.)/(ior+1.),2.);
  float F=F0+(1.-F0)*pow(1.-max(dot(n,v),0.),5.);
  float outer=env(reflect(-v,n),t);
  float disp=mix(.06,.02,ruby);
  vec2 cp=mix(cen,p,d>tabT?.15:0.);   // steps: one clean tone each (the table's mirrored steps too)
  vec3 inn=vec3(inner(cp,v,n,ior-disp,t), inner(cp,v,n,ior,t), inner(cp,v,n,ior+disp,t));
  vec3 col;
  if(ruby<.5){
    col=inn*(1.-F)*1.1 + outer*F*1.5;
    col=pow(col,vec3(1.45))*1.5+.015;
  } else {
    float lum=dot(inn,vec3(.33));
    float path=mix(.5,1.2,smoothstep(-.5,0.,d));
    vec3 absorb=exp(-vec3(.05,3.,2.4)*path);
    col=pow(vec3(lum),vec3(1.3))*(1.-F)*vec3(1.,.1,.17)*absorb*4.2;
    col+=vec3(.2,.006,.03)*(1.-.5*smoothstep(-.6,0.,d));
    col+=vec3(.75,.03,.09)*pow(.5+.5*sin(t*.8+hash(vec2(fid,9.))*6.28),3.)*.6;
    col+=pow(min(lum,3.),2.)*vec3(1.,.4,.45)*.05;
    col+=pow(outer*F,1.4)*vec3(1.,.9,.92)*1.6;
  }
  float line=smoothstep(aa*1.3,0.,ed)*smoothstep(-.005,-.03,d);
  col=mix(col,col*.6+mix(vec3(.08),vec3(.1,.02,.03),ruby),line*.55);
  col+=mix(vec3(.6,.62,.68),vec3(.7,.2,.26),ruby)*smoothstep(-.03,-.01,d)*smoothstep(0.,-.01,d);
  if(uIconOn>0. && d<tabT){
    float k=.56, px=1./max(uPx,48.);
    vec2 iu=p/k*.5+.5; vec2 fl=vec2(iu.x,1.-iu.y);
    float m=texture2D(uIcon,fl).a, m2=texture2D(uIcon,fl+vec2(px,px)*1.5).a;
    float tab=smoothstep(tabT,tabT-.04,d); m*=tab; m2*=tab;
    if(m+m2>0.){
      float grain=.85+.3*hash(floor(gl_FragCoord.xy));
      vec3 frost=(ruby<.5 ? vec3(.86,.89,.94) : vec3(1.,.52,.58))*(.6+.12*sin(t*.4+p.x*2.))*grain;
      col=mix(col,col*.35+frost,m*.78);
      col+=max(m-m2,0.)*mix(vec3(.7),vec3(.8,.4,.42),ruby)*.5;
      col*=1.-max(m2-m,0.)*.45;
    }
  }
  col=1.-exp(-max(col,0.)*1.6);
  return vec4(col*inside,inside);
}
#endif
vec3 tilt(float c, float a){ return normalize(vec3(cos(c)*sin(a),sin(c)*sin(a),cos(a))); }
// the round brilliant, drawn in p (|p| = 1 at the girdle); p0 + ik: where and how big the etched icon is (ik 0 = fill the table)
#ifndef NO_BRILL
vec4 brill(vec2 p, float r, float aa, float t, vec2 p0, float ik){
  float inside=smoothstep(1.+aa,1.-aa,r);
  if(inside<=0.) return vec4(0.);
  float ruby=uKind;
  // crown facets (8-fold): local u along the sector's centre, w across
  float a=atan(p.y,p.x);
  float sec=floor((a+PI/8.)/(PI/4.));
  float ca=sec*PI/4.;
  float s=a-ca;
  float u=r*cos(s), w=r*sin(s);
  float TB=.58, SP=.81, tn=tan(PI/8.);
  vec2 lp=vec2(u,abs(w));
  vec2 tv=vec2(TB,TB*tn), st=vec2(SP,0.), g=vec2(cos(PI/8.),sin(PI/8.)), g0=vec2(1.,0.);
  float side=sign(w+1e-6);
  vec3 n; float fid; vec2 cen; float ed;
  bool table=u<TB;
  if(table){
    // through the table you see the pavilion mains and lower girdles mirrored: 16 wedges, split near the middle
    float wa=floor(a/(PI/8.)); float ring=step(.3+.04*sin(wa*2.1),r);
    fid=100.+wa+ring*16.;
    float cwa=(wa+.5)*PI/8.;
    cen=vec2(cos(cwa),sin(cwa))*mix(.18,.45,ring);
    n=tilt(cwa+PI,mix(.10,.22,ring));
    float wl=abs(sin(a*8.))*r;                     // distance to a wedge line
    ed=min(wl*.9, abs(r-.3-.04*sin(wa*2.1)));
    ed=min(ed,u-TB<0.?TB-u:1.);
  } else {
    ed=min(min(segd(lp,vec2(TB,0.),tv),segd(lp,tv,st)),min(segd(lp,st,g),segd(lp,st,g0)));
    if(abs(w)<(SP-u)/(SP-TB)*TB*tn){ n=tilt(ca,.27); fid=1.+sec; cen=vec2(cos(ca),sin(ca))*.65; }
    else {
      vec2 e=g-st; vec2 l2=lp-st;
      if(e.x*l2.y-e.y*l2.x<0.){ float c=ca+side*PI/16.; n=tilt(c,.74); fid=20.+sec*2.+side; cen=vec2(cos(c),sin(c))*.93; }
      else { float c=ca+side*PI/8.; n=tilt(c,.6); fid=40.+mod(sec*2.+(side>0.?1.:0.)+16.,16.); cen=vec2(cos(c),sin(c))*.8; }
    }
  }
  // the stone rocks a little; each facet is a touch off (real cutting), so they flash at different moments
  vec3 v=normalize(vec3(.09*sin(t*.47)+uTilt.x*.9,.08*sin(t*.31+1.)+uTilt.y*.9,1.));
  n=normalize(n+vec3((hash(vec2(fid,3.1))-.5)*.08,(hash(vec2(fid,7.7))-.5)*.08,0.));
  float ior=mix(2.417,1.77,ruby);
  float F0=pow((ior-1.)/(ior+1.),2.);
  float F=F0+(1.-F0)*pow(1.-max(dot(n,v),0.),5.);
  float outer=env(reflect(-v,n),t);
  // brilliance + fire: three colours, each with its own index (dispersion makes the rainbow flashes)
  float disp=mix(.06,.02,ruby);
  vec2 cp=mix(cen,p,.35);   // a little of the pixel's own place: soft shading across each facet
  vec3 inn=vec3(inner(cp,v,n,ior-disp,t), inner(cp,v,n,ior,t), inner(cp,v,n,ior+disp,t));
  vec3 col;
  if(ruby<.5){
    col=inn*(1.-F)*1.1 + outer*F*1.5;
    col=pow(col,vec3(1.45))*1.5+.015;                      // a real brilliant is mostly bright white and near black
  } else {
    // ruby: deep red body; the further light travels inside (towards the rim), the darker and richer it gets
    float lum=dot(inn,vec3(.33));
    float path=mix(.5,1.2,smoothstep(.15,1.,r));
    vec3 absorb=exp(-vec3(.05,3.,2.4)*path);
    col=pow(vec3(lum),vec3(1.3))*(1.-F)*vec3(1.,.1,.17)*absorb*4.2;
    col+=vec3(.2,.006,.03)*(1.-.5*r);
    // light bounced round the body lights crown facets one by one (a ruby's slow red 'breathing')
    if(!table) col+=vec3(.75,.03,.09)*pow(.5+.5*sin(t*.8+hash(vec2(fid,9.))*6.28),3.)*mix(1.,.45,smoothstep(.8,1.,r));                     // light scattered inside: a soft red glow
    col+=pow(min(lum,3.),2.)*vec3(1.,.4,.45)*.05;          // the brightest flashes lean pink-white
    col+=pow(outer*F,1.4)*vec3(1.,.9,.92)*1.6;
  }
  // facet lines: a touch darker with a hairline of light
  float line=smoothstep(aa*1.3,0.,ed)*smoothstep(.985,.94,r);
  col=mix(col,col*.6+mix(vec3(.08),vec3(.1,.02,.03),ruby),line*.55);
  // girdle: thin bright rim
  col+=mix(vec3(.6,.62,.68),vec3(.7,.2,.26),ruby)*smoothstep(.955,.985,r)*smoothstep(1.,.985,r);
  // the badge's icon, laser-etched into the table: frosted (matte, scatters light) with a fine cut edge.
  // Not used now (the owner 11-21: no etching on Diamond / Ruby, it looks bad): every caller passes ik<0.
  if(uIconOn>0. && ik>=0.){
    vec2 iu=(ik>0.?p0/ik:p/(TB*1.42))*.5+.5;   // plaque stones: a smaller icon (half)
    vec2 fl=vec2(iu.x,1.-iu.y);
    float m=texture2D(uIcon,fl).a;
    float px=1./max(uPx,48.);
    float m2=texture2D(uIcon,fl+vec2(px,px)*1.5).a;
    float tab=smoothstep(TB+.01,TB-.03,u);
    m*=tab; m2*=tab;
    if(m+m2>0.){
      float grain=.85+.3*hash(floor(gl_FragCoord.xy));
      vec3 frost=(ruby<.5 ? vec3(.86,.89,.94) : vec3(1.,.52,.58))*(.6+.12*sin(t*.4+p.x*2.))*grain;
      col=mix(col,col*.35+frost,m*(ik>0.?.92:.78));
      col+=max(m-m2,0.)*mix(vec3(.7),vec3(.8,.4,.42),ruby)*.5;   // cut edge catches light on one side
      col*=1.-max(m2-m,0.)*.45;                                  // and is in shadow on the other
    }
  }
  col=max(col,0.);
  col=1.-exp(-col*1.6);
  return vec4(col*inside,inside);
}
#endif
#ifdef F_PLAQUE
// ---- vertical award plaque (an optional theme: a standing award plaque): a solid plate with a crisp chamfered
// edge, a recessed mirror pocket in the upper part with a small thin emblem (the badge icon), etched text under it and the
// the app's mark + name at the bottom (uDet: white-on-clear picture of everything etched). Metals: all metal.
// Diamond / Ruby: dark gunmetal plate, the edge band made of the stone itself (small triangular facets), the stone set in the pocket.
const vec2 VB=vec2(.74,.98);
const vec2 PC=vec2(0.,.40); const vec2 PH=vec2(.34,.23);
float det(vec2 p){ vec2 u=p/1.04*.5+.5; return uDetOn>0.?texture2D(uDet,vec2(u.x,1.-u.y)).a:0.; }
// one small triangular stone facet (edge band of the stone plaques)
vec3 stoneTri(vec2 p, float d, vec2 g, float t, float ruby, out float ed){
  float cs=.052;
  vec2 s=vec2(p.x+p.y*.57735,p.y*1.1547)/cs;
  vec2 ce=floor(s), f=fract(s);
  float up=step(1.,f.x+f.y);
  ed=min(min(f.x,f.y),abs(1.-f.x-f.y))*cs*.8;
  vec2 cc=ce+mix(vec2(1./3.),vec2(2./3.),up);
  vec2 cen=vec2(cc.x-cc.y*.5,cc.y*.866)*cs;
  float fid=hash(ce*.731+up*vec2(.37,.71))*97.;   // per-facet id, no lines of look-alike facets
  vec3 v=normalize(vec3(.09*sin(t*.47)+uTilt.x*.9,.08*sin(t*.31+1.)+uTilt.y*.9,1.));
  float sl=mix(.25,.75,smoothstep(-.12,0.,d));                       // the band curves down to the edge
  vec3 n=normalize(vec3(g*sl+vec2(hash(vec2(fid,3.1))-.5,hash(vec2(fid,7.7))-.5)*.32,1.));
  float ior=mix(2.417,1.77,ruby);
  float F0=pow((ior-1.)/(ior+1.),2.);
  float F=F0+(1.-F0)*pow(1.-max(dot(n,v),0.),5.);
  float outer=env(reflect(-v,n),t);
  float disp=mix(.06,.02,ruby);
  vec3 inn=vec3(inner(cen,v,n,ior-disp,t),inner(cen,v,n,ior,t),inner(cen,v,n,ior+disp,t));
  vec3 col;
  if(ruby<.5){ col=inn*(1.-F)*1.1+outer*F*1.5; col=pow(col,vec3(1.45))*1.5+.015; }
  else {
    float lum=dot(inn,vec3(.33));
    col=pow(vec3(lum),vec3(1.3))*(1.-F)*vec3(1.,.1,.17)*exp(-vec3(.05,3.,2.4)*.8)*4.2;
    col+=vec3(.2,.006,.03)+vec3(.75,.03,.09)*pow(.5+.5*sin(t*.8+hash(vec2(fid,9.))*6.28),3.)*.6;
    col+=pow(outer*F,1.4)*vec3(1.,.9,.92)*1.6;
  }
  col=mix(col,col*.6+mix(vec3(.08),vec3(.1,.02,.03),ruby),smoothstep(.006,0.,ed)*.55);
  return col;
}
// pavé edge (the owner 2026-11-21: round stones of mixed sizes, "no gaps", "no straight edges"): round brilliants from small
// to big packed tight all the way round the edge (one continuous loop, so no seams at the corners or the middle); both
// the outer outline and the inner line against the plate follow the stones. Where two stones overlap, the one in front
// wins (power diagram), with a fine dark seam.
const float PW=.30;                               // how far in the stones can reach
float perim(){ return 4.*(VB.x+VB.y); }
// a point on the edge loop (clockwise from the top-left corner), w in from the edge
vec2 loopPt(float s, float w){
  s=mod(s,perim());
  float a=2.*VB.x, b=2.*VB.y;
  if(s<a) return vec2(-VB.x+s, VB.y-w);
  s-=a; if(s<b) return vec2(VB.x-w, VB.y-s);
  s-=b; if(s<a) return vec2(VB.x-s, -VB.y+w);
  s-=a; return vec2(-VB.x+w, -VB.y+s);
}
float loopS(vec2 p){
  vec2 dd=VB-abs(p);
  float a=2.*VB.x, b=2.*VB.y;
  if(dd.y<dd.x) return p.y>0. ? p.x+VB.x : a+b+(VB.x-p.x);
  return p.x>0. ? a+(VB.y-p.y) : 2.*a+b+(VB.y+p.y);
}
// the shape of the stone border: round lobes of mixed sizes all the way round the edge (one continuous loop), melted
// together into ONE piece (smooth union), so both the outside and the inside line are wavy, never straight
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
// how deep the stone border reaches in at p: a wavy line, big slow waves plus smaller ripples (2D noise, so no seams at
// the corners)
float paveW(vec2 p){ return .13+.13*vn(p*3.1+vec2(4.2,1.7))+.05*vn(p*8.3+vec2(9.1,3.3)); }
float paveSdf(vec2 p){
  float depth=-sdRBox(p,VB,.05);
  float ow=.055*vn(p*3.3+vec2(2.,7.))+.025*vn(p*9.1+vec2(5.,1.));                 // the outside line is wavy too (the owner 11-21: no straight outer edge)
  return max(ow-depth, depth-paveW(p));
}
// the owner 2026-11-21: "made up of a single piece": the border is one carved piece of diamond / ruby, cut all over in small
// triangular facets, domed so the facets tip towards its wavy edges
vec4 pave(vec2 p, float d, float aa, float t, vec3 v){
  float sd=paveSdf(p);
  if(sd>aa) return vec4(0.);
  float e=1.5/max(uPx,40.);
  vec2 g=normalize(vec2(paveSdf(p+vec2(e,0.))-sd, paveSdf(p+vec2(0.,e))-sd)+1e-6);
  float ed;
  vec3 col=stoneTri(p,-.02,g*smoothstep(-.06,0.,sd)*1.4,t,uKind,ed);   // one piece: flat top, rounded only at its own edge
  col+=mix(vec3(.5,.52,.58),vec3(.6,.15,.2),uKind)*smoothstep(-.012,-.002,sd);   // a bright line along the polished edge
  col=1.-exp(-max(col,0.)*mix(2.6,1.6,uKind));   // diamond a little brighter
  float a=smoothstep(aa,-aa,sd);
  return vec4(col*a,a);
}
vec4 vplaque(vec2 p, float aa, float t){
  bool stone=uKind<1.5;
  float ruby=uKind;
  vec3 base=stone?vec3(.13,.13,.15):uMetal;
  float dO=sdRBox(p,VB,.05);
  if(dO>aa) return vec4(0.);
  float d=stone?dO+.1:dO;                          // stone plaques: the plate sits inside, the stones make the outline
  float inside=smoothstep(aa,-aa,d);
  vec3 v=normalize(vec3(-p*.3+uTilt*.9+vec2(.05*sin(t*.5),.04*sin(t*.37+1.)),1.));
  vec4 pv=stone&&dO>-PW?pave(p,dO,aa,t,v):vec4(0.);
  if(pv.a>=.999) return pv;
  float e2=1.5/max(uPx,40.);
  vec2 g=normalize(vec2(sdRBox(p+vec2(e2,0.),VB,.05)-sdRBox(p-vec2(e2,0.),VB,.05), sdRBox(p+vec2(0.,e2),VB,.05)-sdRBox(p-vec2(0.,e2),VB,.05))+1e-6);
  float W=.035;
  vec3 col; bool edge=d>-W;
  {
    vec3 n;
    if(edge) n=normalize(vec3(g*1.6,1.));
    else n=normalize(vec3((hash(vec2(floor(p.y*uPx*.6),3.))-.5)*.03,sin(p.y*uPx*1.1)*.02,1.));   // brushed: fine horizontal lines
    float e=envM(reflect(-v,n),t);
    if(edge) col=base*e*1.35+vec3(e*e*.05);
    else {
      float la=t*.25+.7+uTilt.x*2.;
      float sh=exp(-pow(dot(p,vec2(cos(la),sin(la)))-.35*sin(t*.3)-uTilt.y,2.)*4.);
      col=base*(e*(stone?.8:.62)+sh*.38+.05)+(stone?vec3(e*e*.025+sh*.03):vec3(0.));
    }
  }
  if(!edge){
    // etched text and the app's mark: frosted (matte, lighter), fine walls. The light it catches is capped: a moving
    // highlight once made the text flash bright white for a moment (the owner 11-21 "text is blown out, then fixes")
    float m=det(p)*smoothstep(80.,180.,uPx);          // text is only etched where it can be read (big badges, the full view)
    if(m>0.){
      float grain=.85+.3*hash(floor(gl_FragCoord.xy));
      vec3 fr=(stone?vec3(.62,.63,.67):mix(base,vec3(1.),.5))*(.85+.12*min(envM(vec3(.3,.4,1.),t),1.2))*grain;
      col=mix(col,fr,m*.92);
    }
  }
  // the pocket: recessed, mirror polished
  vec2 pe=p-PC;
  float dp=sdRBox(pe,PH,.07);
  vec4 top=vec4(0.);
  if(stone){
    // the owner 11-21: no grey pocket round the stone, only the diamond / ruby, set straight on the plate with a soft shadow
    vec2 SH=PH-.03; vec2 q=abs(pe);
    float gg=max(max(q.x/SH.x,q.y/SH.y),(q.x+q.y)/(SH.x+SH.y-.12));
    col*=1.-.55*smoothstep(1.16,.98,gg-pe.y*.15);
    if(gg<1.02){
      float an=atan(pe.y/SH.y,pe.x/SH.x);
      top=brill(gg*vec2(cos(an),sin(an)),gg,aa/SH.y*1.3,t,pe,-1.);
    }
  } else if(dp<0.){
    vec2 gp=normalize(vec2(sdRBox(pe+vec2(e2,0.),PH,.07)-sdRBox(pe-vec2(e2,0.),PH,.07), sdRBox(pe+vec2(0.,e2),PH,.07)-sdRBox(pe-vec2(0.,e2),PH,.07))+1e-6);
    float wall=smoothstep(-.03,-.022,dp);
    vec3 n=normalize(vec3(-gp*1.4*wall,1.));
    float e=envM(reflect(-v,n),t);
    vec3 pb=stone?vec3(.8,.81,.86):base;
    col=pb*(e*.9)*mix(.75,1.25,wall)+vec3(e*e*.05);
    if(stone){
      if(dp<-.03){
        vec2 SH=PH-.03; vec2 q=abs(pe);
        float gg=max(max(q.x/SH.x,q.y/SH.y),(q.x+q.y)/(SH.x+SH.y-.12));
        float an=atan(pe.y/SH.y,pe.x/SH.x);
        top=brill(gg*vec2(cos(an),sin(an)),gg,aa/SH.y*1.3,t,pe,-1.);
      }
    } else {
      // the emblem: the badge icon, small and thin, raised and frosted like the emblem on a real award
      float m=det(p);
      if(m>0.){
        float grain=.88+.24*hash(floor(gl_FragCoord.xy));
        col=mix(col,(base*.7+vec3(.28))*(.8+.15*min(envM(vec3(.2,.5,1.),t),1.2))*grain,m*.95);
      }
    }
  } else col*=1.-.35*smoothstep(.03,0.,dp);
  col=1.-exp(-max(col,0.)*1.6);
  col=col*(1.-top.a)+top.rgb;
  vec4 pl=vec4(col*inside,inside);
  return pv+pl*(1.-pv.a);
}
#endif
#ifdef F_ROUND
#ifndef NO_BRILL
// ---- Diamond and Ruby set in a lens (the owner 11-24: "not just the whole stone by itself"), seen from the front. The same
// barrel as the full view's 3D one, at 1/1.74: inner bezel, name ring with its red / ice ring, chrome step, frame-rate scale,
// knurled grip. Rings only: the stone (the costly part) now covers a third of the badge instead of all of it.
vec4 lensFlat(vec2 p, float r, float aa, float t){
  bool ruby=uKind>.5;
  vec3 v=normalize(vec3(-p*.30+uTilt*.9,1.));
  vec2 rq=r>1e-4?p/r:vec2(1.,0.), tg=vec2(-rq.y,rq.x);
  float ang=atan(p.x,p.y);
  vec3 n=vec3(0.,0.,1.), F0=vec3(.045), alb=vec3(.02); float k=.3, rec=.2;
  vec3 acc=ruby?vec3(.62,.015,.04):mix(vec3(.62,.84,1.),vec3(.77,.78,1.),.5+.5*sin(atan(p.y,p.x)*2.+t*.4));
  if(r<.632){                    // inner bezel, sloping down to the stone; a polished lip where it holds it
    float e=smoothstep(.59,.565,r);
    n=normalize(vec3(-rq*mix(.25,.9,e),1.)); F0=mix(F0,vec3(.6,.61,.65),e); k=mix(.3,0.,e); rec=.8;
    alb*=.6+.4*smoothstep(.55,.63,r);
  } else if(r<.874){             // name ring: chamfers at both edges, the lettering, the red / ice ring
    float b1=smoothstep(.66,.645,r), b2=smoothstep(.852,.866,r);
    float ac=smoothstep(.815-aa,.815+aa,r)*smoothstep(.845+aa,.845-aa,r);
    n=normalize(vec3(rq*(b2-b1)*.8,1.));
    F0=mix(F0,vec3(.7,.71,.75),max(b1,b2)); k=mix(.45,0.,max(b1,b2));
    alb=mix(alb,acc*.55,ac); F0=mix(F0,ruby?vec3(.09,.02,.03):acc*.6,ac);
    float top=step(0.,p.y), sA=top>.5?ang:atan(p.x,-p.y);
    float w=.03, ap=sA*r/w, cf=fract(ap);
    float band=smoothstep(.69-aa,.69+aa,r)*smoothstep(.79+aa,.79-aa,r)*step(abs(sA),top>.5?1.396:.96);
    float ink=band*step(.18,hash(vec2(floor(ap),top*7.+uKind*3.)))*smoothstep(0.,.15,cf)*smoothstep(.75,.6,cf)*.75;   // fine print
    alb=mix(alb,vec3(.78),ink); rec=.25+.5*b1;
  } else if(r<.886){ n=normalize(vec3(rq*.9,1.)); F0=vec3(.86,.87,.9); alb=vec3(0.); k=0.; }   // chrome step
  else if(r<.935){               // frame-rate scale: ticks
    float st=PI/24., ti=floor(ang/st+.5), tf=abs(ang-ti*st)*r, maj=step(mod(ti,4.),.01), rin=mix(.91,.893,maj);
    float tick=smoothstep(.004+aa,.004,tf)*smoothstep(rin-aa,rin+aa,r)*step(abs(ang),1.45);
    alb=mix(alb,vec3(.8),tick); k=.4; rec=.35;
  } else {                       // the knurled grip
    float N=floor(clamp(uPx*.45,24.,96.)), a2=atan(p.y,p.x)*N;
    n=normalize(vec3(rq*smoothstep(.975,1.,r)*1.4+tg*sin(a2)*.5,1.));
    alb=vec3(.03)*(.75+.25*cos(a2)); F0=vec3(.07); k=0.; rec=.5-.3*cos(a2);
  }
  vec3 R=reflect(-v,n);
  float cv=clamp(dot(n,v),0.,1.);
  vec3 F=F0+(1.-F0)*pow(1.-cv,5.)*(1.-.6*step(F0.r,.1));
  vec3 ax=vec3(rq,0.)*k;
  float en=k>0.?(envS(reflect(-v,normalize(n-ax)),t)+envS(R,t)+envS(reflect(-v,normalize(n+ax)),t))/3.:envS(R,t);
  float dif=.12+.30*clamp(envS(n,t),0.,1.4);
  vec3 col=aces((F*en+alb*dif)*1.1);
  float inside=smoothstep(1.+aa,1.-aa,r);
  vec4 m=vec4(col*inside,inside);
  gRec=rec;
  if(r<.56){                     // the stone, its girdle under the bezel's lip
    vec4 st=brill(p/.575,r/.575,aa/.575,t,p/.575,-1.)*smoothstep(.553+aa,.553-aa,r);
    m=st+m*(1.-st.a);
    gRec=mix(rec,smoothstep(.4,.55,r)*.7,st.a);
  }
  return m;
}
#endif
#endif
#ifdef F_DESIGN
// ---- v6 design studies (the owner 11-24): ONE round housing for every tier, made for this app. Metals hold the badge icon on
// a domed cabochon in the centre; Diamond and Ruby sit in the very same seat. The Emulsion bubble stays its own thing.
// uShape 3 iris, 4 layers, 5 contact sheet, 6 timeline reel, 7 orbit gizmo.
// The same code draws the 3D full view (medal3d.js 'house'): there gV is the real view direction and ENV_ROT turns the
// face's reflections into the world, so the lights stay put while the medal turns.
vec3 gV=vec3(0.,0.,1.);
float envD(vec3 d, float t){ return envS(ENV_ROT(d),t); }
vec3 dBase(){ return uKind>1.5?uMetal:(uKind>.5?vec3(.95,.64,.56):vec3(.90,.92,.96)); }   // the stones' housing: rose gold (Ruby), white gold (Diamond)
vec3 dLit(vec3 n, vec3 base, vec3 v, float t, float spread, vec2 sd){
  float cv=clamp(dot(n,v),0.,1.);
  vec3 F=base+(1.-base)*pow(1.-cv,5.);
  if(uKind>2.5) F*=.95+.10*cos(6.283*(cv*1.4+dot(n.xy,vec2(.6,.35))+vec3(0.,.33,.67)));   // Emulsion: a pearl sheen, the bubble's colours in the metal
  float e=envD(reflect(-v,n),t);
  if(spread>0.) e=(e+envD(reflect(-v,normalize(n+vec3(sd*spread,0.))),t)+envD(reflect(-v,normalize(n-vec3(sd*spread,0.))),t))/3.;
  return F*e;
}
vec3 dFloor(vec3 base, float t){ return base*(.10+.10*envD(vec3(-.35,.4,.85),t))*(.85+.3*hash(floor(gl_FragCoord.xy))); }   // sandblasted
vec3 dBead(vec2 rq, float r, float r0){ float x=clamp((r-r0)/(.985-r0),0.,1.); float sl=mix(cos(x*PI)*1.2,-2.6,smoothstep(.975,.995,r)); return normalize(vec3(-rq*sl,1.)); }
float icR(vec2 q, float k){ vec2 iu=q/k*.5+.5; vec2 c=clamp(iu,.001,.999); return texture2D(uIcon,vec2(c.x,1.-c.y)).a*step(abs(q.x),k)*step(abs(q.y),k); }
vec2 segv(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return pa-ba*h; }
// the seat: q in seat units (the stone's girdle at g = 1); sp: the point handed to the brilliant (round: q)
vec4 dSeat(vec2 q, float g, vec2 sp, float aa, float t, vec3 base, vec3 v){
  float inside=smoothstep(1.+aa,1.-aa,g);
  if(inside<=0.) return vec4(0.);
#ifdef NO_FLAT_SEAT
  if(uKind<1.5 && uSeatR>0.) return vec4(0.);   // 3D: the real stone is traced there
#endif
#ifndef NO_BRILL
  if(uKind<1.5) return brill(sp,g,aa,t,q,-1.);
#endif
  vec3 n=normalize(vec3(q*.55,1.));                       // a domed cabochon, the icon engraved in it
  vec3 col=dLit(n,base,v,t,.18,normalize(q+1e-5));
  if(uIconOn>0.){
    float k=.80, d=.025;
    float m=icR(q,k), gx=icR(q+vec2(d,0.),k)-icR(q-vec2(d,0.),k), gy=icR(q+vec2(0.,d),k)-icR(q-vec2(0.,d),k);
    col=mix(col,dFloor(base,t),smoothstep(.15,.85,m));
    float w=clamp(length(vec2(gx,gy))*1.6,0.,1.);
    col=mix(col,base*envD(reflect(-v,normalize(vec3(vec2(gx,gy)*2.2,1.))),t)*1.1,w*.9);
    gRec=max(gRec,m);
  }
  col=aces(col*1.1);
  return vec4(col*inside,inside);
}
vec4 dDone(vec3 col, float r, float aa, vec4 st){ col=aces(col*1.1); float inside=smoothstep(1.+aa,1.-aa,r); vec4 m=vec4(col*inside,inside); return st+m*(1.-st.a); }
// a polished bezel sloping down into the seat (g from 1 at the seat to bw at its outer edge), gd: outward direction
vec3 dBezel(vec2 gd, float g, float bw, vec3 base, vec3 v, float t){
  vec3 col=dLit(normalize(vec3(-gd*.85,1.)),base,v,t,0.,gd);
  return col*(1.-.45*smoothstep(1.06,1.,g));            // darker where it meets the stone
}

#if DSH==3
// 1. IRIS: the aperture opened up. Six blades round a hexagon; the hexagon itself is the seat (the owner 11-24: the stone takes
// the seat's shape and fills it): a hexagonal stone, or for the metals a hexagonal dome with the icon.
vec4 dIris(vec2 p, float r, float aa, float t){
  vec3 base=dBase(), v=gV;
  vec2 rq=r>1e-4?p/r:vec2(1.,0.);
  float a=atan(p.y,p.x);
  float h1=abs(p.y), h2=abs(dot(p,vec2(.8660254,.5))), h3=abs(dot(p,vec2(.8660254,-.5)));
  float hx=max(max(h1,h2),h3);
  vec3 col; vec4 st=vec4(0.); gRec=.15;
  const float RH=.465, HX=.50;
  if(r>.885) col=dLit(dBead(rq,r,.885),base,v,t,0.,rq);
  else if(r>.835){                                         // a flat ring, a tick every 6 degrees
    float la=atan(p.x,p.y), s6=PI/30., ti=floor(la/s6+.5), tf=abs(la-ti*s6)*r, maj=step(mod(ti,5.),.01), ri=mix(.862,.846,maj);
    float tick=smoothstep(.0055+aa,.0055,tf)*smoothstep(ri-aa,ri+aa,r);
    col=mix(dLit(vec3(0.,0.,1.),base,v,t,.25,rq),dFloor(base,t),tick*.9);
    gRec=.2+tick;
  } else if(hx>HX){                                        // six blades, each one a flat leaf tilted its own way
    float sec=PI/3., f=(a+2.4*(r-.5))/sec, bf=fract(f), ci=(floor(f)+.5)*sec;
    vec2 bd=vec2(cos(ci+1.3),sin(ci+1.3));
    col=dLit(normalize(vec3(-bd*.55,1.)),base,v,t,.22,vec2(-bd.y,bd.x));
    col*=(.25+.75*smoothstep(0.,.08,bf))*(1.-.35*smoothstep(.78,.835,r));   // the next blade's shadow, the rim's shadow
    col+=base*envD(reflect(-v,normalize(vec3(bd*.9,1.))),t)*smoothstep(.95,.995,bf)*.6;   // a bright edge on each leaf
    col*=1.-.6*smoothstep(aa*1.5,0.,hx-HX);
    gRec=.25+.5*(1.-smoothstep(0.,.07,bf));
  } else {                                                 // a thin polished lip, then the hexagonal seat
    vec2 gd=h1>=h2&&h1>=h3?vec2(0.,sign(p.y)):h2>=h3?vec2(.8660254,.5)*sign(dot(p,vec2(.8660254,.5))):vec2(.8660254,-.5)*sign(dot(p,vec2(.8660254,-.5)));
    col=dBezel(gd,hx/RH,HX/RH,base,v,t); gRec=.4;
    float g=hx/RH;
    st=dSeat(p/RH*1.08,g,g*vec2(cos(a),sin(a)),aa/RH,t,base,v);
  }
  return dDone(col,r,aa,st);
}
#endif
#if DSH==4
// 2. LAYERS: the app's own mark. Two stacked plates; the rhombus is the seat (a lozenge-cut stone), the two chevrons under it.
vec4 dLayers(vec2 p, float r, float aa, float t){
  vec3 base=dBase(), v=gV;
  vec2 rq=r>1e-4?p/r:vec2(1.,0.);
  vec3 col; vec4 st=vec4(0.); gRec=.15;
  const vec2 C=vec2(0.,.15); const float A=.52, B=.36;
  vec2 q=p-C; float gR=abs(q.x)/A+abs(q.y)/B;
  if(r>.82){                                               // the top plate, spun, with its bead
    col=r>.925?dLit(dBead(rq,r,.925),base,v,t,0.,rq):dLit(vec3(rq*.05,1.),base,v,t,.25,rq);
    col*=1.-.5*smoothstep(.835,.82,r);
  } else if(r>.80){ col=dLit(normalize(vec3(-rq*1.6,1.)),base,v,t,0.,rq); }   // the step down
  else if(gR<1.16){                                        // the lozenge bezel and the seat
    vec2 gd=normalize(vec2(sign(q.x)/A,sign(q.y)/B));
    col=dBezel(gd,gR,1.16,base,v,t); gRec=.4;
    float an=atan(q.y/B,q.x/A);
    st=dSeat(q/.40,gR,gR*vec2(cos(an),sin(an)),aa*2.4,t,base,v);
  } else {                                                 // the lower plate, brushed straight; two raised chevrons
    col=dLit(vec3(0.,0.,1.),base,v,t,.3,vec2(1.,0.))*(1.-.35*smoothstep(.72,.80,r));
    float w=.042; vec2 dv=vec2(9.);
    for(int k=0;k<2;k++){
      float y0=C.y-B-.13-float(k)*.17;
      vec2 a0=vec2(-A*.86,y0+.69*A*.86), b0=vec2(0.,y0), c0=vec2(A*.86,y0+.69*A*.86);
      vec2 d1=segv(p,a0,b0), d2=segv(p,b0,c0); vec2 dd=dot(d1,d1)<dot(d2,d2)?d1:d2;
      if(dot(dd,dd)<dot(dv,dv)) dv=dd;
    }
    float dl=length(dv);
    if(dl<w+aa){
      float x=min(dl/w,1.), h=sqrt(max(1.-x*x,.06));
      vec3 n=normalize(vec3(normalize(dv+1e-6)*x/h*.9,1.));
      col=mix(col,dLit(n,base,v,t,0.,rq)*1.05,smoothstep(w+aa,w-aa,dl));
    } else col*=1.-.3*smoothstep(w*2.2,w,dl);
    col*=1.-.4*smoothstep(1.30,1.16,gR);                   // shadow round the bezel
  }
  return dDone(col,r,aa,st);
}
#endif
// 3. CONTACT SHEET: the grid view, bent into a ring. Twelve thumbnail windows; metals frost them with the picture mark,
#if DSH==5
// Diamond and Ruby set a small square stone in each.
vec4 dSheet(vec2 p, float r, float aa, float t){
  vec3 base=dBase(), v=gV;
  vec2 rq=r>1e-4?p/r:vec2(1.,0.);
  vec3 col; vec4 st=vec4(0.); gRec=.15;
  const float RS=.46;
  float a=atan(p.y,p.x), k=floor(a/(PI/6.)+.5), ak=k*PI/6.;
  vec2 lp=rot(ak)*p-vec2(.70,0.);
  float d=sdRBox(lp,vec2(.09),.02);
  if(r>.90) col=dLit(dBead(rq,r,.90),base,v,t,0.,rq);
  else if(d<0.){
    if(d>-.016){                                           // the window's polished wall
      float e=.004; vec2 g=normalize(vec2(sdRBox(lp+vec2(e,0.),vec2(.09),.02)-sdRBox(lp-vec2(e,0.),vec2(.09),.02),sdRBox(lp+vec2(0.,e),vec2(.09),.02)-sdRBox(lp-vec2(0.,e),vec2(.09),.02))+1e-6);
      g=rot(-ak)*g;
      col=dLit(normalize(vec3(-g*1.1,1.)),base,v,t,0.,g); gRec=.5;
    } else {
      col=dFloor(base,t)*1.4; gRec=.7;
#ifndef NO_BRILL
      if(uKind<1.5){                                       // a small square stone in each window
        vec2 sq=lp/.072, aq=abs(sq);
        float g=max(max(aq.x,aq.y),(aq.x+aq.y)/1.7), an=atan(sq.y,sq.x);
        vec4 s2=brill(g*vec2(cos(an),sin(an)),g,aa/.072*1.3,t+k*1.7,sq,-1.);
        col=aces(col*1.1); col=s2.rgb+col*(1.-s2.a);
        return dDone(vec3(0.),r,aa,vec4(col,1.)*smoothstep(1.+aa,1.-aa,r));
      }
#endif
      // the picture mark, raised and polished: two peaks and a sun
      vec2 m=lp;
      float t1=max(abs(m.x+.022)*1.05+(m.y+.002)*.8-.032,-(m.y+.045));
      float t2=max(abs(m.x-.030)*1.1+(m.y+.018)*.9-.028,-(m.y+.045));
      float sn=length(m-vec2(.036,.040))-.014;
      float mk=min(min(t1,t2),sn);
      float on=smoothstep(aa*.8,-aa*.8,mk);
      col=mix(col,dLit(normalize(vec3(-m*.8,1.)),base,v,t,0.,rq)*1.05,on);
    }
  } else if(r<RS*1.14){                                    // the centre bezel and seat
    col=dBezel(rq,r/RS,1.14,base,v,t); gRec=.4;
    st=dSeat(p/RS,r/RS,p/RS,aa/RS,t,base,v);
  } else {
    col=dLit(vec3(rq*.04,1.),base,v,t,.25,rq);              // spun body between the windows
    col*=(1.-.35*smoothstep(.02,0.,d))*(1.-.3*smoothstep(.86,.90,r));
  }
  return dDone(col,r,aa,st);
}
#endif
#if DSH==6
// 4. TIMELINE REEL: a timecode dial with a blue playhead at the top, a ring of film round the seat.
vec4 dReel(vec2 p, float r, float aa, float t){
  vec3 base=dBase(), v=gV;
  vec2 rq=r>1e-4?p/r:vec2(1.,0.);
  vec3 col; vec4 st=vec4(0.); gRec=.15;
  const float RS=.48;
  float la=atan(p.x,p.y);
  if(r>.885){                                              // the dial: a tick every 3 degrees, a long one every 15
    float s3=PI/60., ti=floor(la/s3+.5), tf=abs(la-ti*s3)*r, maj=step(mod(ti,5.),.01), ro=mix(.94,.965,maj);
    float tick=smoothstep(.005+aa,.005,tf)*smoothstep(ro+aa,ro-aa,r)*smoothstep(.895-aa,.895+aa,r);
    vec3 n=r>.972?normalize(vec3(rq*1.8,1.)):vec3(0.,0.,1.);
    col=mix(dLit(n,base,v,t,.2,vec2(-rq.y,rq.x)),dFloor(base,t),tick*.9); gRec=.2+tick;
    float ph=max(.866-p.y,abs(p.x)-(p.y-.866)*.42);         // the playhead: blue enamel, set into the dial
    if(ph<aa){
      float on=smoothstep(aa,-aa,ph);
      vec3 en=vec3(.10,.40,1.)*(.25+.45*clamp(envD(vec3(0.,.3,1.),t),0.,1.4))+.06*envD(reflect(-v,vec3(0.,0.,1.)),t);
      col=mix(col,en,on);
    }
  } else if(r>.86){ col=dLit(normalize(vec3(-rq*1.5,1.)),base,v,t,0.,rq); }   // a step down
  else if(r>.585){                                         // the film: dark base, perforations, frames
    float fr=floor((la+PI)/(PI/6.));
    vec3 fb=mix(vec3(.085,.062,.045),vec3(.05,.07,.08),hash(vec2(fr,2.)));
    col=fb*(.6+.5*clamp(envD(vec3(0.,0.,1.),t),0.,1.4))+.05*envD(reflect(-v,vec3(0.,0.,1.)),t);
    float s=PI/24., pi=floor(la/s+.5), pa=abs(la-pi*s)*r;
    float hole=min(sdRBox(vec2(pa,r-.62),vec2(.013,.011),.004),sdRBox(vec2(pa,r-.825),vec2(.013,.011),.004));
    col=mix(col,base*(.35+.25*clamp(envD(vec3(0.,.3,1.),t),0.,1.4)),smoothstep(aa,-aa,hole));
    float fl=abs(mod(la+PI,PI/6.)-PI/12.)*r;                   // frame lines
    col+=vec3(.10,.09,.08)*smoothstep(.004+aa,.004,abs(fl-PI/12.*r))*step(.655,r)*step(r,.79);
    col*=1.-.4*smoothstep(.83,.86,r)-.3*smoothstep(.615,.585,r);
    gRec=.45;
  } else if(r>.56){ col=dLit(normalize(vec3(rq*1.4,1.)),base,v,t,0.,rq); }    // the film channel's inner wall
  else { col=dBezel(rq,r/RS,.56/RS,base,v,t); gRec=.4; st=dSeat(p/RS,r/RS,p/RS,aa/RS,t,base,v); }
  return dDone(col,r,aa,st);
}
#endif
#if DSH==7
// 5. ORBIT: the 3D viewport's gizmo. Three orbit rings round the seat, X red, Y green, Z blue enamel at their ends.
vec4 dOrbit(vec2 p, float r, float aa, float t){
  vec3 base=dBase(), v=gV;
  vec2 rq=r>1e-4?p/r:vec2(1.,0.);
  vec3 col; vec4 st=vec4(0.); gRec=.15;
  const float RS=.31, EA=.78, EB=.40;
  if(r<RS*1.16){ col=dBezel(rq,r/RS,1.16,base,v,t); gRec=.4; st=dSeat(p/RS,r/RS,p/RS,aa/RS,t,base,v); return dDone(col,r,aa,st); }
  col=r>.90?dLit(dBead(rq,r,.90),base,v,t,0.,rq):dLit(vec3(rq*.05,1.),base,v,t,.25,rq);
  // the rings: the nearest of three ellipses
  float bd=9.; vec2 bg=vec2(0.,1.);
  for(int i=0;i<3;i++){
    float ang=PI*.5+float(i)*2.0944;
    vec2 q=rot(ang)*p;
    vec2 qa=q/vec2(EA,EB); float l=length(qa);
    vec2 gr=q/vec2(EA*EA,EB*EB)/max(l,1e-4);
    float d=(l-1.)/max(length(gr),1e-4);
    if(abs(d)<abs(bd)){ bd=d; bg=rot(-ang)*normalize(gr+1e-6); }
  }
  float w=.032, x=bd/w;
  if(abs(bd)<w+aa){
    float h=sqrt(max(1.-x*x,.06));
    col=mix(col,dLit(normalize(vec3(bg*clamp(x,-1.,1.)/h*.9,1.)),base,v,t,0.,rq)*1.05,smoothstep(w+aa,w-aa,abs(bd)));
  } else if(r<=.90) col*=1.-.35*smoothstep(w*2.6,w,abs(bd));
  // the axis caps: enamel spheres
  for(int i=0;i<3;i++){
    float ang=PI*.5+float(i)*2.0944;
    vec2 c=vec2(cos(ang),sin(ang))*EA;
    vec2 dq=(p-c)/.075; float dd=dot(dq,dq);
    vec3 ec=i==0?vec3(.12,.36,1.):i==1?vec3(.10,.75,.22):vec3(1.,.16,.12);   // Z blue at the top, Y green, X red
    if(dd<1.3){
      float on=smoothstep(1.+aa*14.,1.-aa*14.,dd);
      vec3 n=normalize(vec3(dq,sqrt(max(1.-dd,0.))));
      vec3 en=ec*(.18+.6*clamp(envD(n,t),0.,1.4))+.08*envD(reflect(-v,n),t);
      col=mix(col*(1.-.4*smoothstep(1.3,1.,dd)),en,on);
    }
  }
  return dDone(col,r,aa,st);
}
#endif
vec4 dAny(vec2 p, float r, float aa, float t){
#if DSH==3
  return dIris(p,r,aa,t);
#elif DSH==4
  return dLayers(p,r,aa,t);
#elif DSH==5
  return dSheet(p,r,aa,t);
#elif DSH==6
  return dReel(p,r,aa,t);
#else
  return dOrbit(p,r,aa,t);
#endif
}
#endif
#ifndef NO_MAIN
void main(){
  float S=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/(.5*S)*1.04;
  float r=length(p);
  float aa=2./S*1.04;
  float t=uTime+uSeed;
#ifdef F_DESIGN
  {
    gV=normalize(vec3(-p*.3+uTilt*.9,1.));
    vec4 c=dAny(p,r,aa,t);
    c.rgb=aged(c.rgb,c.a,p,gRec,1.,1.,aa);
    if(uKind>2.5){                                       // Emulsion: open inside the outer ring, a dark lip at the opening
      float hr=uShape<3.5?.835:uShape<4.5?.80:uShape<5.5?.88:uShape<6.5?.86:.88;
      c.rgb*=1.-.25*smoothstep(hr+.03,hr,r);
      c*=smoothstep(hr-aa,hr+aa,r);
    }
    gl_FragColor=c;
  }
#endif
#ifdef F_PLAQUE
  if(uShape>1.5){ gl_FragColor=vplaque(p,aa,t); return; }
  {
    if(uKind>1.5){ gl_FragColor=plaqueM(p,aa,t); return; }
    // radiant cut (the plaque-shaped stone): the brilliant's triangles and kites drawn into a rectangle with clipped corners
    vec2 q=abs(p);
    float g=max(max(q.x/PB.x,q.y/PB.y),(q.x+q.y)/(PB.x+PB.y-.30));
    float an=atan(p.y/PB.y,p.x/PB.x);
    gl_FragColor=brill(g*vec2(cos(an),sin(an)),g,aa*1.3,t,p,-1.);
  }
#endif
#ifdef F_ROUND
  if(r>1.+aa){ gl_FragColor=vec4(0.); return; }
#ifdef NO_BRILL
  vec4 c=medal(p,r,aa,t);
#else
  vec4 c=uKind>1.5?medal(p,r,aa,t):lensFlat(p,r,aa,t);
#endif
  float rec=uKind>1.5 ? (uIconOn>0. && r<.83 ? icA(p) : 0.)+smoothstep(.1,0.,abs(r-.83))*.8+smoothstep(.62,.83,r)*step(r,.83)*.3+gRec : gRec;
  float fl=uKind>1.5?1.-.3*smoothstep(.5,1.,r):1.-.4*smoothstep(.93,.96,r);   // how flat it is here: dust slides off the steep parts
  if(uKind>1.5){
    fl=1.;
    if(r>.83){ float sl=cos(clamp((r-.83)/(.975-.83),0.,1.)*PI)*1.25; fl=1./sqrt(1.+sl*sl); }          // the flanks of the rim bead
    else if(uIconOn>0. && uWear.x>0.){ float e=max(aa,.008); vec2 g=vec2(icA(p+vec2(e,0.))-icA(p-vec2(e,0.)),icA(p+vec2(0.,e))-icA(p-vec2(0.,e))); fl=1./sqrt(1.+dot(g,g)*5.); }   // the walls of the engraving
  }
  c.rgb=aged(c.rgb,c.a,p,rec,fl,uKind>1.5?1.:0.,aa);
  gl_FragColor=c;
#endif
}
#endif
`;

  // metal colours (linear-ish reflectance): bronze, silver, gold, and platinum with the cool tint from the tier colour
  const METAL = { bronze: [0.86, 0.52, 0.30], silver: [0.93, 0.94, 0.97], gold: [1.0, 0.77, 0.33], platinum: [0.72, 0.93, 0.91], emu: [0.93, 0.93, 0.95] };
  const SHAPE = { round: 0, plaque: 1, award: 2, iris: 3, layers: 4, sheet: 5, reel: 6, orbit: 7 };
  const kindOf = (k) => (k === 'ruby' ? 1 : k === 'dia' ? 0 : k === 'emu' ? 3 : METAL[k] ? 2 : 0);   // 3: Emulsion's pearl housing (a ring, the bubble behind it)
  let rr = 0; const BUDGET = 7;   // ms of drawing per frame (the owner 11-24: no lags or freezes)
  let gl = null, gc = null, off = false, items = [], maxPx = 1, raf = 0, last = 0, io = null, t0 = 0, broken = false;
  let solo = null;
  const icons = new Map();   // icon key -> { tex, ok }
  const still = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let iconSrc = () => '';    // set by the page: icon name -> inner SVG markup (24x24, stroke)
  /* Speed (the owner 11-24: "very slow to load"). The shader is split in three: round badges, plaques, and the v6 design
     studies. Each part compiles only when a badge on screen needs it, in the background where the browser can
     (KHR_parallel_shader_compile); until then that badge just waits a frame or two. One huge program used to stall the page. */
  // the defines one badge needs: its family, and only the parts it draws (no brilliant for metals, no dust where nothing ages)
  const FAM = (it) => (it.shape >= 3 ? 'F_DESIGN,DSH ' + it.shape + ',NO_AGE' + (it.kind > 1.5 ? ',NO_BRILL' : '') : it.shape >= 1 ? 'F_PLAQUE' : 'F_ROUND' + (it.kind > 1.5 ? ',NO_BRILL' : ''));
  const progs = {}; let par = null, curP = null, vsh = null;
  const UN = ['uRes', 'uTime', 'uSeed', 'uKind', 'uIcon', 'uIconOn', 'uPx', 'uMetal', 'uShape', 'uDet', 'uDetOn', 'uTilt', 'uWear', 'uAge'];
  function setup() {
    if (gl || broken) return !!gl;
    try {
      off = typeof root.OffscreenCanvas === 'function' && typeof root.ImageBitmapRenderingContext === 'function';
      gc = off ? new root.OffscreenCanvas(64, 64) : document.createElement('canvas');
      gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
      if (!gl && off) { off = false; gc = document.createElement('canvas'); gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }); }
    } catch (e) { gl = null; }
    if (!gl) { broken = true; return false; }
    par = gl.getExtension('KHR_parallel_shader_compile');
    vsh = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vsh, VS); gl.compileShader(vsh);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    t0 = performance.now();
    if ('IntersectionObserver' in root) io = new IntersectionObserver((es) => es.forEach((e) => { const it = items.find((x) => x.c === e.target); if (it) it.vis = e.isIntersecting; }));
    return true;
  }
  /** The program for one family: queued on first use, ready once the browser says so (never a blocking status query before). */
  function prog(fam) {
    let e = progs[fam];
    if (!e) {
      const f = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(f, fam.split(',').map((x) => '#define ' + x + '\n').join('') + FS); gl.compileShader(f);
      const p = gl.createProgram(); gl.attachShader(p, vsh); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
      e = progs[fam] = { p, f, ready: false, bad: false, U: {} };
      if (par) { scheduleCheck(); return null; }
    }
    if (e.ready) return e;
    if (e.bad) return null;
    if (par && !gl.getProgramParameter(e.p, par.COMPLETION_STATUS_KHR)) { scheduleCheck(); return null; }
    if (!gl.getProgramParameter(e.p, gl.LINK_STATUS)) { console.info('[ACH] gem shader:', gl.getShaderInfoLog(e.f) || gl.getProgramInfoLog(e.p)); e.bad = true; return null; }
    for (const k of UN) e.U[k] = gl.getUniformLocation(e.p, k);
    gl.useProgram(e.p); gl.uniform1i(e.U.uIcon, 0); gl.uniform1i(e.U.uDet, 1); curP = e;
    e.ready = true;
    return e;
  }
  let chk = 0;
  function scheduleCheck() { if (chk) return; chk = setTimeout(() => { chk = 0; if (still()) draw(performance.now()); else if (!raf && items.length) raf = requestAnimationFrame(loop); }, 60); }
  /** Award plaques: everything etched on the plate (the badge icon small and thin in the pocket, the text lines, the
      app's mark + name at the bottom), drawn white on a clear canvas (1024 px for the full view, 512 / 256 for smaller badges) and used as one texture (mipmapped). */
  const MARK_LINES = 'M12 3.2l7.4 3-7.4 3-7.4-3zM4.6 9.6l7.4 3 7.4-3M4.6 12.6l7.4 3 7.4-3', MARK_PLAY = '';   // the Layers mark
  function detail(it) {
    const key = [it.icon, it.pre, it.title, it.line, it.sub, it.kind].join('|');
    if (it.det && it.det.key === key) return it.det;
    const rec = { key, tex: it.det && it.det.tex, ok: !!(it.det && it.det.ok) };
    it.det = rec;
    const N = it.px >= 400 ? 1024 : it.px >= 160 ? 512 : 256, P = (x, y) => [(x / 1.04 * 0.5 + 0.5) * N, (0.5 - y / 1.04 * 0.5) * N], U = (h) => h / 2.08 * N;
    const font = '"Chakra Petch", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
    const paint = (img) => {
      if (rec !== it.det) return;
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const fit = (txt, h, w, weight) => { let s = U(h); x.font = `${weight} ${s}px ${font}`; while (x.measureText(txt).width > U(w) && s > 8) { s -= 1; x.font = `${weight} ${s}px ${font}`; } };
      const text = (txt, y, h, weight) => { if (!txt) return; fit(txt, h, it.kind > 1.5 ? 1.2 : 0.86, weight); const [cx, cy] = P(0, y); x.fillText(txt, cx, cy); };
      if (img && it.kind > 1.5) { const s = U(0.27); const [cx, cy] = P(0, 0.40); x.drawImage(img, cx - s / 2, cy - s / 2, s, s); }
      text(it.pre, 0.03, 0.058, 500);
      text(it.title, -0.08, 0.092, 700);
      text(it.line, -0.19, 0.056, 500);
      text(it.sub, -0.28, 0.05, 500);
      // the app's mark (round, the mark knocked out: MARK_LINES / MARK_PLAY) and the app's name (window.ACHApp)
      x.font = `700 ${U(0.085)}px ${font}`;
      const name = (root.ACHApp || 'Your App'), tw = x.measureText(name).width, R = U(0.055), gap = U(0.03), w = R * 2 + gap + tw;
      const [lx, ly] = P(0, it.kind > 1.5 ? -0.74 : -0.6);   // stone plaques: above the pavé
      const mx = lx - w / 2 + R;
      x.beginPath(); x.arc(mx, ly, R, 0, Math.PI * 2); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out'; x.translate(mx - R, ly - R); x.scale(R * 2 / 24, R * 2 / 24);
      x.lineWidth = 2; x.lineCap = 'round'; x.stroke(new Path2D(MARK_LINES)); x.fill(new Path2D(MARK_PLAY)); x.restore();
      x.textAlign = 'left'; x.fillText(name, mx + R + gap, ly + U(0.004));
      try {
        rec.tex = rec.tex || gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, rec.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
        rec.ok = true; it.fresh = true;
        if (still()) draw(performance.now());
      } catch (e) { /* plain plate */ }
    };
    const go = () => {
      if (!it.icon) return paint(null);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256" fill="none" stroke="#fff" color="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${iconSrc(it.icon) || ''}</svg>`;
      const img = new Image();
      img.onload = () => paint(img); img.onerror = () => paint(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go); else go();
    return rec;
  }
  /** The icon as a texture: its SVG drawn white on a 512 px canvas (an SVG data image never taints the canvas), mipmapped.
      The edge is softened to ~4 texels so the engraved walls keep the width tuned at 128 px, without texel steps in the full view. */
  function icon(name) {
    if (icons.has(name)) return icons.get(name);
    const rec = { tex: null, ok: false };
    icons.set(name, rec);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" fill="none" stroke="#fff" color="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSrc(name) || ''}</svg>`;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512;
        const x = c.getContext('2d');
        if ('filter' in x) x.filter = 'blur(1.4px)';
        x.drawImage(img, 0, 0, 512, 512);
        rec.tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rec.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        rec.ok = true;
        for (const it of items) if (it.icon === name) it.fresh = true;
        if (still()) draw(performance.now());
      } catch (e) { /* plain stone */ }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return rec;
  }
  function draw(now) {
    const t = still() ? 9 : (now - t0) / 3000;   // a third of real time: calm (the owner 11-22)
    const ageV = root.ACHAgeVec ? root.ACHAgeVec() : null;
    const n = items.length, tA = performance.now(), budget = still() ? 1e9 : BUDGET;
    let drew = 0, U = null;
    for (let j = 0; j < n; j++) {
      const it = items[(rr + j) % n];
      if (solo && it.c !== solo) continue;
      if (drew && performance.now() - tA > budget) { rr = (rr + j) % n; return; }   // out of time (new badges too): the rest go next frame   // out of time: the rest go next frame            // full view open: only the big one draws, the rest hold still
      if (!it.vis && !it.fresh) continue;
      const P = prog(FAM(it));
      if (!P) continue;                                   // its shader is still compiling: draw it once it is ready
      if (curP !== P) { gl.useProgram(P.p); curP = P; }
      U = P.U;
      it.fresh = false;
      if (off && (gc.width !== it.px || gc.height !== it.px)) { gc.width = it.px; gc.height = it.px; }
      gl.viewport(0, 0, it.px, it.px);
      gl.uniform2f(U.uRes, it.px, it.px); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uSeed, it.seed); gl.uniform1f(U.uKind, it.kind); gl.uniform1f(U.uPx, it.px); gl.uniform3fv(U.uMetal, METAL[it.metal] || METAL.gold); gl.uniform1f(U.uShape, it.shape); gl.uniform2f(U.uTilt, it.tilt[0], it.tilt[1]); gl.uniform3f(U.uWear, it.wear[0], it.wear[1], it.wear[2] || 0); if (U.uAge && ageV) gl.uniform4fv(U.uAge, ageV);
      const dt = it.shape === 2 ? detail(it) : null;
      gl.uniform1f(U.uDetOn, dt && dt.ok ? 1 : 0);
      if (dt && dt.ok) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dt.tex); gl.activeTexture(gl.TEXTURE0); }
      const ic = it.icon ? icon(it.icon) : null;
      gl.uniform1f(U.uIconOn, ic && ic.ok ? 1 : 0);
      if (ic && ic.ok) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ic.tex); }
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
    if (!document.hidden && (!document.documentElement.hasAttribute('data-ach-hold') || solo) && now - last > 12) { draw(now); last = now; }   // holds still under a full view   // 60 fps (the owner 11-21: 30 felt laggy)
    if (!still()) raf = requestAnimationFrame(loop);
  }
  /** Start every canvas.ach-gemgl under `scope` that is not running yet. */
  function mount(scope) {
    const list = Array.from((scope || document).querySelectorAll('canvas.ach-gemgl:not([data-live])'));
    if (!list.length) return 0;
    if (!setup()) { list.forEach((c) => { c.dataset.live = '0'; if (c.parentElement) c.parentElement.classList.add('is-nogl'); }); return 0; }
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    for (const c of list) {
      const css = parseFloat(c.getAttribute('data-size')) || c.clientWidth || 40;
      const px = Math.max(16, Math.round(css * Math.min(dpr, parseFloat(c.dataset.dpr) || 2)));
      c.width = px; c.height = px; c.dataset.live = '1';
      if (c.parentElement) c.parentElement.classList.add('is-gl');
      maxPx = Math.max(maxPx, px);
      items.push({ c, ctx: c.getContext(off ? 'bitmaprenderer' : '2d'), px, kind: kindOf(c.dataset.kind), metal: c.dataset.kind, shape: SHAPE[c.dataset.shape] || 0, icon: c.dataset.icon || '', pre: c.dataset.pre || '', title: c.dataset.title || '', line: c.dataset.line || '', sub: c.dataset.sub || '', tilt: [0, 0], wear: [0, 0, 0], det: null, seed: (items.length % 7) * 5.1, vis: true, fresh: true });
      if (io) io.observe(c);
    }
    items.sort((a, b) => a.px - b.px); rr = 0;
    if (!off && (gc.width !== maxPx || gc.height !== maxPx)) { gc.width = maxPx; gc.height = maxPx; }
    if (still()) draw(performance.now());
    else if (!raf) raf = requestAnimationFrame(loop);
    return list.length;
  }
  /** Change a running stone: { icon, kind }. */
  function set(c, o) {
    const it = items.find((x) => x.c === c);
    if (!it) return false;
    if (o.icon !== undefined) { it.icon = o.icon || ''; c.dataset.icon = it.icon; }
    if (o.kind) { it.kind = kindOf(o.kind); it.metal = o.kind; c.dataset.kind = o.kind; }
    if (o.shape !== undefined) { it.shape = SHAPE[o.shape] || 0; c.dataset.shape = o.shape; }
    if (o.tilt) it.tilt = [+o.tilt[0] || 0, +o.tilt[1] || 0];
    if (o.wear) it.wear = [+o.wear[0] || 0, +o.wear[1] || 0, +o.wear[2] || 0];
    for (const k of ['pre', 'title', 'line', 'sub']) if (o[k] !== undefined) it[k] = o[k];
    it.fresh = true;
    if (still()) draw(performance.now());
    return true;
  }
  /** Draw only this canvas (the full view), at full frame rate; null = back to all. */
  function only(c) { solo = c || null; items.forEach((it) => { it.fresh = true; }); if (still()) draw(performance.now()); else if (!raf && items.length) raf = requestAnimationFrame(loop); }
  const api = { mount, set, only, icons: (fn) => { iconSrc = fn; root.ACHIconSrc = fn; }, supported: () => setup() };
  /** Age look (the full view's "Tune the age" sliders). Shader part goes to uAge[4]; the rest drives the wear clock and motion. */
  root.ACHAgeDefaults = { dustAmt: 2, dustPatch: 1, dustUp: 1, dull: 1, grit: 1.5, lint: 1.29, webAmt: 1.3, webThreads: 1.4, webWidth: 1.42, webGlint: .65, webSheet: .3, webDust: 1.6, webRainbow: .19,
    dustDays: 527, webStart: 20, webSpan: 330, rubDust: .3, sway: .33, hover: .33, flick: 1, friction: 2.2 };
  root.ACHAge = Object.assign({}, root.ACHAgeDefaults, root.ACHAge || {});
  root.ACHAgeVec = () => { const a = root.ACHAge; return new Float32Array([a.dustAmt, a.dustPatch, a.dustUp, a.dull, a.grit, a.lint, a.webAmt, a.webThreads, a.webWidth, a.webGlint, a.webSheet, a.webDust, a.webRainbow, 0, 0, 0]); };
  root.ACHWearGLSL = `
// ---- age: dust and cobwebs (uWear = dust, unused, cobweb, 0..1). 1 real hour = 1 day on the shelf; polishing removes it.
// Dust is grains, not a film: a few grains first, more as it builds, until they join into a grainy grey layer (a year).
// It lies thick on flat surfaces and piles up in hollows (the engraving, the groove under the rim); steep walls stay
// almost clean and glossy; the top gets it before the bottom. Each grain is lit from the top left. Lint fibres lie on top.
// Cobweb: it grows, it never scales. Every thread has a fixed place and a birth time (from a hash); time only reveals
// them: first a few hair-thin threads from the rim, then more between them, drop lines with beads, then torn gauze
// sheets between the ropes and the rim. Dust thickens the threads into grey furry ropes and makes them sag.
// uWear.x = dust (the clock already applied the dust amount), .y = this medal's seed, .z = cobweb age.
// uAge = the tuner (ACHAge): [0] (dust amount: used by the clock), patchiness, top first, hides reflections; [1] grit, lint, web amount,
// how many threads; [2] thread thickness, glint, gauze, dust on silk; [3] rainbow.
uniform vec3 uWear;
uniform vec4 uAge[4];
float wS, wC;   // this medal's seed (uWear.y, from its id) and the angle its cobweb hangs at: every medal gets its own web and dust
float wN(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y); }
float wF(vec2 p){ return .5*wN(p)+.25*wN(p*2.03+3.1)+.125*wN(p*4.01+7.7); }
vec2 wSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return vec2(length(pa-ba*h),h); }
// short curled fibres, one per cell of size 1/sc. dens = how many of them exist yet (each has its own fixed place).
float wHair(vec2 p, float sc, float w, float aa, float dens){
  if(dens<=.001) return 0.;   // none yet: skip the 9 cells
  vec2 q=(p+(vec2(wN(p*11.+2.),wN(p*11.+8.))-.5)*.07)*sc, id=floor(q);
  float m=0.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 c=id+vec2(float(i),float(j));
    if(hash(c+13.7)<dens){
      vec2 o=c+vec2(hash(c+3.1),hash(c+5.3));
      float an=hash(c+7.9)*3.1416;
      vec2 dir=vec2(cos(an),sin(an))*(.25+.45*hash(c+11.));
      float d=wSeg(q,o-dir,o+dir).x/sc;
      m=max(m,(1.-smoothstep(max(w-aa,0.)*.4,w+aa,d))*(.5+.5*hash(c+17.)));
    }
  }
  return m*min(1.,w*2.4/(aa*1.5+1e-4));
}
// rope i of the web: where it is tied (a on the rim; b on the rim for even i, on the face for odd i) and how far it sags
void wRope(float i, float G, out vec2 a, out vec2 b, out float sg){
  float sd=wS*61.7, h1=hash(vec2(i*1.31+.7+sd,2.9)), h2=hash(vec2(i*2.17+4.1,7.3+sd)), h3=hash(vec2(i*.73+9.2+sd,1.1));
  float a1=wC-1.175+2.35*fract(i*.381966+.13+wS*.37);
  a=vec2(cos(a1),sin(a1))*.955;
  float a2=clamp(a1+(h1>.5?1.:-1.)*(.6+.8*h2),wC-1.425,wC+1.425);
  vec2 f=vec2(-.55+.7*h1,.6-.7*h2); float r0=wC-2.175, cs=cos(r0), sn=sin(r0);
  b=mod(i,2.)<.5 ? vec2(cos(a2),sin(a2))*.955 : vec2(f.x*cs-f.y*sn,f.x*sn+f.y*cs);
  sg=(.05+.11*h3)*length(b-a)*(.5+.9*clamp((G-i*.055)*1.2,0.,1.));   // dust loads it: it sags more with age
}
// the point at t along rope i
vec2 wOn(float i, float t, float G){
  vec2 a,b; float sg; wRope(i,G,a,b,sg);
  vec2 cu=normalize(b-a), nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
  return mix(a,b,t)+nn*sg*4.*t*(1.-t);
}
// one thin sagging thread from a to b: uneven width, beads of dust, a soft fuzz. grow: 0..1+ how much of it is spun yet.
float wLine(vec2 p, vec2 a, vec2 b, float sg, float w, float aa, float seed, float grow, float fuzz){
  vec2 ch=b-a; float L=length(ch); vec2 cu=ch/L, nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
  float u=dot(p-a,cu)/L, h=dot(p-a,nn);
  float uc=clamp(u,0.,1.), s=sg*4.*uc*(1.-uc), ds=sg*4.*(1.-2.*uc)/L;
  float d=abs(h-s)/sqrt(1.+ds*ds);
  if(u<-.03||u>1.03||d>w*9.+aa*3.) return 0.;
  float ww=w*(.55+.9*wN(vec2(uc*L*26.,seed)))*(1.+1.6*smoothstep(.78,.95,wN(vec2(uc*L*64.,seed+3.))));
  float core=(1.-smoothstep(max(ww-aa,0.)*.4,ww+aa,d))*min(1.,ww*2.4/(aa*1.5+1e-4));
  float halo=(1.-smoothstep(0.,ww*4.5+aa*2.,d))*.22*fuzz*(.6+.8*wN(p*110.+seed));
  return max(core,halo)*smoothstep(-.02,.01,u)*(1.-smoothstep(.99,1.02,u))*(1.-smoothstep(grow-.08,grow,uc));
}
// the cobweb: rgb = its light (premultiplied, never above a), a = how much it covers
vec4 wWeb(vec2 p, float amt, float dust, float aa){
  if(amt<=.001 || dot(p,vec2(cos(wC),sin(wC)))<-.5) return vec4(0.);   // it lives on this medal's upper side (left, top or right)
  float G=min(amt,1.3), keep=.75*uAge[1].w, W=uAge[2].x;
  float rope=0., fine=0., gz=0., shd=0.;
  float thrH=.24+.18*smoothstep(.55,1.,G);                      // old gauze tears: the holes only grow
  for(int i=0;i<8;i++){
    float fi=float(i), age=G-fi*.055;
    if(age>0. && (i<2 || hash(vec2(fi+wS*53.,3.3))<keep)){
      vec2 a,b; float sg; wRope(fi,G,a,b,sg);
      vec2 ch=b-a; float L=length(ch); vec2 cu=ch/L, nn=vec2(-cu.y,cu.x); if(dot(nn,vec2(.35,-1.))<0.) nn=-nn;
      float u=dot(p-a,cu)/L, h=dot(p-a,nn);
      if(u>-.03 && u<1.03){
        float uc=clamp(u,0.,1.), s=sg*4.*uc*(1.-uc), ds=sg*4.*(1.-2.*uc)/L;
        float e=h-s, d=abs(e)/sqrt(1.+ds*ds);
        float w=(i<2?.016:.006+.008*hash(vec2(fi+wS*53.,8.8)))*W*(.12+.88*smoothstep(0.,.6,age))*(.6+.6*dust*uAge[2].w);
        shd=max(shd,(1.-smoothstep(0.,w*5.+.01,abs(e-.014-w)))*smoothstep(-.02,.03,u)*(1.-smoothstep(.97,1.02,u))*min(age*8.,1.));   // its soft shadow on the medal
        if(d<w*9.+aa*3.){
          float ww=w*(.55+.9*wN(vec2(uc*L*26.,fi*7.+1.)))*(1.+1.6*smoothstep(.78,.95,wN(vec2(uc*L*64.,fi*5.+3.))));
          float dr=d+(wN(p*75.+fi*3.)-.5)*ww*1.3;                // a ragged, furry outline
          float core=(1.-smoothstep(ww*.25,ww*1.15+aa,dr))*min(1.,ww*2.4/(aa*1.5+1e-4))*(.62+.3*wN(vec2(uc*L*40.,e*160.)+fi));
          float halo=(1.-smoothstep(ww*.5,ww*3.4+aa*2.,dr))*.42*smoothstep(0.,.4,age)*(.35+1.1*wN(p*130.+fi));   // fur
          rope=max(rope,max(core,halo)*smoothstep(-.02,.01,u)*(1.-smoothstep(.99,1.02,u))*(1.-smoothstep(age/.07-.08,age/.07,uc)));
        }
        float gage=age-.2-.2*hash(vec2(fi+wS*53.,6.1));               // gauze: later, on the rim-to-rim ropes
        if(gage>0. && u>0. && u<1.){
          float skirt=(.03+.16*wF(vec2(uc*L*6.,fi*3.+2.)))*min(gage*3.,1.);   // a ragged hem hangs below the rope
          float reg=e<0. ? (mod(fi,2.)<.5 ? smoothstep(0.,.05,.955-length(p)) : 0.) : 1.-smoothstep(skirt*.3,skirt,e);
          if(reg>0.){
            float holes=smoothstep(thrH-.12,thrH+.1,wF(p*5.5+fi*3.7+wS*9.));
            float fibre=(.55+.45*wN(vec2(uc*L*9.+fi,e*85.)))*(.7+.3*wN(p*70.));
            gz=max(gz,reg*holes*(.4+.6*fibre)*smoothstep(0.,.35,gage)*smoothstep(0.,.05,uc)*(1.-smoothstep(.95,1.,uc)));
          }
        }
      }
    }
  }
  for(int k=0;k<12;k++){                                       // fine threads from rope to rope
    float fk=float(k);
    float ia=floor(hash(vec2(fk+wS*53.,1.2))*7.99), ib=mod(ia+1.+floor(hash(vec2(fk+wS*53.,2.6))*2.99),8.);
    float age=G-max(.08+.065*fk,max(ia,ib)*.055+.03);
    if(age>0. && hash(vec2(fk+wS*53.,4.4))<keep && (ia<1.5||hash(vec2(ia+wS*53.,3.3))<keep) && (ib<1.5||hash(vec2(ib+wS*53.,3.3))<keep)){
      vec2 a=wOn(ia,.15+.7*hash(vec2(fk+wS*53.,5.5)),G), b=wOn(ib,.15+.7*hash(vec2(fk+wS*53.,6.6)),G);
      float m=wLine(p,a,b,.03*length(b-a),.0017*W*(.45+.55*smoothstep(0.,.5,age)),aa,fk*3.1,age/.06,smoothstep(0.,.5,age));
      if(G>.8 && hash(vec2(fk+wS*53.,9.9))>.7){ float u=wSeg(p,a,b).y; m*=smoothstep(.0,.1,abs(u-.5)-.1*smoothstep(.8,1.,G)); }   // an old one snaps
      fine=max(fine,m);
    }
  }
  for(int k=0;k<6;k++){                                        // drop lines hanging from the ropes, beaded with dust
    float fk=float(k), ia=floor(hash(vec2(fk+wS*53.,11.2))*7.99);
    float age=G-max(.05+.08*fk,ia*.055+.02);
    if(age>0. && hash(vec2(fk+wS*53.,14.4))<keep && (ia<1.5||hash(vec2(ia+wS*53.,3.3))<keep)){
      vec2 a=wOn(ia,.2+.6*hash(vec2(fk+wS*53.,15.5)),G);
      vec2 b=a+vec2((hash(vec2(fk+wS*53.,16.6))-.5)*.1,-(.09+.2*hash(vec2(fk+wS*53.,17.7))));
      fine=max(fine,wLine(p,a,b,.004,.0016*W*(.45+.55*smoothstep(0.,.5,age)),aa,fk*5.3+40.,age/.05,smoothstep(0.,.5,age)));
    }
  }
  float gza=clamp(gz*uAge[2].z*2.3,0.,.8);
  float al=clamp(max(rope,fine*.5)+gza*(1.-rope),0.,.94);
  vec3 silk=vec3(.86,.85,.83), dusty=vec3(.70,.69,.66);
  float lit=.86+.14*smoothstep(-1.,1.,p.y)+.12*uAge[2].y*fine*(1.-dust*.6)-.14*gza*(1.-rope);   // fresh silk glints; dusty silk does not
  vec3 rgb=mix(silk,dusty,clamp(uAge[2].w*(.45+.55*dust),0.,1.))*al*lit
          +uAge[3].x*max(rope,fine)*(1.-dust)*.3*(.5+.5*cos(6.283*(p.x*5.+p.y*3.+vec3(0.,.33,.67))));
  return vec4(min(rgb,vec3(al)),al+(1.-al)*max(shd*.4,gza*.15));
}
// age a (premultiplied) colour. p: on the face (radius 1, +y up). recess: how sheltered (dust piles up there).
// flt: 1 on a flat surface, lower on a steep wall (dust slides off). metal: 1 metal, 0 stone.
vec3 aged(vec3 col, float a, vec2 p, float recess, float flt, float metal, float aa){
  float dust=min(uWear.x,1.), web=uWear.z*uAge[1].z;
  wS=uWear.y; wC=2.175+(wS-.5)*2.;   // upper left on average; from the top right to the left side
  vec2 ps=p+wS*vec2(3.7,5.3);         // this medal's own dust pattern
  if(dust+web<.002 || a<=0.) return col;
  float rc=min(recess,1.);
  // how much has settled here: the top first (the bottom's share = dust^(1+2*how low)), little on steep walls, more in hollows
  float low=1.-smoothstep(-1.,1.,p.y+(wF(p*2.5+3.)-.5)*.3);
  float dl=pow(max(dust,1e-4),1.+2.*low*uAge[0].z);
  float wall=1.-smoothstep(.72,.97,flt);
  float T=dl*mix(1.,mix(.05,.7,dl*dl),wall)*(1.+1.3*rc);
  float Tc=min(T,1.);
  // grains: clumps, coarse grains, fine grains. A grain is there once the layer passes its own threshold, so more dust =
  // more grains (none ever moves). Small tiles cannot show the fine ones (f1, f2 fade them out: no shimmer).
  float f1=clamp(2.-aa*38.,0.,1.), f2=clamp(2.-aa*95.,0.,1.), f3=clamp(1.6-aa*170.,0.,1.);
  float clump=wF(ps*4.3+11.)/.875;
  float g1=wN(ps*38.+1.), g2=wN(ps*95.+7.), g3=wN(ps*170.+4.);
  float n=mix(.5,clump,uAge[0].y)*.42+mix(.5,g1,f1)*.2+mix(.5,g2,f2)*.24+mix(.5,g3,f3)*.14;
  float thr=.80-.72*Tc;
  float cov=smoothstep(thr-.03,thr+.05,n)*smoothstep(0.,.04,T);
  float thick=smoothstep(0.,.3,n-thr);
  vec2 Ld=vec2(-.6,.8)*.006;                                  // towards the light
  float sh=clamp(1.+((g1-wN((ps+Ld)*38.+1.))*.35*f1+(g2-wN((ps+Ld*.5)*95.+7.))*.65*f2)*1.1,.78,1.22);
  // a thin layer: the mirror goes hazy (dust scatters the light), the colour still shows through
  float mx=max(max(col.r,col.g),max(col.b,.001));
  vec3 matte=(col/mx*(.17+.07*smoothstep(-1.,1.,p.y))+vec3(.15,.145,.135))*a*(1.-.12*rc);
  col=mix(col,matte,smoothstep(0.,.6,T)*uAge[0].w);
  // the grains themselves: light grey, each a little different, lit from the top left; dark specks and pale grains
  vec3 dc=vec3(.60,.585,.55);
  float tone=(.50+.10*smoothstep(-1.,1.,p.y)+.16*thick)*(.80+.22*mix(.5,g2,f2)+.22*mix(.5,g3,f3)+.25*(clump-.5)+.3*(wF(ps*13.+2.)-.44))*sh*(1.-.18*rc);
  vec3 dustc=dc*tone;
  dustc*=1.-.5*smoothstep(.86,.95,wN(ps*150.+3.))*f2*uAge[1].x;
  dustc+=dc*.22*smoothstep(.9,.97,wN(ps*60.+9.))*f1*uAge[1].x;
  col=mix(col,dustc*a,cov*(.45+.52*thick));
  // lint: long fibres lie anywhere (on clean metal too), short fuzz grows in the thick dust
  float lint=wHair(ps,8.,.0022,aa,.4*smoothstep(.05,.7,dl)*uAge[1].y);
  float fuzz=wHair(ps+5.3,19.,.0017,aa,.8*smoothstep(.3,.9,T)*uAge[1].y);
  col=mix(col,vec3(.72,.71,.68)*a,lint*.5);
  col=mix(col,vec3(.70,.69,.66)*a,fuzz*.4);
  vec4 wb=wWeb(p,web,dust,aa);
  col=col*(1.-wb.a)+wb.rgb*a;
  return col;
}
`;
  root.ACHGem = api;
  root.ACHGemFS = FS;   // the 3D full view builds the v6 designs from this same code
})(typeof window !== 'undefined' ? window : globalThis);



// ES module entry for the app (the file above is the Achievements Lab source, unchanged)
export default (typeof window !== 'undefined' ? window : globalThis).ACHGem;

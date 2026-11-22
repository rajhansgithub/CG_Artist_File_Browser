/* Live materials for earned tiers 1-6 (CG Artist File Browser theme: the lens iris medal, docs/ACHIEVEMENTS.md).
   Ported line by line from the Emulsion Labs reference (achievements plugin, reference/gem.js): same studio lights, same metal
   and gem maths (env, envM, inner, brill, stoneTri). This app adds data-shape="iris" (shape 3): a struck medal whose face is a
   camera iris, six aperture blades round a hexagonal opening, the badge icon frosted in the opening and the app's name
   engraved round the polished rim. Diamond / Ruby: gunmetal blades, the rim one carved piece of the stone, a round brilliant
   seen through the opening. The reference's other shapes (round, plaque, award) stay for reference.

   Reference notes follow. */
/* Live materials for earned tiers 1-6 (the owner 2026-11-21: "make them realistic with js", then award plaques like a real
   creator award, "Playlist Pro" in place of the platform's name).
   One shared WebGL context draws every <canvas class="ach-gemgl" data-kind="bronze|silver|gold|platinum|dia|ruby" data-icon="...">.
   data-shape="award" (what the Manager uses): a standing plaque. Metals (1-4): the whole plaque is the metal, chamfered edge,
   brushed face, a recessed mirror pocket with the badge icon small and thin in it. Diamond / Ruby (5-6): a dark plate framed by one
   carved piece of diamond / ruby (small triangular facets, wavy inside and outside edge) with a radiant-cut stone set on the plate
   (no etching on the stones: the owner 11-21). Under the pocket the details are etched (data-pre / data-title / data-line / data-sub)
   and the Playlist Pro mark + name sit at the bottom; text only shows where it can be read (big badges, the full view).
   data-shape round / plaque: the older looks (round medal / round brilliant, flat plaque / radiant cut), kept for reference.
   The studio lights turn slowly; uTilt (YTPMGem.set(c, {tilt})) moves them with the full view's pointer tilt.
   60 fps. YTPMGem.only(canvas) draws only that canvas (the full view) while the rest hold still. data-dpr caps the pixel ratio.
   No network. Pauses off screen and in a hidden tab; one still frame with "reduce motion". No WebGL: the parent gets .is-nogl
   and the CSS/SVG material stays. */
const root = typeof window !== 'undefined' ? window : globalThis;
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `
precision highp float;
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
vec4 medal(vec2 p, float r, float aa, float t){
  vec3 base=uMetal;
  vec3 v=normalize(vec3(-p*.32+vec2(.06*sin(t*.5),.05*sin(t*.37+1.)),1.));   // a near camera: the light slides across the face
  vec2 rd=r>1e-4?p/r:vec2(1.,0.);
  vec3 n=vec3(0.,0.,1.);
  float RIM=.83;
  float rough=1.;
  if(r>RIM){
    float x=clamp((r-RIM)/(.975-RIM),0.,1.);
    float sl=cos(x*PI)*1.1;                        // rounded raised rim
    sl=mix(sl,-2.4,smoothstep(.972,.99,r));        // and a crisp outer edge
    n=normalize(vec3(-rd*sl,1.));
    rough=0.;
  } else {
    // spun face: very fine concentric rings
    float ring=sin(r*uPx*.9)*.5+.5;
    n=normalize(vec3(rd*(ring-.5)*.04,1.));
  }
  vec3 R=reflect(-v,n);
  float e=envM(R,t);
  // spun metal: a soft bright streak through the middle, lined up with the main light (anisotropic sheen)
  float la=t*.25+atan(.45,.5);
  vec2 L2=vec2(cos(la),sin(la));
  float sheen=pow(abs(dot(rd,L2)),14.)*smoothstep(.0,.25,r)*(1.-rough*0.)+.0;
  float la2=t*.25+atan(-.25,-.65);
  sheen+=.5*pow(abs(dot(rd,vec2(cos(la2),sin(la2)))),18.)*smoothstep(.0,.25,r);
  vec3 col;
  if(r>RIM){ col=base*e*1.25+vec3(e*e*.04); }
  else { col=base*(e*.85+sheen*.55*(1.-r*.3)); }
  // a fine groove where the rim meets the face
  float gr=smoothstep(aa*1.5,0.,abs(r-RIM));
  col*=1.-gr*.55;
  // engraved icon: sunken, sandblasted floor (matte) and polished walls that catch the light
  if(uIconOn>0. && r<RIM){
    float d=1.6/max(uPx,40.);
    float m=icA(p);
    float gx=icA(p+vec2(d,0.))-icA(p-vec2(d,0.));
    float gy=icA(p+vec2(0.,d))-icA(p-vec2(0.,d));
    if(m+abs(gx)+abs(gy)>0.){
      float grain=.82+.36*hash(floor(gl_FragCoord.xy));
      vec3 floorC=base*(.40+.14*envM(vec3(0.,0.,1.),t))*grain;
      col=mix(col,floorC,smoothstep(.15,.85,m));
      vec3 nw=normalize(vec3(vec2(gx,gy)*2.2,1.));
      float w=clamp(length(vec2(gx,gy))*1.6,0.,1.);
      float ew=envM(reflect(-v,nw),t);
      col=mix(col,base*ew*1.3,w*.9);
    }
  }
  float inside=smoothstep(1.+aa,1.-aa,r);
  col=1.-exp(-col*1.6);
  return vec4(col*inside,inside);
}
float segd(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
// ---- plaque shapes (the owner 2026-11-21: metals as plaques; Diamond and Ruby in a plaque-like cut) ----
uniform float uShape;
const vec2 PB=vec2(.97,.74);   // plaque half size (4:3)
float sdRBox(vec2 p, vec2 b, float rr){ vec2 q=abs(p)-b+rr; return length(max(q,0.))+min(max(q.x,q.y),0.)-rr; }
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
vec3 tilt(float c, float a){ return normalize(vec3(cos(c)*sin(a),sin(c)*sin(a),cos(a))); }
// the round brilliant, drawn in p (|p| = 1 at the girdle); p0 + ik: where and how big the etched icon is (ik 0 = fill the table)
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
// ---- vertical award plaque (the owner 2026-11-21, from his photo of a real creator award): a solid plate with a crisp chamfered
// edge, a recessed mirror pocket in the upper part with a small thin emblem (the badge icon), etched text under it and the
// Playlist Pro mark + name at the bottom (uDet: white-on-clear picture of everything etched). Metals: all metal.
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
    // etched text and the Playlist Pro mark: frosted (matte, lighter), fine walls. The light it catches is capped: a moving
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
// ---- lens iris medal (CG Artist File Browser theme, tiers 1-6): a struck medal whose face is a camera iris. Six aperture
// blades sweep in from the rim round a hexagonal opening; the badge icon sits raised and frosted in the opening; the rim is
// polished and raised, with the app's name engraved round it (uDet). Diamond / Ruby: gunmetal blades, the rim one carved
// piece of the stone (small triangular facets, wavy inside and outside line), and a round brilliant seen through the opening.
const float IRIM=.84, IAP=.36;
float hexD(vec2 p, float r){ p=abs(p); return max(dot(p,vec2(.8660254,.5)),p.y)-r; }
float ringSdf(vec2 p){
  float r=length(p);
  float ow=.975-.018*vn(p*4.1+vec2(2.,7.))-.01*vn(p*9.3+vec2(5.,1.));     // the outside line is wavy too
  float iw=.80-.035*vn(p*3.3+vec2(4.2,1.7))-.02*vn(p*8.1+vec2(9.1,3.3));  // and the inside line
  return max(r-ow, iw-r);
}
vec4 iris(vec2 p, float r, float aa, float t){
  bool stone=uKind<1.5;
  float ruby=uKind;
  vec3 base=stone?vec3(.13,.13,.15):uMetal;
  float outR=stone?.99:.975;
  if(r>outR+aa) return vec4(0.);
  float inside=smoothstep(outR+aa,outR-aa,r);
  vec3 v=normalize(vec3(-p*.32+uTilt*.9+vec2(.06*sin(t*.5),.05*sin(t*.37+1.)),1.));
  vec2 rd=r>1e-4?p/r:vec2(1.,0.);
  vec4 pv=vec4(0.);
  if(stone && r>.74){
    float sd=ringSdf(p);
    if(sd<aa){
      float e=1.5/max(uPx,40.);
      vec2 g=normalize(vec2(ringSdf(p+vec2(e,0.))-sd, ringSdf(p+vec2(0.,e))-sd)+1e-6);
      float ed;
      vec3 sc=stoneTri(p,-.02,g*smoothstep(-.06,0.,sd)*1.4,t,ruby,ed);
      sc+=mix(vec3(.5,.52,.58),vec3(.6,.15,.2),ruby)*smoothstep(-.012,-.002,sd);   // a bright line along the polished edge
      sc=1.-exp(-max(sc,0.)*mix(2.6,1.6,ruby));
      float a=smoothstep(aa,-aa,sd);
      pv=vec4(sc*a,a);
      if(a>=.999) return pv;
    }
  }
  float ang=atan(p.y,p.x);
  float dh=hexD(rot(.2618)*p,IAP);   // the opening, turned so its corners meet the blade edges
  vec3 col;
  if(!stone && r>IRIM){
    // polished raised rim, a crisp outer edge, the name engraved (sandblasted floor) where it can be read
    float x=clamp((r-IRIM)/(.975-IRIM),0.,1.);
    float sl=cos(x*PI)*1.1;
    sl=mix(sl,-2.4,smoothstep(.972,.99,r));
    vec3 n=normalize(vec3(-rd*sl,1.));
    float e=envM(reflect(-v,n),t);
    col=base*e*1.25+vec3(e*e*.04);
    float m=det(p)*smoothstep(90.,200.,uPx);
    if(m>0.){ float grain=.85+.3*hash(floor(gl_FragCoord.xy)); col=mix(col,base*(.42+.12*min(envM(vec3(0.,0.,1.),t),1.2))*grain,m*.9); }
  } else if(dh>0.){
    // the six blades: a spiral split, each blade lying over the next
    float tw=ang-1.25*(r-IAP)/(IRIM-IAP);
    float bi=floor(tw/(PI/3.)), f=fract(tw/(PI/3.));
    float bc=(bi+.5)*PI/3.+.6*(r-IAP);
    vec2 bd=vec2(cos(bc),sin(bc)), bt=vec2(-bd.y,bd.x);
    // each blade a flat plate tipped a touch (so each flashes at its own moment), brushed along its length
    float tip=.16+.05*hash(vec2(bi,4.2));
    float brush=(hash(vec2(floor(dot(p,bt)*uPx*.55),bi))-.5)*.035+sin(dot(p,bt)*uPx*1.1)*.012;
    vec3 n=normalize(vec3(bd*tip*.6+bt*(tip*(f-.5)*.5)+bd*brush,1.));
    float e=envM(reflect(-v,n),t);
    float la=t*.25+.7+uTilt.x*2.+bi*.4;
    float sh=exp(-pow(dot(p,vec2(cos(la),sin(la)))-.3*sin(t*.3+bi),2.)*5.);
    col=base*(e*(stone?.85:.7)+sh*.32+.05)+(stone?vec3(e*e*.03+sh*.02):vec3(0.));
    float ew=f*(PI/3.)*r;                                   // distance from the edge of the blade above
    col*=mix(.42,1.,smoothstep(0.,.07,ew));                 // its soft shadow
    col+=base*.5*smoothstep(aa*2.,0.,abs(ew-aa*1.5))*(stone?.6:1.);   // and a fine bright line on its edge
    col*=1.-.5*smoothstep(.02,0.,dh);                       // a dark gap round the opening
    col+=vec3(.22)*smoothstep(aa*2.,0.,abs(dh-.008));       // the blades' cut edge catching light
    if(!stone) col*=1.-smoothstep(aa*1.5,0.,abs(r-IRIM))*.55;   // groove where the rim starts
  } else {
    if(stone){
      // a round brilliant seen through the opening (the blades lie over its edge)
      float R=IAP*1.16;
      vec4 g=brill(p/R,r/R,aa/R*1.3,t,p,-1.);
      return pv+g*(1.-pv.a);
    }
    // metal: a recessed mirror-polished pocket, the badge icon raised and frosted in it
    float e2=1.5/max(uPx,40.);
    vec2 gp=normalize(vec2(hexD(rot(.2618)*(p+vec2(e2,0.)),IAP)-dh, hexD(rot(.2618)*(p+vec2(0.,e2)),IAP)-dh)+1e-6);
    float wall=smoothstep(-.035,-.02,dh);
    vec3 n=normalize(vec3(-gp*1.4*wall,1.));
    float e=envM(reflect(-v,n),t);
    col=base*(e*.9)*mix(.7,1.2,wall)+vec3(e*e*.05);
    if(uIconOn>0.){
      float m=icP(p,IAP*.82);
      if(m>0.){ float grain=.88+.24*hash(floor(gl_FragCoord.xy)); col=mix(col,(base*.7+vec3(.28))*(.8+.15*min(envM(vec3(.2,.5,1.),t),1.2))*grain,m*.95); }
    }
  }
  col=1.-exp(-max(col,0.)*1.6);
  vec4 pl=vec4(col*inside,inside);
  return pv+pl*(1.-pv.a);
}
void main(){
  float S=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/(.5*S)*1.04;
  float r=length(p);
  float aa=2./S*1.04;
  float t=uTime+uSeed;
  if(uShape>2.5){ gl_FragColor=iris(p,r,aa,t); return; }
  if(uShape>1.5){ gl_FragColor=vplaque(p,aa,t); return; }
  if(uShape>.5){
    if(uKind>1.5){ gl_FragColor=plaqueM(p,aa,t); return; }
    // radiant cut (the plaque-shaped stone): the brilliant's triangles and kites drawn into a rectangle with clipped corners
    vec2 q=abs(p);
    float g=max(max(q.x/PB.x,q.y/PB.y),(q.x+q.y)/(PB.x+PB.y-.30));
    float an=atan(p.y/PB.y,p.x/PB.x);
    gl_FragColor=brill(g*vec2(cos(an),sin(an)),g,aa*1.3,t,p,-1.); return;
  }
  if(r>1.+aa){ gl_FragColor=vec4(0.); return; }
  gl_FragColor=uKind>1.5?medal(p,r,aa,t):brill(p,r,aa,t,p,-1.);
}`;

  // metal colours (linear-ish reflectance): bronze, silver, gold, and platinum with the cool tint from the tier colour
  const METAL = { bronze: [0.86, 0.52, 0.30], silver: [0.93, 0.94, 0.97], gold: [1.0, 0.77, 0.33], platinum: [0.72, 0.93, 0.91] };
  const SHAPE = { round: 0, plaque: 1, award: 2, iris: 3 };
  const kindOf = (k) => (k === 'ruby' ? 1 : k === 'dia' ? 0 : METAL[k] ? 2 : 0);
  let gl = null, gc = null, off = false, U = {}, items = [], maxPx = 1, raf = 0, last = 0, io = null, t0 = 0, broken = false;
  let solo = null;
  const icons = new Map();   // icon key -> { tex, ok }
  const still = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let iconSrc = () => '';    // set by the page: icon name -> inner SVG markup (24x24, stroke)
  function setup() {
    if (gl || broken) return !!gl;
    try {
      off = typeof root.OffscreenCanvas === 'function' && typeof root.ImageBitmapRenderingContext === 'function';
      gc = off ? new root.OffscreenCanvas(64, 64) : document.createElement('canvas');
      gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
      if (!gl && off) { off = false; gc = document.createElement('canvas'); gl = gc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }); }
    } catch (e) { gl = null; }
    if (!gl) { broken = true; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.info('[achievements] gem shader:', gl.getShaderInfoLog(s)); return null; } return s; };
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    const pr = v && f && gl.createProgram();
    if (pr) { gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr); }
    if (!pr || !gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl = null; broken = true; return false; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['uRes', 'uTime', 'uSeed', 'uKind', 'uIcon', 'uIconOn', 'uPx', 'uMetal', 'uShape', 'uDet', 'uDetOn', 'uTilt']) U[k] = gl.getUniformLocation(pr, k);
    gl.uniform1i(U.uIcon, 0); gl.uniform1i(U.uDet, 1);
    t0 = performance.now();
    if ('IntersectionObserver' in root) io = new IntersectionObserver((es) => es.forEach((e) => { const it = items.find((x) => x.c === e.target); if (it) it.vis = e.isIntersecting; }));
    return true;
  }
  /** Award plaques: everything etched on the plate (the badge icon small and thin in the pocket, the text lines, the
      Playlist Pro mark + name at the bottom), drawn white on a clear canvas (1024 px for the full view, 512 / 256 for smaller badges) and used as one texture (mipmapped). */
  const MARK_LINES = 'M4 6h11M4 11h11M4 16h7', MARK_PLAY = 'M15 14.5v6l5-3z';
  const APP_NAME = 'CG Artist File Browser';
  function detail(it) {
    const key = [it.icon, it.pre, it.title, it.line, it.sub, it.kind].join('|');
    if (it.det && it.det.key === key) return it.det;
    const rec = { key, tex: it.det && it.det.tex, ok: !!(it.det && it.det.ok) };
    it.det = rec;
    const N = it.px >= 400 ? 1024 : it.px >= 160 ? 512 : 256, P = (x, y) => [(x / 1.04 * 0.5 + 0.5) * N, (0.5 - y / 1.04 * 0.5) * N], U = (h) => h / 2.08 * N;
    const font = 'Roboto, "Segoe UI", system-ui, sans-serif';
    const paint = (img) => {
      if (rec !== it.det) return;
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const fit = (txt, h, w, weight) => { let s = U(h); x.font = `${weight} ${s}px ${font}`; while (x.measureText(txt).width > U(w) && s > 8) { s -= 1; x.font = `${weight} ${s}px ${font}`; } };
      const text = (txt, y, h, weight) => { if (!txt) return; fit(txt, h, it.kind > 1.5 ? 1.2 : 0.86, weight); const [cx, cy] = P(0, y); x.fillText(txt, cx, cy); };
      if (it.shape === 3) {
        // lens iris medal: the app's name and the badge engraved round the rim (metals; stones keep their carved rim plain)
        if (it.kind > 1.5) {
          const line = `${APP_NAME}  ·  ${it.title || ''}  ·  ${it.sub || ''}  ·  `.toUpperCase();
          const [cx, cy] = P(0, 0), rad = U(0.905 * 2) / 2, h = U(0.066);
          x.font = `700 ${h}px ${font}`;
          const circ = 2 * Math.PI * rad;
          let txt = line;
          while (x.measureText(txt + line).width < circ * 0.97) txt += line;
          const scale = (circ * 0.97) / Math.max(1, x.measureText(txt).width);
          let a0 = -Math.PI / 2 - (circ * 0.97) / rad / 2;
          for (const ch of txt) {
            const w = x.measureText(ch).width * scale;
            const ang = a0 + w / 2 / rad;
            x.save(); x.translate(cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)); x.rotate(ang + Math.PI / 2);
            x.fillText(ch, 0, 0); x.restore();
            a0 += w / rad;
          }
        }
      } else {
        if (img && it.kind > 1.5) { const s = U(0.27); const [cx, cy] = P(0, 0.40); x.drawImage(img, cx - s / 2, cy - s / 2, s, s); }
        text(it.pre, 0.03, 0.058, 500);
        text(it.title, -0.08, 0.092, 700);
        text(it.line, -0.19, 0.056, 500);
        text(it.sub, -0.28, 0.05, 500);
        // the app's mark (round, list + play knocked out in the reference) and the name, where the platform's logo sits on a real award
        x.font = `700 ${U(0.085)}px ${font}`;
        const name = APP_NAME, tw = x.measureText(name).width, R = U(0.055), gap = U(0.03), w = R * 2 + gap + tw;
        const [lx, ly] = P(0, it.kind > 1.5 ? -0.74 : -0.6);   // stone plaques: above the pavé
        const mx = lx - w / 2 + R;
        x.beginPath(); x.arc(mx, ly, R, 0, Math.PI * 2); x.fill();
        x.save(); x.globalCompositeOperation = 'destination-out'; x.translate(mx - R, ly - R); x.scale(R * 2 / 24, R * 2 / 24);
        x.lineWidth = 2; x.lineCap = 'round'; x.stroke(new Path2D(MARK_LINES)); x.fill(new Path2D(MARK_PLAY)); x.restore();
        x.textAlign = 'left'; x.fillText(name, mx + R + gap, ly + U(0.004));
      }
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
  /** The icon as a texture: its SVG drawn white on a 128 px canvas (an SVG data image never taints the canvas). */
  function icon(name) {
    if (icons.has(name)) return icons.get(name);
    const rec = { tex: null, ok: false };
    icons.set(name, rec);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="128" height="128" fill="none" stroke="#fff" color="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSrc(name) || ''}</svg>`;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 128; c.height = 128;
        c.getContext('2d').drawImage(img, 0, 0, 128, 128);
        rec.tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rec.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        rec.ok = true;
        for (const it of items) if (it.icon === name) it.fresh = true;
        if (still()) draw(performance.now());
      } catch (e) { /* plain stone */ }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return rec;
  }
  function draw(now) {
    const t = still() ? 9 : (now - t0) / 1000;
    for (const it of items) {
      if (solo && it.c !== solo) continue;            // full view open: only the big one draws, the rest hold still
      if (!it.vis && !it.fresh) continue;
      it.fresh = false;
      if (off && (gc.width !== it.px || gc.height !== it.px)) { gc.width = it.px; gc.height = it.px; }
      gl.viewport(0, 0, it.px, it.px);
      gl.uniform2f(U.uRes, it.px, it.px); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uSeed, it.seed); gl.uniform1f(U.uKind, it.kind); gl.uniform1f(U.uPx, it.px); gl.uniform3fv(U.uMetal, METAL[it.metal] || METAL.gold); gl.uniform1f(U.uShape, it.shape); gl.uniform2f(U.uTilt, it.tilt[0], it.tilt[1]);
      const dt = it.shape >= 2 ? detail(it) : null;
      gl.uniform1f(U.uDetOn, dt && dt.ok ? 1 : 0);
      if (dt && dt.ok) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dt.tex); gl.activeTexture(gl.TEXTURE0); }
      const ic = it.icon ? icon(it.icon) : null;
      gl.uniform1f(U.uIconOn, ic && ic.ok ? 1 : 0);
      if (ic && ic.ok) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ic.tex); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (off) { it.ctx.transferFromImageBitmap(gc.transferToImageBitmap()); continue; }
      it.ctx.clearRect(0, 0, it.px, it.px);
      it.ctx.drawImage(gc, 0, maxPx - it.px, it.px, it.px, 0, 0, it.px, it.px);
    }
  }
  function loop(now) {
    raf = 0;
    items = items.filter((it) => it.c.isConnected);
    if (!items.length) return;
    if (!document.hidden && now - last > 12) { draw(now); last = now; }   // 60 fps (the owner 11-21: 30 felt laggy)
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
      items.push({ c, ctx: c.getContext(off ? 'bitmaprenderer' : '2d'), px, kind: kindOf(c.dataset.kind), metal: c.dataset.kind, shape: SHAPE[c.dataset.shape] || 0, icon: c.dataset.icon || '', pre: c.dataset.pre || '', title: c.dataset.title || '', line: c.dataset.line || '', sub: c.dataset.sub || '', tilt: [0, 0], det: null, seed: (items.length % 7) * 5.1, vis: true, fresh: true });
      if (io) io.observe(c);
    }
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
    for (const k of ['pre', 'title', 'line', 'sub']) if (o[k] !== undefined) it[k] = o[k];
    it.fresh = true;
    if (still()) draw(performance.now());
    return true;
  }
  /** Draw only this canvas (the full view), at full frame rate; null = back to all. */
  function only(c) { solo = c || null; items.forEach((it) => { it.fresh = true; }); if (still()) draw(performance.now()); else if (!raf && items.length) raf = requestAnimationFrame(loop); }
  const api = { mount, set, only, icons: (fn) => { iconSrc = fn; }, supported: () => setup() };
export default api;

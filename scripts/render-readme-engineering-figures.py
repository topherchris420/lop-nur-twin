from PIL import Image, ImageDraw, ImageFont
import math
from pathlib import Path

OUT=Path(__file__).resolve().parents[1] / 'docs' / 'media' / 'readme'
OUT.mkdir(parents=True,exist_ok=True)
W,H=1840,1060
B='#F0EEEA'; PAPER='#FBFAF7'; I='#202322'; MUT='#626765'; LIGHT='#B8B7B2'; FAINT='#DDDAD4'; RED='#B34736'; BLUE='#3B6B8E'; BLUEP='#E8EFF1'; YELLOW='#DDD3BA'; MATH='#404543'
# Fonts: Lato + DejaVu Sans Mono (Ubuntu/Debian: apt install fonts-lato fonts-dejavu-core).
# Override locations with LATO_DIR / DEJAVU_DIR. Byte-identical output requires the same
# font files and Pillow/libwebp versions used to produce the checked-in assets.
import os, sys
LATO=Path(os.environ.get('LATO_DIR','/usr/share/fonts/truetype/lato'))
DEJAVU=Path(os.environ.get('DEJAVU_DIR','/usr/share/fonts/truetype/dejavu'))
F={
 'r':LATO/'Lato-Regular.ttf',
 'm':LATO/'Lato-Medium.ttf',
 'b':LATO/'Lato-Bold.ttf',
 'mono':DEJAVU/'DejaVuSansMono.ttf',
}
_missing=[str(p) for p in F.values() if not p.is_file()]
if _missing:
 sys.exit('Missing font files:\n  '+'\n  '.join(_missing)+'\nInstall fonts-lato and fonts-dejavu-core, or set LATO_DIR / DEJAVU_DIR.')
def font(sz,ft='r'): return ImageFont.truetype(str(F[ft]),sz)
def line(d,points,color=I,width=2,joint='curve'):
 d.line(points, fill=color, width=width,joint=joint)
def text(d,xy,s,size=20,color=I,ft='r',anchor=None):
 d.text(xy,s,font=font(size,ft),fill=color,anchor=anchor)
def block(d,box,fill=PAPER,stroke=LIGHT,width=2):
 d.rectangle(box,fill=fill,outline=stroke,width=width)
def rule(d,x1,y1,x2,y2,color=LIGHT,width=2):line(d,[(x1,y1),(x2,y2)],color,width)
def arrow(d,points,col=I,width=2,head=10):
 line(d,points,col,width)
 x0,y0=points[-2]; x,y=points[-1]; a=math.atan2(y-y0,x-x0)
 p1=(x-head*math.cos(a-.55), y-head*math.sin(a-.55));p2=(x-head*math.cos(a+.55),y-head*math.sin(a+.55))
 d.polygon([(x,y),p1,p2],fill=col)
def dot(d,x,y,col=I,r=4):d.ellipse([x-r,y-r,x+r,y+r],fill=col)
def circle(d,x,y,r,col=I,width=2):d.ellipse([x-r,y-r,x+r,y+r],outline=col,width=width)
def mark(d,x,y):
 rule(d,x-13,y,x+13,y,LIGHT);rule(d,x,y-13,x,y+13,LIGHT);circle(d,x,y,4,LIGHT,1)
def badge(d,x,y,s,col=BLUE):
 block(d,[x,y,x+len(s)*10+18,y+28],PAPER,col,1);text(d,(x+10,y+5),s,13,col,'mono')
def canvas(fig,label,subtitle):
 im=Image.new('RGB',(W,H),B); d=ImageDraw.Draw(im)
 for x,y in [(34,34),(W-34,34),(34,H-34),(W-34,H-34)]:mark(d,x,y)
 rule(d,64,74,W-64,74,I,2)
 text(d,(67,41),'VERS3DYNAMICS  /  LOP NUR TWIN',18,I,'b')
 text(d,(W-67,41),f'RESEARCH ENGINEERING     {fig}',16,I,'mono','ra')
 text(d,(68,117),label,40,I,'b')
 text(d,(69,169),subtitle,20,MUT,'r')
 rule(d,64,H-86,W-64,H-86,I,2)
 text(d,(68,H-62),'ARCHITECTURE AS DOCUMENTED IN SOURCE    •    SOFTWARE SYSTEMS, NOT PHYSICAL HARDWARE',14,MUT,'mono')
 text(d,(W-67,H-62),fig,14,MUT,'mono','ra')
 return im,d

def codebox(d,x,y,w,h,header,code,highlight=BLUE):
 block(d,[x,y,x+w,y+h],PAPER,LIGHT,2)
 d.rectangle([x,y,x+w,y+39],fill='#EAE8E3')
 text(d,(x+17,y+11),header,17,I,'mono')
 for i,l in enumerate(code):
  color=highlight if l.startswith('>') else MATH
  s=l[1:] if l.startswith('>') else l
  text(d,(x+20,y+58+27*i),s,16,color,'mono')

def node(d,rect,label,sub=None,kind='normal',sz=20):
 x1,y1,x2,y2=rect
 fill={'normal':PAPER,'source':'#F2F1ED','research':BLUEP,'no':'#F7EDEB','muted':'#F2F0EC'}[kind]
 bord={'normal':I,'source':LIGHT,'research':BLUE,'no':RED,'muted':LIGHT}[kind]
 block(d,rect,fill,bord,2)
 text(d,((x1+x2)/2,y1+23),label,sz,I,'b','ma')
 if sub:
  text(d,((x1+x2)/2,y1+54),sub,15,MUT,'mono','ma')

def label(d,x,y,s,col=MUT,sz=17,mono=False):text(d,(x,y),s,sz,col,'mono' if mono else 'r')

def figure_one():
 im,d=canvas('FIG 06-1','Runtime boundaries','Independently operated originals and an isolated first-contact research environment.')
 # group headers and fine separation
 text(d,(83,234),'PRODUCTION / ORIGINAL INDIVIDUALS',18,I,'mono')
 text(d,(1358,234),'ISOLATED RESEARCH',18,RED,'mono')
 rule(d,86,250,1264,250,I,2);rule(d,1340,250,1751,250,I,2)
 # ECHO large panel
 for x,w in [(84,572),(676,572),(1340,410)]:block(d,[x,274,x+w,756],PAPER,LIGHT,2)
 text(d,(110,307),'A',15,BLUE,'mono');text(d,(149,304),'ECHO   /   Bethesda',25,I,'b')
 text(d,(110,335),'Headless persistent simulation',16,MUT)
 # Source-styled graph
 node(d,(118,400,309,480),'controller','behavior policy')
 node(d,(376,400,619,480),'organism state','body · memory · tick')
 arrow(d,[(309,440),(375,440)],I,2)
 node(d,(376,566,619,646),'sealed checkpoints','ancestry · replay')
 arrow(d,[(498,480),(498,565)],I,2)
 node(d,(118,566,309,646),'live witness','read-only',kind='research')
 arrow(d,[(376,602),(310,602)],BLUE,2)
 label(d,118,683,'src/bethesda/life/',BLUE,18,True)
 label(d,118,721,'Witness cannot modify a checkpoint',MUT,16)
 # Eva
 text(d,(700,307),'B',15,BLUE,'mono');text(d,(741,304),'Eva  /  Garden',25,I,'b')
 text(d,(700,335),'Separate Python process, state and clock',16,MUT)
 node(d,(714,401,908,482),'garden service','Python runtime')
 node(d,(989,401,1209,482),'persistent state','history · memory')
 arrow(d,[(908,442),(988,442)],I)
 node(d,(989,566,1209,647),'read-only view','garden exhibit',kind='research')
 arrow(d,[(1100,482),(1100,565)],BLUE)
 codebox(d,714,570,212,75,'service source',['deploy/garden/'],BLUE)
 label(d,714,683,'deploy/garden/service/',BLUE,18,True)
 label(d,714,721,'No shared state with ECHO',MUT,16)
 # Research
 text(d,(1362,307),'C',15,RED,'mono');text(d,(1402,304),'First contact',25,I,'b')
 text(d,(1363,335),'Seeded research subjects only',16,MUT)
 node(d,(1364,401,1514,470),'ECHO-kind',None,kind='research',sz=18)
 node(d,(1582,401,1730,470),'Eva-kind',None,kind='research',sz=18)
 node(d,(1445,529,1643,605),'shared commons','sight · touch · chemistry',kind='research',sz=21)
 arrow(d,[(1438,470),(1438,489),(1520,529)],BLUE)
 arrow(d,[(1656,470),(1656,489),(1570,529)],BLUE)
 node(d,(1445,654,1643,713),'encounter records',None,kind='source',sz=19)
 arrow(d,[(1544,606),(1544,653)],BLUE)
 # visual boundary: no flow across
 rule(d,1293,271,1293,765,RED,2)
 for y in range(279,751,18): d.rectangle([1290,y,1296,y+9],fill=B)
 d.rectangle([1256,462,1331,566],fill=B)
 text(d,(1293,489),'NO',18,RED,'b','ma');text(d,(1293,517),'WRITE',18,RED,'b','ma');text(d,(1293,543),'LINK',18,RED,'b','ma')
 # legend / footer notes
 rule(d,84,786,1750,786,I,2)
 text(d,(88,823),'BOUNDARY CONDITION',16,RED,'mono')
 text(d,(88,854),'The deployed ECHO and Eva are observed, not used as experimental subjects.',24,I,'b')
 text(d,(88,893),'Research encounters take place in separately seeded subjects; production state and history remain untouched.',19,MUT)
 dot(d,90,940,BLUE,5);text(d,(107,929),'Read-only observation',15,MUT)
 dot(d,338,940,RED,5);text(d,(355,929),'Forbidden write path',15,MUT)
 dot(d,613,940,I,5);text(d,(630,929),'Internal state transfer',15,MUT)
 path=OUT/'engineering-arrangement-systems.webp';im.save(path,format='WEBP',quality=93,method=6)
 return path

def figure_two():
 im,d=canvas('FIG 06-2','Evidence and review chain','A registered experiment moves through isolated execution, independent scoring and review.')
 # top flow swimlane label
 text(d,(80,227),'TRACE  /   REPRODUCIBLE RESEARCH',17,I,'mono')
 rule(d,81,245,1760,245,I,2)
 stages=[(82,385,'01','REGISTER','question / controls'),(421,724,'02','EXECUTE','isolated research'),(762,1065,'03','VERIFY','independent scoring'),(1102,1405,'04','ARCHIVE','source-linked journal'),(1442,1755,'05','REVIEW','authorized decision')]
 for x1,x2,num,name,sub in stages:
  block(d,[x1,269,x2,689],PAPER,LIGHT,2)
  d.rectangle([x1,269,x2,317],fill='#E7E5E0')
  text(d,(x1+18,285),num,15,BLUE if num!='05' else RED,'mono')
  text(d,(x1+64,280),name,21,I,'b')
  label(d,x1+20,345,sub,sz=17)
 # protocol document with constraints
 x=133;y=405
 block(d,[x+13,y+13,x+196,y+182],'#EFEDE9',LIGHT,1)
 block(d,[x,y,x+184,y+169],PAPER,I,2)
 text(d,(x+20,y+18),'PROTOCOL',17,I,'mono')
 for k in range(5):
  yy=y+54+k*22; d.rectangle([x+21,yy,x+32,yy+11],outline=I,width=1);rule(d,x+45,yy+6,x+157-(k%2)*23,yy+6,LIGHT,2)
 label(d,103,618,'criteria fixed before run',MUT,15)
 # isolated experiment: two computational subject matrices, no fake device
 x=454;y=402
 for k in range(3):
  dx=k*26;dy=k*18
  block(d,[x+dx,y+dy,x+190+dx,y+124+dy],'#FBFAF7',I,2)
  for j in range(6):
   for i in range(7):
    bx=x+dx+13+i*23;by=y+dy+14+j*16
    d.rectangle([bx,by,bx+14,by+7],fill=FAINT if (j+i+k)%3 else BLUEP,outline=LIGHT,width=1)
 label(d,447,618,'bounded simulation / seeds',MUT,15)
 # scoreboard as actual record-like comparison not invented numerical
 x=797;y=407
 block(d,[x,y,x+228,y+169],PAPER,I,2)
 text(d,(x+17,y+19),'EVIDENCE RECORD',16,I,'mono')
 rule(d,x+17,y+48,x+211,y+48,LIGHT,1)
 for k,(l,v) in enumerate([('baseline','recorded'),('candidate','recorded'),('verdict','checked')]):
  yy=y+68+k*34;text(d,(x+16,yy),l,14,MUT,'mono');text(d,(x+210,yy),v,14,BLUE,'mono','ra')
 label(d,779,618,'replay / compare / falsify',MUT,15)
 # source linked journal record
 x=1127;y=410
 for k in range(3):
  d.rectangle([x+k*10,y-k*10,x+208+k*10,y+168-k*10],fill=PAPER,outline=I,width=2)
 text(d,(x+32,y+23),'JOURNAL',19,I,'mono')
 for k in range(4):rule(d,x+32,y+61+k*24,x+174-(k%2)*35,y+61+k*24,LIGHT,2)
 circle(d,x+191,y+132,12,BLUE,2)
 label(d,1117,618,'append-only event history',MUT,15)
 # review gate
 x=1467;y=413
 block(d,[x,y,x+258,y+156],PAPER,I,2)
 text(d,(x+18,y+20),'REVIEW GATE',18,I,'mono')
 for k,l in enumerate(['evidence','authority','decision']):
  yy=y+57+k*30;circle(d,x+29,yy,6,BLUE if k<2 else RED,2);text(d,(x+48,yy-11),l,16,I,'mono')
 label(d,1462,618,'human authorization only',MUT,15)
 # Connect stages from center x intervals
 for i in range(4):
  xa=stages[i][1];xb=stages[i+1][0]
  arrow(d,[(xa+4,485),(xb-8,485)],I,2,8)
 # lower panel code/evidence useful excerpts
 rule(d,82,735,1755,735,I,2)
 text(d,(83,766),'IMPLEMENTATION BOUNDARIES',17,I,'mono')
 codebox(d,83,802,753,126,'REPLAY / CLAIMS',[
 'src/bethesda/metrology/    → experiment measurements',
 '>scripts/claims/            → record-to-claim bindings'
 ])
 codebox(d,872,802,883,126,'AUTONOMY / AUTHORIZATION',[
 'src/rain/                 → proposals and research logic',
 '>Independent reviewer       → final scientific approval'
 ],RED)
 text(d,(85,945),'SOFTWARE ARCHITECTURE PLATE   /   NOT AN ELECTRICAL SCHEMATIC OR HARDWARE DESIGN',13,MUT,'mono')
 path=OUT/'engineering-arrangement-evidence.webp';im.save(path,format='WEBP',quality=93,method=6)
 return path

if __name__=='__main__':
 for p in (figure_one(),figure_two()):
  from PIL import Image
  im=Image.open(p);print(p,im.size,p.stat().st_size)
"""Import only named booth polygons; register against existing hall doors."""
import json, math, re, pathlib, xml.etree.ElementTree as ET
base = pathlib.Path(__file__).resolve().parents[1]
source = ET.parse(base / 'assets/figma-1.1-booths-20260907.svg').getroot()
target = ET.parse(base / 'assets/figma-f1-20260907.svg').getroot()
hall = next(n for n in target.iter() if n.get('id') == '1.1')
def doors(root):
    result = {}
    for n in root.iter():
        if n.tag.endswith('line') and 'DOOR' in n.get('id',''):
            k = re.search(r'__(\d+)$', n.get('id',''))
            if k: result[int(k[1])] = ((float(n.get('x1'))+float(n.get('x2')))/2, (float(n.get('y1'))+float(n.get('y2')))/2)
    return result
s,t=doors(source),doors(hall)
keys=sorted(s.keys() & t.keys())
sc=[sum(s[k][j] for k in keys)/len(keys) for j in range(2)]
tc=[sum(t[k][j] for k in keys)/len(keys) for j in range(2)]
dot=cross=0
for k in keys:
    x,y=s[k][0]-sc[0],s[k][1]-sc[1]; u,v=t[k][0]-tc[0],t[k][1]-tc[1]
    dot+=x*u+y*v; cross+=x*v-y*u
a=math.atan2(cross,dot); c,b=math.cos(a),math.sin(a)
def align(p): return [round(tc[0]+c*(p[0]-sc[0])-b*(p[1]-sc[1]),4),round(tc[1]+b*(p[0]-sc[0])+c*(p[1]-sc[1]),4)]
error=max(math.dist(align(s[k]),t[k]) for k in keys)
assert error < .5, f'Door alignment failed: {error}px'
names=['星舟','澄光','云帆','青禾','辰海','远川','启原','新衡','明跃','蓝境','禾川']
sectors=[('智行','新能源汽车'),('能源','新能源'),('智造','智能制造'),('医疗','医疗科技'),('材料','新材料'),('数字','数字技术')]
rows=[]
for n in source.iter():
    code=n.get('id','')
    if not re.fullmatch(r'A\d{3}',code): continue
    d=n.get('d',''); assert not re.search(r'[A-KN-Yac-z]',d), f'Unsupported booth geometry {code}'
    nums=[float(v) for v in re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?',d)]
    pts=[align(nums[i:i+2]) for i in range(0,len(nums),2)]
    i=int(code[1:])-1; suffix,industry=sectors[i%6]; short=names[i//6]+suffix
    rows.append(dict(code=code,floor='F1',hall='1.1',shortName=short,company=short+'科技有限公司（模拟）',industry=industry,intro=f'展示{industry}相关产品与应用方案，欢迎到展位交流。此信息仅用于地图功能演示。',contact='展位接待（模拟）',phone='400-000-XXXX',email=code.lower()+'@example.com',image='',points=pts))
rows.sort(key=lambda r:r['code'])
assert len(rows)==66 and len({r['code'] for r in rows})==66
out=dict(source='1.1 (2).svg',floor='F1',hall='1.1',simulated=True,registration=dict(doors=len(keys),maxErrorPixels=error,rotationDegrees=math.degrees(a),scale=1),booths=rows)
(base/'assets/booths-1.1.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(count=len(rows),registration=out['registration']),ensure_ascii=False))

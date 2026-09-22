"""Rebuild the lightweight, metre-scale training assets with Blender 4.5+.

Blender -b --python scripts/blender-driving-assets.py
Public coordinates throughout this file are glTF/Godot: X right, Y up, -Z forward.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'driving'
SOURCE = OUT / 'source'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def xyz(p):
    return (p[0], -p[2], p[1])

def material(name, color, metallic=0, roughness=.7, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return m

MAT = {
 'asphalt': material('Asphalt graphite', (.095,.135,.165)),
 'white': material('Marking warm white', (.93,.95,.88)),
 'yellow': material('Safety amber', (.99,.63,.075)),
 'sidewalk': material('Sidewalk limestone', (.65,.69,.67)),
 'curb': material('Curb cream', (.84,.86,.78)),
 'grass': material('Ground sage', (.31,.50,.34)),
 'grass_light': material('Planter moss', (.46,.62,.36)),
 'leaves': material('Trees eucalyptus', (.12,.36,.25)),
 'leaves_light': material('Trees lime', (.29,.50,.26)),
 'wood': material('Warm timber', (.34,.23,.15)),
 'building': material('Building cool stone', (.62,.72,.74)),
 'building_warm': material('Building warm stone', (.82,.77,.65)),
 'glass': material('Windows petrol', (.12,.27,.32), .12, .3),
 'metal': material('Street furniture charcoal', (.13,.18,.20), .4, .4),
 'blue': material('Guide signs blue', (.06,.34,.64)),
 'car': material('Coach blue enamel', (.045,.49,.68), .38, .23),
 'black': material('Rubber and seals', (.023,.030,.034)),
 'wheel': material('Wheel brushed alloy', (.55,.61,.63), .6, .25),
 'red': material('Tail lamps ruby', (.64,.035,.045), .1, .25),
 'headlight': material('Headlamp ivory', (.92,.97,1), .1, .2, .35),
}

def setmat(o, key):
    o.data.materials.append(MAT[key])
    return o

def box(name, pos, dims, mat, bevel=0):
    # Direct mesh construction avoids thousands of scene updates in background mode.
    dx,dy,dz=dims[0]/2,dims[2]/2,dims[1]/2
    data=bpy.data.meshes.new(name)
    data.from_pydata([(-dx,-dy,-dz),(dx,-dy,-dz),(dx,dy,-dz),(-dx,dy,-dz),
                      (-dx,-dy,dz),(dx,-dy,dz),(dx,dy,dz),(-dx,dy,dz)],[],
                     [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    data.update()
    o=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(o)
    o.location=xyz(pos)
    setmat(o,mat)
    if bevel:
        mod=o.modifiers.new('Soft manufactured edges','BEVEL')
        mod.width=bevel
        mod.segments=2
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def cylinder(name, pos, radius, depth, mat, axis=(0,1,0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=xyz(pos))
    o=bpy.context.object
    o.name=name
    o.rotation_mode='QUATERNION'
    o.rotation_quaternion=Vector((0,0,1)).rotation_difference(Vector(xyz(axis)))
    return setmat(o,mat)

def mesh(name, verts, faces, mat):
    data=bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in verts], [], [tuple(reversed(face)) for face in faces])
    data.update()
    o=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(o)
    return setmat(o,mat)

def ico(name, pos, dims, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=xyz(pos))
    o=bpy.context.object
    o.name=name
    o.scale=(dims[0],dims[2],dims[1])
    return setmat(o,mat)

def join_by_material(objects, prefix):
    groups={}
    for o in objects:
        if o.type=='MESH':
            groups.setdefault(o.data.materials[0].name,[]).append(o)
    result=[]
    for name, obs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs: o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0]
        if len(obs)>1: bpy.ops.object.join()
        o=bpy.context.object
        o.name=prefix+'_'+name.replace(' ','_')
        result.append(o)
    return result

def export(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/name), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_cameras=False,
                              export_lights=False, export_animations=False)
    return {'file':name,'bytes':(OUT/name).stat().st_size,
            'meshes':len(objects),'triangles':sum(len(o.data.loop_triangles) for o in objects)}

# Compact coach car: car origin lies on the ground between the axles.
before=set(bpy.data.objects)
box('Coach body', (0,.72,0), (1.84,.67,4.20), 'car', .16)
box('Underbody', (0,.39,0), (1.63,.22,3.67),'black',.08)
box('Front bumper', (0,.59,-2.10),(1.69,.20,.17),'car',.055)
box('Rear bumper', (0,.59,2.08),(1.69,.20,.17),'car',.055)
# Cabin is an eight-corner tapered prism with intentionally sloped windscreen.
cabin=[(-.78,.94,-1.14),(.78,.94,-1.14),(.78,.94,1.38),(-.78,.94,1.38),
       (-.66,1.51,-.56),(.66,1.51,-.56),(.66,1.51,.86),(-.66,1.51,.86)]
mesh('Glazed cabin',cabin,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],'glass')
box('Floating white roof',(0,1.54,.15),(1.36,.075,1.46),'white',.045)
for side in [-1,1]:
    box('Lower window sill', (side*.792,.965,.12),(.048,.058,2.3),'car',.012)
    box('B pillar',(side*.724,1.22,.14),(.038,.55,.07),'black',.008)
    box('Instructor door panel',(side*.932,.76,.05),(.015,.37,1.64),'white',.012)
    box('Amber side stripe',(side*.946,.68,0),(.012,.08,3.08),'yellow')
    for z in [-.68,.81]: box('Door handle',(side*.945,.91,z),(.026,.045,.17),'metal',.015)
    box('Wing mirror mount',(side*.97,1.025,-.78),(.14,.05,.06),'black')
    box('Wing mirror',(side*1.06,1.08,-.80),(.16,.12,.23),'car',.035)
    box('Mirror glass',(side*1.067,1.08,-.684),(.12,.084,.014),'wheel')
    for z in [-1.32,1.32]:
        cylinder('Tyre', (side*.88,.36,z), .355,.225,'black',axis=(1,0,0),vertices=20)
        cylinder('Alloy wheel', (side*1.00,.36,z), .235,.015,'wheel',axis=(1,0,0),vertices=16)
        cylinder('Hub centre', (side*1.012,.36,z), .065,.020,'metal',axis=(1,0,0),vertices=12)
    box('Headlamp',(side*.59,.85,-2.091),(.43,.14,.075),'headlight',.038)
    box('Tail lamp',(side*.64,.89,2.079),(.32,.14,.06),'red',.03)
box('Front grille',(0,.62,-2.185),(.62,.16,.017),'black',.015)
box('Learner licence plate',(0,.72,-2.198),(.43,.105,.014),'yellow',.009)
box('Rear licence plate',(0,.68,2.174),(.43,.105,.014),'yellow',.009)
box('Learner roof sign',(0,1.72,.15),(.57,.28,.22),'yellow',.035)
font_path=Path('C:/Windows/Fonts/msyh.ttc')
if font_path.exists():
    font=bpy.data.fonts.load(str(font_path))
    bpy.ops.object.text_add(location=xyz((-.11,1.62,.268)))
    text=bpy.context.object
    text.name='Chinese learner sign'
    text.data.body='学'
    text.data.size=.205
    text.data.font=font
    text.data.extrude=.001
    # Text local +Y is vertical and normal faces the rear (+Z in game space).
    text.rotation_euler=(math.pi/2,0,0)
    text.data.materials.append(MAT['black'])
    bpy.ops.object.convert(target='MESH')
car=join_by_material(list(set(bpy.data.objects)-before),'Coach')
for o in car: o.data.calc_loop_triangles()
car_report=export('coach-car.glb',car)

# 180 m main avenue and cross street. Roads are planar geometry; Godot owns collisions.
before=set(bpy.data.objects)
box('Landscape foundation',(0,-.19,0),(190,.30,205),'grass')
box('Long avenue',(0,-.025,0),(14,.05,180),'asphalt')
box('Cross avenue',(0,-.024,0),(150,.05,14),'asphalt')
for sx in [-1,1]:
    for sz in [-1,1]:
        box('Block pavement',(sx*48,.10,sz*50),(82,.20,86),'sidewalk')
        box('Block inner landscape',(sx*48,.215,sz*50),(72,.035,75),'grass_light')
        box('Long kerb',(sx*7.22,.13,sz*48.5),(.35,.26,83),'curb')
        box('Cross kerb',(sx*41,.13,sz*7.22),(67,.26,.35),'curb')
# Double amber centre lines stop before the crossing; two lanes in each direction.
for side in [-1,1]:
    for d in [-.12,.12]:
        box('Main centre line',(d,.006,side*50.8),(.075,.012,78.4),'yellow')
        box('Cross centre line',(side*43.3,.007,d),(63.4,.012,.075),'yellow')
    for lane in [-3.5,3.5]:
        for z in range(16,88,7): box('Main lane dash',(lane,.009,side*z),(.105,.016,3.3),'white')
        for x in range(16,74,7): box('Cross lane dash',(side*x,.01,lane),(3.3,.016,.105),'white')
    for edge in [-6.80,6.80]:
        box('Main road edge',(edge,.008,side*50.5),(.10,.014,79),'white')
        box('Cross road edge',(side*43,.01,edge),(64,.014,.10),'white')
    # Stop line only spans the approaching half of each carriageway.
    box('Main stop line',(side*3.45,.016,side*11.2),(6.62,.02,.25),'white')
    box('Cross stop line',(-side*11.2,.018,side*3.45),(.25,.02,6.62),'white')
    for i in range(-6,7):
        box('Main zebra stripe',(i*.98,.025,side*9.1),(.57,.03,2.35),'white')
        box('Cross zebra stripe',(side*9.1,.027,i*.98),(2.35,.03,.57),'white')

def road_arrow(x,z,reverse=False):
    sign=-1 if reverse else 1
    box('Lane arrow stem',(x,.02,z+sign*.42),(.16,.03,1.7),'white')
    v=[(x-.48,.038,z-sign*.12),(x,.038,z-sign*.86),(x+.48,.038,z-sign*.12)]
    mesh('Lane arrow head',v,[(2,1,0) if reverse else (0,1,2)],'white')
for x in [1.75,5.25]:
    for z in [18,43,68]:
        road_arrow(x,z)
        road_arrow(-x,-z,True)

def tree(x,z,i):
    cylinder('Tree trunk',(x,1.2,z),.14,2.0,'wood',vertices=7)
    ico('Tree broad crown',(x,3.25,z),(1.45,1.70,1.45),'leaves' if i%2 else 'leaves_light',2)
    ico('Tree upper crown',(x+.30,4.20,z-.10),(1.05,1.03,1.05),'leaves_light' if i%2 else 'leaves',1)
    box('Tree planter',(x,.28,z),(2.3,.12,2.3),'grass',.10)

for sx in [-1,1]:
    for sz in [-1,1]:
        for i,z in enumerate([16,27,38,49,60,71,82]): tree(sx*9.6,sz*z,i)
        for i,x in enumerate([20,32,44,56,68]): tree(sx*x,sz*9.6,i+1)

def building(x,z,w,d,h,warm=False):
    box('Architectural mass',(x,.22+h/2,z),(w,h,d),'building_warm' if warm else 'building',.08)
    box('Building parapet',(x,h+.33,z),(w+.35,.22,d+.35),'curb')
    box('Recessed roof',(x,h+.48,z),(w-1,.16,d-1),'metal')
    floors=max(1,int(h/3))
    for f in range(floors):
        y=1.4+f*2.7
        for side in [-1,1]:
            box('Ribbon windows front',(x,y, z+side*(d/2+.012)),(w-1.3,1.20,.025),'glass')
            box('Ribbon windows side',(x+side*(w/2+.012),y,z),(.025,1.20,d-1.3),'glass')
        # Narrow fins subdivide ribbon windows with fewer triangles than per-window geometry.
        for n in range(-int(w/4),int(w/4)+1):
            for side in [-1,1]: box('Window mullion',(x+n*1.9,y,z+side*(d/2+.035)),(.11,1.25,.035),'curb')
    box('Entrance canopy',(x,.95,z-d/2-.9),(3.2,.14,1.8),'blue')
    box('Entrance door',(x,.64,z-d/2-.04),(1.6,1.20,.07),'glass')

for sx in [-1,1]:
    for sz in [-1,1]:
        for i,(x,z,w,d,h) in enumerate([(22,22,16,16,8.5),(43,24,15,20,13.7),(64,22,15,16,11.0),
                                      (24,48,18,17,11.2),(49,49,20,18,8.4),(25,75,18,18,16.4),
                                      (52,76,20,19,19.0)]):
            building(sx*x,sz*z,w,d,h,(i+(sx==sz))%2==0)

def lamppost(x,z,side):
    cylinder('Lamp pole',(x,3.3,z),.07,6.25,'metal',vertices=8)
    box('Lamp arm',(x-side*.58,6.36,z),(1.3,.07,.08),'metal')
    box('Lamp head',(x-side*1.15,6.31,z),(.61,.10,.29),'metal',.035)
    box('Lamp diffuser',(x-side*1.15,6.25,z),(.49,.012,.21),'headlight')
for side in [-1,1]:
    for z in [-76,-47,-19,19,47,76]: lamppost(side*7.8,z,side)

# Signal faces stay dark; the runtime places emissive discs in front of these lenses.
SIGNALS=[]
for name,c,normal,pole in [
    ('south_to_north',(2.3,5.2,-8.4),(0,0,1),(8.4,0,-8.4)),
    ('north_to_south',(-2.3,5.2,8.4),(0,0,-1),(-8.4,0,8.4)),
    ('west_to_east',(8.4,5.2,2.3),(-1,0,0),(8.4,0,8.4)),
    ('east_to_west',(-8.4,5.2,-2.3),(1,0,0),(-8.4,0,-8.4))]:
    cylinder('Signal pole',(pole[0],3.1,pole[2]),.10,6.20,'metal',vertices=10)
    box('Signal mast',((pole[0]+c[0])/2,6.06,(pole[2]+c[2])/2),
        (max(.12,abs(pole[0]-c[0])),.12,max(.12,abs(pole[2]-c[2]))),'metal')
    box('Signal hanger',(c[0],5.95,c[2]),(.08,.3,.08),'metal')
    transverse=normal[2]!=0
    box('Signal housing '+name,c,(.65,1.75,.46) if transverse else (.46,1.75,.65),'metal',.045)
    lamps=[]
    for y in [5.74,5.20,4.66]:
        face=(c[0]+normal[0]*.25,y,c[2]+normal[2]*.25)
        cylinder('Signal dark lens',face,.197,.028,'black',axis=normal,vertices=16)
        lamps.append([c[0]+normal[0]*.278,y,c[2]+normal[2]*.278])
    SIGNALS.append({'name':name,'center':c,'normal':normal,'lamps':lamps})

# A small roadside shelter and benches give the first-person view recognizable scale.
for side in [-1,1]:
    x=side*10.4; z=side*36
    for dz in [-2,2]: cylinder('Bus shelter post',(x,1.7,z+dz),.065,3.0,'metal',vertices=8)
    box('Bus shelter canopy',(x,3.2,z),(2.1,.14,4.7),'blue',.035)
    box('Bus shelter back',(x+side*.8,1.7,z),(.06,2.6,4.2),'glass')
    box('Bench seat',(x,.72,z),(.6,.1,3.2),'wood')
    for dz in [-1.25,1.25]: box('Bench support',(x,.46,z+dz),(.42,.50,.11),'metal')

city=join_by_material(list(set(bpy.data.objects)-before),'City')
for o in city: o.data.calc_loop_triangles()
city_report=export('city-block.glb',city)

# Archive source and render a useful integration-preview with a coach in the approach lane.
for o in car: o.location += Vector(xyz((1.75,0,22)))
world=bpy.data.worlds.new('Clear training day') if not bpy.data.worlds else bpy.data.worlds[0]
bpy.context.scene.world=world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.62,.76,.85,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
bpy.ops.object.light_add(type='SUN',location=(0,0,40))
sun=bpy.context.object
sun.name='Late morning sun'
sun.data.energy=2.2
sun.data.angle=.12
sun.rotation_euler=(.42,-.55,-.55)
bpy.ops.object.light_add(type='AREA',location=(0,0,35))
area=bpy.context.object
area.name='Soft sky'
area.data.energy=1500
area.data.shape='DISK'
area.data.size=70
bpy.ops.object.camera_add(location=xyz((48,68,88)))
camera=bpy.context.object
target=Vector(xyz((0,0,6)))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=88
scene=bpy.context.scene
scene.camera=camera
scene.render.engine='CYCLES'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1600
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'driving-assets-preview.png')
scene.view_settings.view_transform='AgX'
scene.view_settings.exposure=.5
scene.render.film_transparent=False
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'driving-training-assets.blend'))
bpy.ops.render.render(write_still=True)
# The entry-card image uses the driver's approach, with the learner car prominent.
camera.location=xyz((6.5,11,37))
camera.rotation_euler=(Vector(xyz((0,1,14)))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='PERSP'
camera.data.lens=34
scene.render.resolution_x=1000
scene.render.resolution_y=625
scene.render.image_settings.file_format='JPEG'
scene.render.image_settings.quality=90
scene.render.filepath=str(OUT/'training-preview.jpg')
bpy.ops.render.render(write_still=True)
scene.render.image_settings.file_format='PNG'
manifest={
 'generator':'Blender '+bpy.app.version_string,
 'script':'scripts/blender-driving-assets.py',
 'license':'Original procedural geometry created for this project; no external textures.',
 'coordinates':{'unit':'metre','up':'+Y','vehicle_forward':'-Z','car_origin':'ground between axles'},
 'road':{'main_width':14,'cross_width':14,'main_length':180,'cross_length':150,
         'intersection_half_width':7,'crosswalk_center_z':[9.1,-9.1],
         'stop_line_z':[11.2,-11.2],'initial_car_position':[1.75,0,35]},
 'traffic_signals':SIGNALS,'assets':[car_report,city_report],
 'physics':'Visual geometry only. Runtime supplies planar road collision and driving rules.',
 'source':'assets/driving/source/driving-training-assets.blend',
}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('DRIVING_ASSETS_READY '+json.dumps(manifest['assets']))

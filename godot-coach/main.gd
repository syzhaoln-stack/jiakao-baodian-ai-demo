extends Node3D

# Coordinates are metres, +Y up and the vehicle travels along -Z.
# This deliberately models driving cues, not a certified examination or vehicle dynamics.
const START := Vector3(1.75, 0, 35)
const STOP_LINE := 11.2
const CAR_FRONT := 2.15
const WHEELBASE := 2.65

var vehicle: Node3D
var car_visual: Node3D
var cockpit_hood: MeshInstance3D
var camera: Camera3D
var speed := 0.0
var steering := 0.0
var heading := 0.0
var elapsed := 0.0
var hud_elapsed := 0.0
var score := 100
var mission := "junction"
var stage := 0
var passed_junction := false
var red_violation := false
var camera_mode := "chase"
var indicator := "off"
var paused := false
var complete := false
var parking_hold := 0.0
var held := {"throttle": false, "brake": false, "left": false, "right": false}
var violations := {}
var event_text := "准备起步：轻踩油门，在停止线前平稳停车。"
var event_time := 0.0
var lamp_materials: Array[StandardMaterial3D] = []
var bridge_callback: JavaScriptObject
var previous_traffic := ""

func _ready() -> void:
	_build_world()
	vehicle = Node3D.new()
	vehicle.name = "TrainingVehicle"
	add_child(vehicle)
	var car: PackedScene = load("res://assets/coach-car.glb")
	car_visual = car.instantiate()
	vehicle.add_child(car_visual)
	# The low-poly asset uses opaque windows. A dedicated cockpit hood leaves the
	# driver's sightline clear while retaining a vehicle reference in first person.
	cockpit_hood = MeshInstance3D.new()
	var hood_mesh := BoxMesh.new()
	hood_mesh.size = Vector3(1.55, 0.10, 1.3)
	cockpit_hood.mesh = hood_mesh
	var hood_material := StandardMaterial3D.new()
	hood_material.albedo_color = Color("286f75")
	hood_material.roughness = 0.55
	cockpit_hood.material_override = hood_material
	cockpit_hood.position = Vector3(0, 0.98, -1.35)
	vehicle.add_child(cockpit_hood)
	camera = Camera3D.new()
	camera.fov = 63
	camera.near = 0.08
	camera.far = 350
	add_child(camera)
	camera.make_current()
	reset_training()
	if OS.has_feature("web"):
		bridge_callback = JavaScriptBridge.create_callback(_on_web_command)
		var window := JavaScriptBridge.get_interface("window")
		window.drivingCommand = bridge_callback
		JavaScriptBridge.eval("window.dispatchEvent(new Event('driving-ready'))", true)
	_emit_hud()

func _build_world() -> void:
	var world: PackedScene = load("res://assets/city-block.glb")
	add_child(world.instantiate())
	var environment_node := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("aecedc")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("e0f2fc")
	environment.ambient_light_energy = 0.35
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.fog_enabled = true
	environment.fog_light_color = Color("aecedc")
	environment.fog_density = 0.0018
	environment_node.environment = environment
	add_child(environment_node)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42, -32, 0)
	sun.light_color = Color("fff4dd")
	sun.light_energy = 0.75
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 70
	add_child(sun)
	var greens := StandardMaterial3D.new()
	greens.albedo_color = Color("789782")
	var ground := MeshInstance3D.new()
	var ground_mesh := PlaneMesh.new()
	ground_mesh.size = Vector2(550, 550)
	ground.mesh = ground_mesh
	ground.material_override = greens
	ground.position.y = -0.06
	add_child(ground)
	# Lamp faces sit just in front of the housings exported from Blender.
	for n in range(3):
		var material := StandardMaterial3D.new()
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lamp_materials.append(material)
		var mesh := SphereMesh.new()
		mesh.radius = 0.185
		mesh.height = 0.37
		mesh.radial_segments = 12
		mesh.rings = 6
		var bulb := MeshInstance3D.new()
		bulb.mesh = mesh
		bulb.material_override = material
		bulb.position = Vector3(2.3, 5.74 - n * 0.54, -8.10)
		bulb.scale.z = 0.25
		add_child(bulb)

func reset_training(next_mission: String = "") -> void:
	if not next_mission.is_empty():
		mission = next_mission
	speed = 0
	steering = 0
	heading = 0
	elapsed = 0
	score = 100
	stage = 0
	complete = false
	paused = false
	parking_hold = 0
	passed_junction = false
	red_violation = false
	indicator = "off"
	violations.clear()
	_clear_held()
	vehicle.position = START if mission != "parking" else Vector3(3.7, 0, 48)
	vehicle.rotation = Vector3.ZERO
	event_text = "准备起步：轻踩油门，在停止线前平稳停车。"
	if mission == "parking":
		event_text = "打右转向灯，低速靠向道路右侧，随后回正停车。"
	if mission == "cruise":
		event_text = "自由熟悉方向与制动，限速 40 km/h。"
	event_time = 5.0
	_update_camera(true)
	_update_lights()
	_emit_hud()

func _clear_held() -> void:
	for key in held:
		held[key] = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT and is_instance_valid(vehicle):
		_clear_held()
		paused = true

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	match event.physical_keycode:
		KEY_C: _toggle_camera()
		KEY_R: reset_training()
		KEY_P: paused = not paused
		KEY_Q: indicator = "off" if indicator == "left" else "left"
		KEY_E: indicator = "off" if indicator == "right" else "right"

func _on_web_command(args: Array) -> void:
	if args.is_empty():
		return
	var command := str(args[0])
	if held.has(command):
		held[command] = bool(args[1]) if args.size() > 1 else false
	elif command == "reset":
		reset_training()
	elif command == "mission" and args.size() > 1 and str(args[1]) in ["junction", "parking", "cruise"]:
		reset_training(str(args[1]))
	elif command == "camera":
		_toggle_camera()
	elif command == "pause":
		paused = not paused
		_clear_held()
	elif command == "blur":
		paused = true
		_clear_held()
	elif command == "signal_left":
		indicator = "off" if indicator == "left" else "left"
	elif command == "signal_right":
		indicator = "off" if indicator == "right" else "right"
	_emit_hud()

func _toggle_camera() -> void:
	camera_mode = "cockpit" if camera_mode == "chase" else "chase"
	_update_camera(true)

func _physics_process(delta: float) -> void:
	hud_elapsed += delta
	if paused or complete:
		if hud_elapsed >= 0.1:
			_emit_hud()
		return
	elapsed += delta
	event_time = maxf(0.0, event_time - delta)
	var throttle: bool = held.throttle or Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)
	var brake: bool = held.brake or Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN) or Input.is_physical_key_pressed(KEY_SPACE)
	var left: bool = held.left or Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)
	var right: bool = held.right or Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)
	# Brake always wins, including a simultaneous touch on both pedals.
	if brake:
		speed = move_toward(speed, 0.0, 6.8 * delta)
	elif throttle:
		speed = minf(15.0, speed + (2.1 - speed * 0.06) * delta)
	else:
		speed = move_toward(speed, 0.0, 0.45 * delta)
	var target_steer := float(int(left) - int(right))
	steering = move_toward(steering, target_steer, delta * 1.8)
	# Bicycle model, steering reduced smoothly at speed.
	var wheel_angle := steering * lerpf(0.48, 0.16, clampf(speed / 15.0, 0, 1))
	heading += speed / WHEELBASE * tan(wheel_angle) * delta
	var previous_position := vehicle.position
	var step := Vector3(-sin(heading), 0, -cos(heading)) * speed * delta
	var next_position := vehicle.position + step
	# Keep the complete car on the drivable cross and inside the modelled town.
	if (absf(next_position.x) > 6.03 and absf(next_position.z) > 6.03) or absf(next_position.x) > 69 or absf(next_position.z) > 69:
		speed = 0.0
		steering = 0.0
		_penalty("road_edge", 10, "已到道路边缘，请调整方向或重新开始。")
	else:
		vehicle.position = next_position
	vehicle.rotation.y = heading
	var front_before := previous_position.z - cos(heading) * CAR_FRONT
	var front_now := vehicle.position.z - cos(heading) * CAR_FRONT
	if not passed_junction and front_before >= STOP_LINE and front_now < STOP_LINE and absf(vehicle.position.x) < 7:
		passed_junction = true
		if traffic_state() == "red":
			red_violation = true
			_penalty("red_light", 20, "红灯越过停止线。请重置后，在停止线前停车。")
	if speed * 3.6 > 40.5:
		_penalty("speeding", 10, "超过训练限速 40 km/h，请松油门减速。")
	if vehicle.position.x < -0.3 and absf(vehicle.position.z) > 10:
		_penalty("wrong_side", 10, "已进入对向车道，请保持右侧通行。")
	_update_mission(delta)
	_update_lights()
	_update_camera()
	if hud_elapsed >= 0.1:
		_emit_hud()

func traffic_state() -> String:
	var phase := fmod(elapsed, 30.0)
	if phase < 12.0:
		return "red"
	if phase < 27.0:
		return "green"
	return "amber"

func _update_lights() -> void:
	var traffic := traffic_state()
	if traffic == previous_traffic:
		return
	previous_traffic = traffic
	var colors := [Color("ff4b4b"), Color("ffd355"), Color("4fffa2")]
	var names := ["red", "amber", "green"]
	for n in range(lamp_materials.size()):
		lamp_materials[n].albedo_color = colors[n] if names[n] == traffic else colors[n].darkened(0.86)

func _update_mission(delta: float) -> void:
	if mission == "junction":
		if stage == 0 and vehicle.position.z < 23 and vehicle.position.z - CAR_FRONT > STOP_LINE and speed < 0.28:
			stage = 1
			event_text = "停车位置正确。保持制动，观察信号灯。"
			event_time = 3
		if stage == 1 and traffic_state() == "green":
			stage = 2
			event_text = "绿灯亮起，确认前方安全后平稳通过。"
			event_time = 4
		if stage == 2 and vehicle.position.z < -15 and not red_violation:
			stage = 3
			_finish("路口练习完成！已完成停车观察与绿灯通行。")
		if passed_junction and stage == 0 and not red_violation:
			event_text = "本轮未完成停止线前停车，请重置后完整练习。"
			event_time = 10
	elif mission == "parking":
		if stage == 0 and indicator == "right":
			stage = 1
		if stage == 1 and vehicle.position.x > 5.1 and vehicle.position.z > 17:
			stage = 2
		if stage == 2:
			if vehicle.position.x > 5.1 and vehicle.position.x < 6.0 and speed < 0.2 and absf(sin(heading)) < 0.12 and absf(steering) < 0.15:
				parking_hold += delta
			else:
				parking_hold = 0
			if parking_hold > 1.0:
				stage = 3
		if stage == 3:
			var parked_safely := vehicle.position.x > 5.1 and vehicle.position.x < 6.0 and speed < 0.2 and absf(sin(heading)) < 0.12 and absf(steering) < 0.15
			if not parked_safely:
				stage = 2
				parking_hold = 0
			elif indicator == "off":
				_finish("靠边停车完成！已示意、靠边、回正并关闭转向灯。")

func _finish(message: String) -> void:
	complete = true
	speed = 0
	_clear_held()
	event_text = message
	event_time = 60

func _penalty(key: String, points: int, message: String) -> void:
	if not violations.has(key):
		violations[key] = true
		score = maxi(0, score - points)
	event_text = message
	event_time = 4

func _update_camera(snap: bool = false) -> void:
	car_visual.visible = camera_mode == "chase"
	cockpit_hood.visible = camera_mode == "cockpit"
	var local_pos := Vector3(0, 4.25, 8.8) if camera_mode == "chase" else Vector3(-0.38, 1.32, -0.22)
	var desired := vehicle.position + Basis(Vector3.UP, heading) * local_pos
	var target := vehicle.position + Basis(Vector3.UP, heading) * Vector3(0, 1.12, -18)
	camera.position = desired if snap or camera_mode == "cockpit" else camera.position.lerp(desired, 0.14)
	camera.look_at(target, Vector3.UP)

func _mission_text() -> String:
	if complete:
		return "训练已完成 · 可重新开始或切换项目"
	if mission == "junction":
		return ["01 / 停止线前平稳停车", "02 / 保持停车，等待绿灯", "03 / 观察安全后通过路口", "04 / 训练完成"][stage]
	if mission == "parking":
		return ["01 / 打开右转向灯", "02 / 低速靠向道路右侧", "03 / 回正方向并完全停稳", "04 / 关闭右转向灯"][mini(stage, 3)]
	return "自由练习 · 熟悉方向、油门与刹车"

func _emit_hud() -> void:
	hud_elapsed = 0
	if not OS.has_feature("web"):
		return
	var phase := fmod(elapsed, 30.0)
	var remaining := 12.0 - phase if phase < 12 else (27.0 - phase if phase < 27 else 30.0 - phase)
	var hint := event_text if event_time > 0 else "W / S 控制油门刹车，A / D 转向，C 切换视角。"
	if red_violation:
		hint = "本轮发生红灯越线，请重新开始路口练习。"
	if paused:
		hint = "训练已暂停。点击继续后再操作车辆。"
	var state := {"speed": snappedf(speed * 3.6, 0.1), "steer": snappedf(steering, 0.01), "score": score, "traffic": traffic_state(), "remaining": ceili(remaining), "camera": camera_mode, "signal": indicator, "paused": paused, "complete": complete, "mission": mission, "step": _mission_text(), "hint": hint, "x": snappedf(vehicle.position.x, 0.01), "z": snappedf(vehicle.position.z, 0.01)}
	JavaScriptBridge.eval("window.dispatchEvent(new CustomEvent('driving-state',{detail:" + JSON.stringify(state) + "}))", true)

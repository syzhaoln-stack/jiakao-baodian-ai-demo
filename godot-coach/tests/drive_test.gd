extends SceneTree

var failures := 0

func check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		printerr("FAIL: " + message)
	else:
		print("PASS: " + message)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var scene: PackedScene = load("res://main.tscn")
	var coach = scene.instantiate()
	root.add_child(coach)
	coach.set_physics_process(false)
	coach.reset_training("cruise")
	coach.held.throttle = true
	coach._physics_process(1.0)
	check(coach.speed > 0 and coach.vehicle.position.z < 35, "Throttle moves vehicle forward")
	var old_speed: float = coach.speed
	coach.held.brake = true
	coach._physics_process(0.2)
	check(coach.speed < old_speed, "Brake overrides simultaneous throttle")
	coach.held.brake = false
	coach.held.left = true
	coach._physics_process(1.0)
	check(coach.heading > 0 and coach.vehicle.position.x < 1.75, "Left steering moves toward left lane")
	var before_pause: Vector3 = coach.vehicle.position
	coach.paused = true
	coach._physics_process(1.0)
	check(coach.vehicle.position == before_pause, "Pause prevents vehicle movement")
	coach.reset_training("junction")
	coach.vehicle.position.z = 16
	coach.held.brake = true
	coach._physics_process(0.1)
	check(coach.stage == 1, "Stationary vehicle before stop line advances observation stage")
	coach.elapsed = 12.1
	coach._physics_process(0.1)
	check(coach.stage == 2, "Green signal advances passage stage")
	coach.held.brake = false
	coach.vehicle.position.z = 13.5
	coach.speed = 4.0
	coach._physics_process(0.2)
	check(coach.passed_junction and not coach.red_violation, "Green-light crossing is accepted")
	coach.vehicle.position.z = -16
	coach._physics_process(0.1)
	check(coach.complete and coach.speed == 0, "Full compliant route completes safely")
	coach.reset_training("junction")
	coach.vehicle.position.z = 13.5
	coach.speed = 3.0
	coach._physics_process(0.2)
	check(coach.red_violation and coach.score == 80, "Front bumper crossing red stop line loses 20 points")
	coach._physics_process(0.1)
	check(coach.score == 80, "Same violation is not repeatedly scored")
	coach.reset_training("parking")
	coach._on_web_command(["mission", "cruise"])
	check(coach.mission == "cruise", "Web bridge changes training mission")
	coach.reset_training("parking")
	coach.indicator = "right"
	coach._physics_process(0.1)
	check(coach.stage == 1, "Right indicator begins parking maneuver")
	coach.vehicle.position = Vector3(5.5, 0, 40)
	coach._physics_process(1.2)
	check(coach.stage == 3, "Aligned stationary vehicle near curb completes stopping stage")
	coach.speed = 2
	coach.indicator = "off"
	coach._physics_process(0.1)
	check(not coach.complete and coach.stage == 2, "Driving away before final indicator-off cannot complete parking")
	coach.speed = 0
	coach.indicator = "right"
	coach._physics_process(1.2)
	coach.indicator = "off"
	coach._physics_process(0.1)
	check(coach.complete, "Turning indicator off completes parking")
	coach.reset_training("parking")
	coach.indicator = "right"
	coach.held.throttle = true
	for i in range(35): coach._physics_process(1.0 / 60.0)
	coach.held.right = true
	for i in range(48): coach._physics_process(1.0 / 60.0)
	coach.held.right = false
	coach.held.left = true
	for i in range(62): coach._physics_process(1.0 / 60.0)
	coach.held.left = false
	coach.held.throttle = false
	coach.held.brake = true
	for i in range(180): coach._physics_process(1.0 / 60.0)
	coach.indicator = "off"
	coach._physics_process(1.0 / 60.0)
	check(coach.complete and coach.score == 100, "Parking is achievable through normal steering and pedal input")
	coach.reset_training("cruise")
	coach.vehicle.position.x = 5.9
	coach.heading = -PI / 2
	coach.speed = 8
	coach._physics_process(0.1)
	check(coach.speed == 0 and coach.score == 90 and coach.vehicle.position.x < 6.03, "Road edge stops vehicle inside scene")
	coach.reset_training()
	check(coach.score == 100 and coach.vehicle.position == Vector3(1.75, 0, 35) and coach.heading == 0, "Reset restores score and start position")
	coach.queue_free()
	print("Drive regression: %d failure(s)" % failures)
	quit(1 if failures else 0)

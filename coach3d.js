import * as THREE from "./vendor/three.module.min.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, delta) => value < target ? Math.min(target, value + delta) : Math.max(target, value - delta);

const SCENARIOS = {
  start: {
    start: { x: 7.4, z: 130, heading: 0, ready: false },
    tasks: [
      ["上车准备", "按下安全带按钮，确认已经系好安全带。", s => s.seatbelt],
      ["启动车辆", "踩住刹车并按下点火按钮。", s => s.ignition && s.brake],
      ["挂入 D 挡", "保持刹车，点击 D 挡。", s => s.gear === "D"],
      ["起步前示意", "按 Q 或点击左转向灯。", s => s.signal === "left"],
      ["平稳起步", "松开刹车，轻踩油门，车速达到 10 km/h。", s => s.speedKmh >= 10 && s.z < 120]
    ]
  },
  lane: {
    start: { x: 7.5, z: 105, heading: 0, ready: true },
    tasks: [
      ["打开左转向灯", "变更车道前先观察并打开左转向灯。", s => s.signal === "left"],
      ["控制车速", "保持 15–30 km/h，确认左侧车道安全。", s => s.speedKmh >= 15 && s.speedKmh <= 30],
      ["向左变道", "缓慢向左转动方向盘，越过白色虚线。", s => s.x < 4.8],
      ["回正方向", "车辆进入左侧车道后回正方向盘。", s => s.x > 1.2 && s.x < 3.9 && Math.abs(s.steer) < .22],
      ["完成变道", "关闭转向灯，在车道中央保持直行。", s => s.signal === "off" && s.x > 1.6 && s.x < 3.6 && s.laneStable > 1.5]
    ]
  },
  intersection: {
    start: { x: 7.4, z: 24, heading: 0, ready: true },
    tasks: [
      ["接近路口", "松开油门，车速降至 25 km/h 以下。", s => s.z < 3 && s.speedKmh <= 25],
      ["红灯停车", "在停止线前平稳停车，不要越线。", s => s.z < -48 && s.z > -65 && s.speedKmh < 1],
      ["等待绿灯", "保持停车，观察信号灯。", s => s.traffic === "green"],
      ["平稳通过", "确认安全后轻踩油门通过路口。", s => s.z < -92 && !s.redLightViolation],
      ["恢复车速", "通过路口后保持车道，车速不超过 40 km/h。", s => s.z < -115 && s.speedKmh > 12 && s.speedKmh <= 40]
    ]
  },
  park: {
    start: { x: 7.0, z: 82, heading: 0, ready: true },
    tasks: [
      ["打开右转向灯", "靠边停车前打开右转向灯。", s => s.signal === "right"],
      ["减速观察", "将车速降到 15 km/h 以下，观察右后方。", s => s.speedKmh > 2 && s.speedKmh <= 15],
      ["靠向路边", "轻向右转动方向盘，车身靠近道路右侧。", s => s.x > 8.35],
      ["停车回正", "回正方向并踩刹车，将车辆完全停稳。", s => s.speedKmh < .8 && Math.abs(s.steer) < .24 && s.x > 8.1],
      ["完成停车", "挂入 P 挡，关闭转向灯。", s => s.gear === "P" && s.signal === "off"]
    ]
  }
};

export class FirstPersonCoach {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.clock = new THREE.Clock();
    this.keys = { throttle: false, brake: false, left: false, right: false };
    this.manualSteer = null;
    this.state = {};
    this.scenario = "start";
    this.taskIndex = 0;
    this.taskHold = 0;
    this.running = false;
    this.violations = new Set();
    this.score = 100;
    this.npcCars = [];
    this.traffic = "green";
    this.trafficWait = 0;
    this.redLightViolation = false;
    this._raf = 0;
    this._resizeObserver = null;
    this._lastTelemetry = 0;
    this._buildRenderer();
    this._buildWorld();
    this.reset("start");
  }

  _buildRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x9fc9de, 1);
    this.container.replaceChildren(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc9de);
    this.scene.fog = new THREE.Fog(0xa7cad8, 90, 440);
    this.camera = new THREE.PerspectiveCamera(63, 1, .08, 850);
    this.camera.rotation.order = "YXZ";
    this.rearCamera = new THREE.PerspectiveCamera(48, 3.3, .1, 450);
    this.rearCamera.rotation.order = "YXZ";
    this.leftMirrorCamera = new THREE.PerspectiveCamera(44, 2.25, .1, 350);
    this.rightMirrorCamera = new THREE.PerspectiveCamera(44, 2.25, .1, 350);
    this.leftMirrorCamera.rotation.order = "YXZ";
    this.rightMirrorCamera.rotation.order = "YXZ";
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);
    this.resize();
  }

  _buildWorld() {
    const hemi = new THREE.HemisphereLight(0xeaf8ff, 0x587349, 2.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff5d7, 2.45);
    sun.position.set(-75, 110, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: 0x739c57, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.08;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x3f4549, roughness: .95, metalness: .03 });
    this._road(20, 700, 0, -105, roadMat);
    this._road(500, 20, 0, -80, roadMat);

    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb8b7ad, roughness: 1 });
    this._box(2.3, .16, 700, -11.2, .03, -105, sidewalkMat, true);
    this._box(2.3, .16, 700, 11.2, .03, -105, sidewalkMat, true);
    this._box(500, .16, 2.3, 0, .03, -91.2, sidewalkMat, true);
    this._box(500, .16, 2.3, 0, .03, -68.8, sidewalkMat, true);

    const white = new THREE.MeshStandardMaterial({ color: 0xf1f3ee, roughness: .7 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c928, roughness: .7 });
    this._box(.18, .025, 680, -.22, .025, -105, yellow);
    this._box(.18, .025, 680, .22, .025, -105, yellow);
    this._box(.18, .025, 680, 9.45, .025, -105, white);
    this._box(.18, .025, 680, -9.45, .025, -105, white);
    for (let z = 225; z > -445; z -= 12) this._box(.13, .03, 5.8, 5, .035, z, white);
    for (let x = -235; x < 235; x += 12) this._box(5.8, .03, .13, x, .035, -75, white);

    // Stop line and pedestrian crossing.
    this._box(9.2, .035, .42, 5, .04, -64.5, white);
    for (let x = .8; x < 9.5; x += 1.2) this._box(.58, .03, 5.2, x, .04, -72.4, white);
    for (let x = -9.5; x < -.8; x += 1.2) this._box(.58, .03, 5.2, x, .04, -87.6, white);

    this._buildTrafficLights();
    this._buildRoadside();
    this._buildTrainingObjects();
    this._buildNpcTraffic();
    this._buildHood();
  }

  _road(width, length, x, z, material) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    road.rotation.x = -Math.PI / 2;
    road.position.set(x, 0, z);
    road.receiveShadow = true;
    this.scene.add(road);
    return road;
  }

  _box(w, h, d, x, y, z, material, receive = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = !receive;
    mesh.receiveShadow = receive;
    this.scene.add(mesh);
    return mesh;
  }

  _buildTrafficLights() {
    this.redMaterial = new THREE.MeshStandardMaterial({ color: 0x501312, emissive: 0x120000, roughness: .4 });
    this.amberMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4b0d, emissive: 0x120c00, roughness: .4 });
    this.greenMaterial = new THREE.MeshStandardMaterial({ color: 0x0f4d2b, emissive: 0x001207, roughness: .4 });
    const makeLight = (x, z, rotation = 0) => {
      const group = new THREE.Group();
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x30383d, roughness: .6, metalness: .45 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.11, .14, 6.4, 10), poleMat);
      pole.position.y = 3.2;
      pole.castShadow = true;
      group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(4.8, .18, .18), poleMat);
      arm.position.set(rotation ? 2.3 : -2.3, 6.25, 0);
      group.add(arm);
      const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(.72, 2.1, .65), new THREE.MeshStandardMaterial({ color: 0x171d20, roughness: .5 }));
      caseMesh.position.set(rotation ? 4.5 : -4.5, 5.65, 0);
      group.add(caseMesh);
      [this.redMaterial, this.amberMaterial, this.greenMaterial].forEach((mat, index) => {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(.22, 18, 12), mat);
        lamp.scale.z = .4;
        lamp.position.set(rotation ? 4.5 : -4.5, 6.25 - index * .6, rotation ? -.34 : .34);
        group.add(lamp);
      });
      group.position.set(x, 0, z);
      group.rotation.y = rotation;
      this.scene.add(group);
    };
    makeLight(9.2, -67.5, 0);
    makeLight(-9.2, -92.5, Math.PI);
    this._setTraffic("green");
  }

  _buildRoadside() {
    const buildingColors = [0xc6c9c8, 0xd9c8ae, 0xb8c7d3, 0xd0b7ad, 0xbcc3b1];
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x6e8994, roughness: .25, metalness: .15 });
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? -1 : 1;
      const z = 220 - i * 24;
      const w = 12 + (i % 3) * 4;
      const h = 12 + (i % 5) * 4;
      const d = 11 + (i % 4) * 3;
      const x = side * (22 + (i % 4) * 3);
      const material = new THREE.MeshStandardMaterial({ color: buildingColors[i % buildingColors.length], roughness: .82 });
      const building = this._box(w, h, d, x, h / 2, z, material);
      for (let row = 0; row < Math.min(5, Math.floor(h / 3)); row++) {
        for (let col = 0; col < 3; col++) {
          const window = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.1), windowMat);
          window.position.set(x - side * (w / 2 + .012), 2.2 + row * 2.7, z - 3 + col * 3);
          window.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          this.scene.add(window);
        }
      }
      building.castShadow = true;
    }
    for (let z = 205; z > -430; z -= 24) {
      this._tree(-14.2, z + 4);
      this._tree(14.2, z - 5);
    }
    for (let z = 180; z > -420; z -= 38) {
      this._streetLight(12.6, z, true);
      this._streetLight(-12.6, z - 15, false);
    }
    this._speedSign(11.3, -10, "40");
    this._speedSign(11.3, -145, "40");
  }

  _tree(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0x6f5032, roughness: 1 }));
    trunk.position.set(x, 1.2, z);
    trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshStandardMaterial({ color: 0x3f7f3d, roughness: 1 }));
    crown.position.set(x, 3.0, z);
    crown.scale.set(1, 1.25, 1);
    crown.castShadow = true;
    this.scene.add(trunk, crown);
  }

  _streetLight(x, z, inward) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d7678, roughness: .45, metalness: .7 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, 7.5, 8), mat);
    pole.position.set(x, 3.75, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, .1, .1), mat);
    arm.position.set(x + (inward ? -1 : 1), 7.45, z);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(.7, .12, .32), new THREE.MeshStandardMaterial({ color: 0xe8e1be, emissive: 0x29230f }));
    lamp.position.set(x + (inward ? -2 : 2), 7.35, z);
    this.scene.add(pole, arm, lamp);
  }

  _speedSign(x, z, label) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0x777f82, metalness: .6 }));
    pole.position.set(x, 1.25, z);
    const texture = this._canvasTexture(256, 256, ctx => {
      ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#dd3732"; ctx.lineWidth = 24; ctx.stroke();
      ctx.fillStyle = "#1d2226"; ctx.font = "bold 90px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, 128, 132);
    });
    const sign = new THREE.Mesh(new THREE.CircleGeometry(.66, 40), new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(x, 2.7, z);
    sign.rotation.y = Math.PI;
    this.scene.add(pole, sign);
  }

  _canvasTexture(w, h, paint) {
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    paint(canvas.getContext("2d"));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  _buildTrainingObjects() {
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf05a24, roughness: .8 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: .8 });
    for (let i = 0; i < 7; i++) {
      const x = 8.6;
      const z = 150 - i * 4.5;
      const cone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(.24, .7, 16), coneMat); body.position.y = .35;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(.17, .2, .11, 16), stripeMat); stripe.position.y = .32;
      const base = new THREE.Mesh(new THREE.BoxGeometry(.55, .05, .55), new THREE.MeshStandardMaterial({ color: 0x333638 })); base.position.y = .025;
      cone.add(body, stripe, base); cone.position.set(x, 0, z); this.scene.add(cone);
    }
    const boardTexture = this._canvasTexture(512, 200, ctx => {
      ctx.fillStyle = "#1769aa"; ctx.fillRect(0, 0, 512, 200);
      ctx.fillStyle = "#fff"; ctx.font = "bold 62px Microsoft YaHei"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("科目三训练道路", 256, 104);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2), new THREE.MeshStandardMaterial({ map: boardTexture, side: THREE.DoubleSide }));
    board.position.set(-12.8, 3.2, 72); board.rotation.y = Math.PI / 2; this.scene.add(board);
  }

  _makeCar(color = 0xffffff) {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17232a, roughness: .18, metalness: .28 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, .55, 4.2), paint); body.position.y = .66; body.castShadow = true; group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, .62, 2.05), dark); cabin.position.set(0, 1.08, -.1); cabin.castShadow = true; group.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.54, .08, 1.75), paint); roof.position.set(0, 1.42, -.1); group.add(roof);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: .9 });
    for (const x of [-1, 1]) for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .23, 16), tireMat);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x * .92, .36, z); group.add(wheel);
    }
    return group;
  }

  _buildNpcTraffic() {
    const specs = [
      { x: 2.5, z: -18, speed: 6.3, color: 0x2c76c7, axis: "z" },
      { x: -2.7, z: -160, speed: -7.2, color: 0xd6d9db, axis: "z" },
      { x: -75, z: -84.5, speed: 7.4, color: 0xe6ab31, axis: "x" },
      { x: 88, z: -75.5, speed: -6.8, color: 0x49a66b, axis: "x" }
    ];
    specs.forEach(spec => {
      const mesh = this._makeCar(spec.color);
      mesh.position.set(spec.x, 0, spec.z);
      mesh.rotation.y = spec.axis === "x" ? (spec.speed > 0 ? -Math.PI / 2 : Math.PI / 2) : (spec.speed > 0 ? 0 : Math.PI);
      this.scene.add(mesh);
      this.npcCars.push({ ...spec, mesh, startX: spec.x, startZ: spec.z });
    });
  }

  _buildHood() {
    const hood = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xf5f6f4, roughness: .28, metalness: .35 });
    const main = new THREE.Mesh(new THREE.BoxGeometry(2.15, .3, 2.1), paint); main.position.set(0, -.72, -2.4); main.rotation.x = -.07; hood.add(main);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.18, .315, 2.12), new THREE.MeshStandardMaterial({ color: 0xff6a2a, roughness: .4 })); stripe.position.set(0, -.71, -2.4); stripe.rotation.x = -.07; hood.add(stripe);
    this.camera.add(hood);
    this.scene.add(this.camera);
  }

  reset(scenario = this.scenario) {
    this.scenario = SCENARIOS[scenario] ? scenario : "start";
    const config = SCENARIOS[this.scenario];
    const ready = config.start.ready;
    this.state = {
      x: config.start.x,
      z: config.start.z,
      heading: config.start.heading,
      velocity: 0,
      speedKmh: 0,
      steer: 0,
      seatbelt: ready,
      ignition: ready,
      gear: ready ? "D" : "P",
      signal: "off",
      lights: false,
      brake: false,
      laneStable: 0,
      traffic: this.scenario === "intersection" ? "red" : "green",
      redLightViolation: false
    };
    this.keys = { throttle: false, brake: false, left: false, right: false };
    this.manualSteer = null;
    this.score = 100;
    this.taskIndex = 0;
    this.taskHold = 0;
    this.violations.clear();
    this.redLightViolation = false;
    this.trafficWait = 0;
    this._setTraffic(this.state.traffic);
    this._syncCamera();
    this._emitTask();
    this._emitState(true);
    this.callbacks.onReset?.(this.scenario);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), .05);
      this._update(dt);
      this._render();
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
    this._resizeObserver?.disconnect();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  setControl(name, pressed) {
    if (name in this.keys) this.keys[name] = Boolean(pressed);
  }

  setSteering(value) {
    this.manualSteer = clamp(Number(value) || 0, -1, 1);
  }

  releaseSteering() {
    this.manualSteer = null;
  }

  toggleSeatbelt() {
    this.state.seatbelt = !this.state.seatbelt;
    if (!this.state.seatbelt && Math.abs(this.state.velocity) > .3) this._penalty("seatbelt", "行驶中未系安全带", 10);
    this._emitState(true);
  }

  toggleIgnition() {
    if (!this.state.ignition && !this.keys.brake) {
      this.callbacks.onMessage?.("请先踩住刹车再点火");
      return false;
    }
    this.state.ignition = !this.state.ignition;
    if (!this.state.ignition) this.state.velocity = 0;
    this._emitState(true);
    return true;
  }

  setGear(gear) {
    if (!/[PRND]/.test(gear)) return false;
    if (Math.abs(this.state.velocity) > .45 || !this.keys.brake) {
      this.callbacks.onMessage?.("车辆停稳并踩住刹车后换挡");
      return false;
    }
    this.state.gear = gear;
    this._emitState(true);
    return true;
  }

  toggleSignal(direction) {
    this.state.signal = this.state.signal === direction ? "off" : direction;
    this._emitState(true);
  }

  toggleLights() {
    this.state.lights = !this.state.lights;
    this._emitState(true);
  }

  _update(dt) {
    const s = this.state;
    s.brake = this.keys.brake;
    const direction = s.gear === "D" ? 1 : s.gear === "R" ? -1 : 0;
    const maxSpeed = direction > 0 ? 13.4 : 4.2;
    if (s.ignition && direction && this.keys.throttle) s.velocity += direction * 3.0 * dt;
    if (this.keys.brake) s.velocity = approach(s.velocity, 0, 7.8 * dt);
    else s.velocity = approach(s.velocity, 0, .42 * dt);
    if (!s.ignition || s.gear === "P" || s.gear === "N") s.velocity = approach(s.velocity, 0, 3.2 * dt);
    s.velocity = clamp(s.velocity, -maxSpeed, maxSpeed);

    const steerTarget = this.manualSteer !== null ? this.manualSteer : this.keys.left ? -1 : this.keys.right ? 1 : 0;
    s.steer = approach(s.steer, steerTarget, (steerTarget ? 3.3 : 2.6) * dt);
    if (Math.abs(s.velocity) > .15) s.heading -= s.steer * s.velocity * .031 * dt;
    s.heading = clamp(s.heading, -1.25, 1.25);
    const previousX = s.x;
    const previousZ = s.z;
    s.x += -Math.sin(s.heading) * s.velocity * dt;
    s.z += -Math.cos(s.heading) * s.velocity * dt;
    s.speedKmh = Math.abs(s.velocity) * 3.6;

    if (s.x > 1.7 && s.x < 3.5 && Math.abs(s.steer) < .2 && s.speedKmh > 4) s.laneStable += dt;
    else s.laneStable = 0;

    if ((previousX - 5) * (s.x - 5) < 0 && s.speedKmh > 5) {
      const movingLeft = s.x < previousX;
      if ((movingLeft && s.signal !== "left") || (!movingLeft && s.signal !== "right")) this._penalty("lane-signal", "变更车道未提前开启转向灯", 10);
    }
    if (s.x < -.1) this._penalty("center-line", "驶入对向车道", 20);
    if (Math.abs(s.x) > 9.7) this._penalty("off-road", "车辆驶出道路边线", 20);
    if (s.speedKmh > 42) this._penalty("speeding", "超过道路限速 40 km/h", 10);
    if (previousZ > -64.5 && s.z <= -64.5 && this.traffic === "red") {
      this.redLightViolation = true;
      s.redLightViolation = true;
      this._penalty("red-light", "闯红灯，未在停止线前停车", 30);
    }

    this._updateTraffic(dt);
    this._updateNpc(dt);
    this._checkCollision();
    this._updateTasks(dt);
    this._syncCamera();
    this._emitState(false);
  }

  _updateTraffic(dt) {
    if (this.scenario !== "intersection") {
      this._setTraffic("green");
      return;
    }
    const inStopZone = this.state.z < -47 && this.state.z > -65 && this.state.speedKmh < .8;
    if (this.traffic === "red" && inStopZone) this.trafficWait += dt;
    else if (this.traffic === "red") this.trafficWait = Math.max(0, this.trafficWait - dt * .25);
    if (this.trafficWait > 2.2) this._setTraffic("green");
    this.state.traffic = this.traffic;
  }

  _setTraffic(value) {
    if (this.traffic === value && this.redMaterial) {
      // still refresh after material construction
    }
    this.traffic = value;
    if (!this.redMaterial) return;
    this.redMaterial.emissive.setHex(value === "red" ? 0xff190d : 0x120000);
    this.redMaterial.color.setHex(value === "red" ? 0xf24335 : 0x501312);
    this.greenMaterial.emissive.setHex(value === "green" ? 0x19ff75 : 0x001207);
    this.greenMaterial.color.setHex(value === "green" ? 0x1ecf68 : 0x0f4d2b);
  }

  _updateNpc(dt) {
    this.npcCars.forEach(car => {
      if (car.axis === "z") {
        car.mesh.position.z -= car.speed * dt;
        if (car.speed > 0 && car.mesh.position.z < -430) car.mesh.position.z = 230;
        if (car.speed < 0 && car.mesh.position.z > 230) car.mesh.position.z = -430;
      } else {
        const canCross = this.traffic === "red";
        if (canCross) car.mesh.position.x += car.speed * dt;
        if (car.speed > 0 && car.mesh.position.x > 240) car.mesh.position.x = -240;
        if (car.speed < 0 && car.mesh.position.x < -240) car.mesh.position.x = 240;
      }
    });
  }

  _checkCollision() {
    if (this.state.speedKmh < .5) return;
    for (const car of this.npcCars) {
      const dx = this.state.x - car.mesh.position.x;
      const dz = this.state.z - car.mesh.position.z;
      if (dx * dx + dz * dz < 8) {
        this.state.velocity = 0;
        this._penalty("collision", "与其他车辆发生碰撞", 40);
        break;
      }
    }
  }

  _updateTasks(dt) {
    const tasks = SCENARIOS[this.scenario].tasks;
    if (this.taskIndex >= tasks.length) return;
    const passed = tasks[this.taskIndex][2]({ ...this.state, traffic: this.traffic, redLightViolation: this.redLightViolation });
    if (passed) this.taskHold += dt;
    else this.taskHold = 0;
    if (this.taskHold > .12) {
      this.taskIndex += 1;
      this.taskHold = 0;
      if (this.taskIndex >= tasks.length) {
        this.callbacks.onComplete?.({ scenario: this.scenario, score: this.score });
      } else this._emitTask();
    }
  }

  _emitTask() {
    const tasks = SCENARIOS[this.scenario].tasks;
    const task = tasks[Math.min(this.taskIndex, tasks.length - 1)];
    this.callbacks.onTask?.({ title: task[0], text: task[1], index: this.taskIndex, total: tasks.length });
  }

  _penalty(code, text, points) {
    if (this.violations.has(code)) return;
    this.violations.add(code);
    this.score = Math.max(0, this.score - points);
    this.callbacks.onPenalty?.({ code, text, points, score: this.score });
  }

  _syncCamera() {
    const s = this.state;
    this.camera.position.set(s.x, 1.48, s.z);
    this.camera.rotation.y = s.heading;
    this.camera.rotation.z = -s.steer * .012;
    this.rearCamera.position.set(s.x, 1.53, s.z + Math.cos(s.heading) * .2);
    this.rearCamera.rotation.set(0, s.heading + Math.PI, 0);
    this.leftMirrorCamera.position.set(s.x - Math.cos(s.heading) * .95, 1.25, s.z - Math.sin(s.heading) * .95);
    this.rightMirrorCamera.position.set(s.x + Math.cos(s.heading) * .95, 1.25, s.z + Math.sin(s.heading) * .95);
    this.leftMirrorCamera.rotation.set(0, s.heading + Math.PI + .28, 0);
    this.rightMirrorCamera.rotation.set(0, s.heading + Math.PI - .28, 0);
  }

  _emitState(force) {
    const now = performance.now();
    if (!force && now - this._lastTelemetry < 45) return;
    this._lastTelemetry = now;
    this.callbacks.onState?.({ ...this.state, score: this.score, scenario: this.scenario, taskIndex: this.taskIndex });
  }

  _render() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setClearColor(0x9fc9de, 1);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);

    const mirrorW = clamp(width * .205, 165, 270);
    const mirrorH = mirrorW * .29;
    const top = width <= 760 ? 52 : 64;
    const x = (width - mirrorW) / 2;
    const y = height - top - mirrorH;
    this.rearCamera.aspect = mirrorW / mirrorH;
    this.rearCamera.updateProjectionMatrix();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, mirrorW, mirrorH);
    this.renderer.setViewport(x, y, mirrorW, mirrorH);
    this.renderer.setClearColor(0x9fc9de, 1);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.rearCamera);

    const sideW = width <= 760 ? 112 : 180;
    const sideH = width <= 760 ? 50 : 80;
    const sideTop = width <= 760 ? 260 : 252;
    const sideInset = width <= 760 ? 6 : 18;
    const sideY = height - sideTop - sideH;
    this.leftMirrorCamera.aspect = sideW / sideH;
    this.leftMirrorCamera.updateProjectionMatrix();
    this.renderer.setScissor(sideInset, sideY, sideW, sideH);
    this.renderer.setViewport(sideInset, sideY, sideW, sideH);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.leftMirrorCamera);
    if (width > 760) {
      this.rightMirrorCamera.aspect = sideW / sideH;
      this.rightMirrorCamera.updateProjectionMatrix();
      this.renderer.setScissor(width - sideInset - sideW, sideY, sideW, sideH);
      this.renderer.setViewport(width - sideInset - sideW, sideY, sideW, sideH);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.rightMirrorCamera);
    }
    this.renderer.setScissorTest(false);
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

export { SCENARIOS };

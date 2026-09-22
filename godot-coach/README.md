# 木仓科技 · Godot 城市驾驶练习

独立的 Godot 4.7 项目。Blender 制作的 `coach-car.glb` 与 `city-block.glb` 位于 `assets/`，导出至仓库根目录的 `simulator/index.html`。

使用 Compatibility / WebGL 2 渲染与 Web 单线程模板，不依赖 SharedArrayBuffer 或额外跨域隔离响应头，可部署至 GitHub Pages。首次原始下载约 40 MB，引擎进入前显示点击开始及加载进度；HTML 操作面板使用系统中文字体。

## 操作

- W / S 或上 / 下：油门、刹车；空格亦可刹车。
- A / D 或左 / 右：方向；Q / E：转向灯。
- C：驾驶 / 跟车视角；R：重置；P：暂停。
- 手机可同时按住屏幕方向键和踏板。切换后台自动暂停。
- 三种项目：路口停车与通行、靠边停车、自由驾驶。

本演示用于操作认知。车辆运动、信号周期、限速与扣分规则是场景预设，不代表真实考试判定或完整车辆动力学。

## 构建

安装 Godot 4.7.stable 及同版本 Web 单线程导出模板后执行：

```powershell
& 'D:\迅雷下载\Godot_v4.7-stable_win64_console.exe' --headless --path godot-coach --editor --import
& 'D:\迅雷下载\Godot_v4.7-stable_win64_console.exe' --headless --path godot-coach --export-release Web ../simulator/index.html
```

将 `simulator/` 全部文件作为静态资源发布。不要用 `file://` 双击访问 Web 导出；需通过本地 HTTP 服务打开。`shell.html` 是可维护中文网页外壳，重新导出会更新 `simulator/index.html`。

## 验证

`tests/drive_test.gd` 覆盖加速、刹车优先、转向、暂停、红灯越线、完成流程、计分去重与道路边界。靠边停车还包含完整方向和踏板输入的可达性检查，以及停稳后驶离不能错误完成的回归。

```powershell
& 'D:\迅雷下载\Godot_v4.7-stable_win64_console.exe' --headless --path godot-coach --script tests/drive_test.gd
node godot-coach/tests/web-smoke.cjs
```

Web 冒烟测试使用本机 Edge 和 Playwright，在 `http://127.0.0.1:4173/simulator/` 验证 WebAssembly 启动、真实按键、视角、暂停、重置、项目切换与两指触控，保存桌面及手机横竖屏截图。可通过 `PLAYWRIGHT_MODULE` 指定本机 Playwright 模块路径。

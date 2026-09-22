# 木仓科技 · Godot 城市驾驶练习

独立的 Godot 4.7 项目。Blender 制作的 `coach-car.glb` 与 `city-block.glb` 位于 `assets/`，导出至仓库根目录的 `simulator/index.html`。

使用 Compatibility / WebGL 2 渲染与 Web 单线程模板，不依赖 SharedArrayBuffer 或额外跨域隔离响应头，可部署至 GitHub Pages。WASM 预压缩后，现代浏览器首次引擎、脚本与场景合计约 11.3 MB；HTML 操作面板使用系统中文字体。

启动按钮在引擎脚本加载完成前保持禁用。线上资源依次使用 GitHub Raw、jsDelivr、站点同源地址，文件名包含 SHA-256 内容摘要；本地服务直接使用同源文件。Raw 脚本通过正确 MIME 的 Blob 执行，压缩 WASM 使用 `DecompressionStream` 解压。资源下载显示实际进度，并设有超时与重试；下载或解压失败会返回首屏错误提示。原始 WASM/PCK 保留，缺少解压 API 的浏览器可使用约 41 MB 的兼容路径。

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
python godot-coach/prepare_web.py
```

每次导出后运行 `prepare_web.py`，生成压缩 WASM、带内容摘要的 PCK/JS，并同步源码及导出 HTML 的资源清单。将 `simulator/` 全部文件作为静态资源发布。不要用 `file://` 双击访问 Web 导出；需通过本地 HTTP 服务打开。`shell.html` 是可维护中文网页外壳，重新导出会更新 `simulator/index.html`。

## 验证

`tests/drive_test.gd` 覆盖加速、刹车优先、转向、暂停、红灯越线、完成流程、计分去重与道路边界。靠边停车还包含完整方向和踏板输入的可达性检查，以及停稳后驶离不能错误完成的回归。

```powershell
& 'D:\迅雷下载\Godot_v4.7-stable_win64_console.exe' --headless --path godot-coach --script tests/drive_test.gd
node godot-coach/tests/web-smoke.cjs
node godot-coach/tests/loader-regression.cjs
```

Web 冒烟测试使用本机 Edge 和 Playwright，在 `http://127.0.0.1:4173/simulator/` 验证 WebAssembly 启动、真实按键、视角、暂停、重置、项目切换与两指触控，保存桌面及手机横竖屏截图。可通过 `PLAYWRIGHT_MODULE` 指定本机 Playwright 模块路径。

加载器回归测试用自有虚拟 HTTPS 站点验证 Raw 的 text/plain + nosniff 脚本、压缩资源加载、Raw 失败后切换 CDN、所有资源失败后及时显示错误，以及脚本未就绪时开始按钮禁用。

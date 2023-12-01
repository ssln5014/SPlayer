import { join } from "path";
import { app, protocol, shell, BrowserWindow, globalShortcut } from "electron";
import { optimizer, is } from "@electron-toolkit/utils";
import { startNcmServer } from "@main/startNcmServer";
import { startMainServer } from "@main/startMainServer";
import { configureAutoUpdater } from "@main/utils/checkUpdates";
import createSystemInfo from "@main/utils/createSystemInfo";
import createGlobalShortcut from "@main/utils/createGlobalShortcut";
import mainIpcMain from "@main/mainIpcMain";
import Store from "electron-store";
import log from "electron-log";

// 屏蔽报错
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

// 配置 log
log.transports.file.resolvePathFn = () =>
  join(app.getPath("documents"), "/SPlayer/splayer-log.txt");
// 设置日志文件的最大大小为 2 MB
log.transports.file.maxSize = 2 * 1024 * 1024;
// 绑定 console 事件
console.error = log.error.bind(log);
console.warn = log.warn.bind(log);
console.info = log.info.bind(log);
console.debug = log.debug.bind(log);

// 主进程
class MainProcess {
  constructor() {
    // 主窗口
    this.mainWindow = null;
    // 主代理
    this.mainServer = null;
    // 网易云 API
    this.ncmServer = null;
    // Store
    this.store = new Store({
      // 窗口大小
      windowSize: {
        width: { type: "number", default: 1280 },
        height: { type: "number", default: 740 },
      },
    });
    // 初始化
    this.init();
  }

  // 初始化程序
  async init() {
    log.info("主进程初始化");

    // 单例锁
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      log.error("已有一个程序正在运行，本次启动阻止");
    }

    // 启动网易云 API
    this.ncmServer = await startNcmServer({
      port: import.meta.env.MAIN_VITE_SERVER_PORT,
      host: import.meta.env.MAIN_VITE_SERVER_HOST,
    });

    // 非开发环境启动代理
    if (!is.dev) {
      this.mainServer = await startMainServer();
    }

    // 注册应用协议
    app.setAsDefaultProtocolClient("splayer");
    // 应用程序准备好之前注册
    protocol.registerSchemesAsPrivileged([
      { scheme: "app", privileges: { secure: true, standard: true } },
    ]);

    // 主应用程序事件
    this.mainAppEvents();
  }

  // 创建主窗口
  createWindow() {
    // 创建浏览器窗口
    this.mainWindow = new BrowserWindow({
      width: this.store.get("windowSize.width") || 1280, // 窗口宽度
      height: this.store.get("windowSize.height") || 740, // 窗口高度
      minHeight: 700, // 最小高度
      minWidth: 1200, // 最小宽度
      center: true, // 是否出现在屏幕居中的位置
      show: false, // 初始时不显示窗口
      frame: false, // 无边框
      titleBarStyle: "customButtonsOnHover", // Macos 隐藏菜单栏
      autoHideMenuBar: true, // 失去焦点后自动隐藏菜单栏
      // 图标配置
      icon: join(__dirname, "../../public/images/logo/favicon.png"),
      // 预加载
      webPreferences: {
        // devTools: is.dev, //是否开启 DevTools
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        webSecurity: false,
        hardwareAcceleration: true,
      },
    });

    // 窗口准备就绪时显示窗口
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow.show();
      // mainWindow.maximize();
      this.store.set("windowSize", this.mainWindow.getBounds());
    });

    // 主窗口事件
    this.mainWindowEvents();

    // 设置窗口打开处理程序
    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: "deny" };
    });

    // 渲染路径
    // 在开发模式
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    }
    // 生产模式
    else {
      this.mainWindow.loadURL(`http://127.0.0.1:${import.meta.env.MAIN_VITE_MAIN_PORT ?? 7899}`);
    }

    // 监听关闭
    this.mainWindow.on("close", (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        this.mainWindow.hide();
      }
      return false;
    });
  }

  // 主应用程序事件
  mainAppEvents() {
    app.on("ready", async () => {
      // 创建主窗口
      this.createWindow();
      // 检测更新
      configureAutoUpdater(process.platform);
      // 创建系统信息
      createSystemInfo(this.mainWindow);
      // 引入主 Ipc
      mainIpcMain(this.mainWindow);
      // 注册快捷键
      createGlobalShortcut(this.mainWindow);
    });

    // 在开发模式下默认通过 F12 打开或关闭 DevTools
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // 在 macOS 上，当单击 Dock 图标且没有其他窗口时，通常会重新创建窗口
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) this.createWindow();
    });

    // 自定义协议
    app.on("open-url", (_, url) => {
      console.log("Received custom protocol URL:", url);
    });

    // 将要退出
    app.on("will-quit", () => {
      // 注销全部快捷键
      globalShortcut.unregisterAll();
    });

    // 当所有窗口都关闭时退出应用，macOS 除外
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });
  }

  // 主窗口事件
  mainWindowEvents() {
    this.mainWindow.on("show", () => {
      this.mainWindow.webContents.send("lyricsScroll");
    });

    // this.mainWindow.on("hide", () => {
    //   console.info("窗口隐藏");
    // });

    this.mainWindow.on("focus", () => {
      this.mainWindow.webContents.send("lyricsScroll");
    });

    // this.mainWindow.on("blur", () => {
    //   console.info("窗口失去焦点");
    // });

    this.mainWindow.on("maximize", () => {
      this.mainWindow.webContents.send("windowState", true);
    });

    this.mainWindow.on("unmaximize", () => {
      this.mainWindow.webContents.send("windowState", false);
    });

    this.mainWindow.on("resized", () => {
      this.store.set("windowSize", this.mainWindow.getBounds());
    });

    this.mainWindow.on("moved", () => {
      this.store.set("windowSize", this.mainWindow.getBounds());
    });
  }
}

new MainProcess();
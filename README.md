# 斗地主局域网小游戏

## 依赖

只需要安装 Node.js 18 或更新版本。本项目没有第三方 npm 依赖。

## 启动

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

指定端口：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1 -Port 3001
```

也可以直接使用 npm：

```sh
npm start
```

启动后终端会打印本机和局域网访问地址。把局域网地址发给另外两名玩家即可。

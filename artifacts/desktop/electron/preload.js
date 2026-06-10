"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("gymproDesktop", {
  version: process.env.npm_package_version ?? "1.0.0",
  platform: process.platform,
});

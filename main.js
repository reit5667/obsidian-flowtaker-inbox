var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TelegramInboxPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULTS = {
  botToken: "",
  allowedUserId: 0,
  inboxPath: "inbox",
  pollingIntervalSeconds: 30,
  lastUpdateId: 0
};
function buildFilename(utcSec) {
  const d = new Date((utcSec + 3 * 3600) * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${d.getUTCFullYear()}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.md`;
}
function buildIso(utcSec) {
  return new Date((utcSec + 3 * 3600) * 1e3).toISOString().slice(0, 19);
}
function getForwardedFrom(msg) {
  var _a, _b, _c, _d;
  const o = msg.forward_origin;
  if (o) {
    if (o.type === "user" && o.sender_user) {
      return [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ");
    }
    if (o.type === "hidden_user")
      return (_a = o.sender_user_name) != null ? _a : null;
    if (o.type === "chat" && o.sender_chat)
      return o.sender_chat.title;
    if (o.type === "channel" && o.chat)
      return o.chat.title;
  }
  if (msg.forward_from) {
    return [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(" ");
  }
  return (_d = (_c = msg.forward_sender_name) != null ? _c : (_b = msg.forward_from_chat) == null ? void 0 : _b.title) != null ? _d : null;
}
function buildContent(text, utcSec, forwardedFrom) {
  let fm = `---
created: ${buildIso(utcSec)}
source: telegram`;
  if (forwardedFrom)
    fm += `
forwarded_from: ${forwardedFrom}`;
  fm += "\n---\n\n";
  return fm + text;
}
var TelegramInboxPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TelegramInboxSettingTab(this.app, this));
    this.startPolling();
  }
  startPolling() {
    if (!import_obsidian.Platform.isDesktop)
      return;
    const ms = Math.max(5, this.settings.pollingIntervalSeconds) * 1e3;
    this.registerInterval(window.setInterval(() => this.poll(), ms));
    this.poll();
  }
  async poll() {
    if (!this.settings.botToken || !this.settings.allowedUserId)
      return;
    try {
      const url = `https://api.telegram.org/bot${this.settings.botToken}/getUpdates?offset=${this.settings.lastUpdateId + 1}&timeout=5&limit=100`;
      const res = await (0, import_obsidian.requestUrl)({ url });
      const data = res.json;
      if (!data.ok || !data.result.length)
        return;
      for (const update of data.result) {
        await this.handleUpdate(update);
      }
    } catch (e) {
      console.error("TelegramInbox poll error:", e);
    }
  }
  async handleUpdate(update) {
    var _a;
    this.settings.lastUpdateId = update.update_id;
    const msg = update.message;
    if (!msg || ((_a = msg.from) == null ? void 0 : _a.id) !== this.settings.allowedUserId) {
      await this.saveData(this.settings);
      return;
    }
    if (!msg.text) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F \u041F\u043E\u043A\u0430 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435\u043A\u0441\u0442. \u041F\u0440\u043E\u0441\u0442\u043E \u043D\u0430\u043F\u0438\u0448\u0438 \u0447\u0442\u043E \u0445\u043E\u0447\u0435\u0448\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C.");
      await this.saveData(this.settings);
      return;
    }
    const filename = buildFilename(msg.date);
    const content = buildContent(msg.text, msg.date, getForwardedFrom(msg));
    const path = `${this.settings.inboxPath.replace(/\/$/, "")}/${filename}`;
    try {
      await this.ensureFolder(this.settings.inboxPath);
      await this.app.vault.create(path, content);
      new import_obsidian.Notice(`\u2705 ${filename}`);
      await this.sendMessage(msg.from.id, `\u2705 \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: ${filename}`);
    } catch (e) {
      console.error("TelegramInbox create error:", path, e);
      new import_obsidian.Notice(`\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${filename}`);
    }
    await this.saveData(this.settings);
  }
  async ensureFolder(path) {
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  async sendMessage(chatId, text) {
    try {
      await (0, import_obsidian.requestUrl)({
        url: `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
    } catch (e) {
      console.error("TelegramInbox sendMessage error:", e);
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var TelegramInboxSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Bot Token").setDesc("Telegram bot token \u043E\u0442 BotFather").addText(
      (t) => t.setPlaceholder("1234567890:AAF...").setValue(this.plugin.settings.botToken).onChange(async (v) => {
        this.plugin.settings.botToken = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Allowed User ID").setDesc("Telegram user ID \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u044D\u0442\u043E\u0442 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C").addText(
      (t) => t.setPlaceholder("5152249676").setValue(this.plugin.settings.allowedUserId ? String(this.plugin.settings.allowedUserId) : "").onChange(async (v) => {
        const id = parseInt(v.trim());
        if (!isNaN(id)) {
          this.plugin.settings.allowedUserId = id;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Inbox Path").setDesc("\u041F\u0430\u043F\u043A\u0430 \u0432 vault \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0445 \u0437\u0430\u043C\u0435\u0442\u043E\u043A").addText(
      (t) => t.setPlaceholder("inbox").setValue(this.plugin.settings.inboxPath).onChange(async (v) => {
        this.plugin.settings.inboxPath = v.trim() || "inbox";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Polling Interval (\u0441\u0435\u043A\u0443\u043D\u0434\u044B)").setDesc("\u041A\u0430\u043A \u0447\u0430\u0441\u0442\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0442\u044C \u043D\u043E\u0432\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (\u043C\u0438\u043D\u0438\u043C\u0443\u043C 5)").addText(
      (t) => t.setPlaceholder("30").setValue(String(this.plugin.settings.pollingIntervalSeconds)).onChange(async (v) => {
        const n = parseInt(v.trim());
        if (!isNaN(n) && n >= 5) {
          this.plugin.settings.pollingIntervalSeconds = n;
          await this.plugin.saveSettings();
        }
      })
    );
  }
};

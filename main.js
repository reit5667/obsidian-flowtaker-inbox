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
  lastUpdateId: 0,
  groqApiKey: "",
  lastSavedFile: ""
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
function extractTags(text) {
  var _a;
  const matches = (_a = text.match(/#[\wа-яёА-ЯЁ]+/gu)) != null ? _a : [];
  return matches.map((t) => t.slice(1));
}
function buildContent(text, utcSec, forwardedFrom, tags, type) {
  let fm = `---
created: ${buildIso(utcSec)}
source: telegram
type: ${type}`;
  if (forwardedFrom)
    fm += `
forwarded_from: ${forwardedFrom}`;
  if (tags.length)
    fm += `
tags: [${tags.join(", ")}]`;
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
    if (msg.text === "/status") {
      const last = this.settings.lastSavedFile || "\u043D\u0435\u0442";
      await this.sendMessage(msg.from.id, `\u2705 \u041F\u043B\u0430\u0433\u0438\u043D \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442.
\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435: ${last}`);
      await this.saveData(this.settings);
      return;
    }
    if (msg.voice) {
      await this.handleVoice(msg);
      return;
    }
    if (!msg.text) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F \u041F\u043E\u043A\u0430 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435\u043A\u0441\u0442 \u0438 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435.");
      await this.saveData(this.settings);
      return;
    }
    const tags = extractTags(msg.text);
    await this.saveNote(msg.text, msg.date, getForwardedFrom(msg), tags, msg.from.id, "text");
    await this.saveData(this.settings);
  }
  async handleVoice(msg) {
    if (!msg.voice || !msg.from)
      return;
    if (!this.settings.groqApiKey) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F Groq API key \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D. \u0414\u043E\u0431\u0430\u0432\u044C \u0435\u0433\u043E \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445 \u043F\u043B\u0430\u0433\u0438\u043D\u0430.");
      await this.saveData(this.settings);
      return;
    }
    await this.sendMessage(msg.from.id, "\u23F3 \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u044E \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435...");
    const text = await this.transcribeVoice(msg.voice.file_id);
    if (!text) {
      await this.sendMessage(msg.from.id, "\u274C \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u0442\u044C. \u041F\u0440\u043E\u0432\u0435\u0440\u044C Groq API key.");
      await this.saveData(this.settings);
      return;
    }
    const body = `\u{1F3A4} _\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435_

${text}`;
    await this.saveNote(body, msg.date, getForwardedFrom(msg), extractTags(text), msg.from.id, "voice");
    await this.saveData(this.settings);
  }
  async transcribeVoice(fileId) {
    var _a, _b, _c, _d;
    try {
      const fileRes = await (0, import_obsidian.requestUrl)({
        url: `https://api.telegram.org/bot${this.settings.botToken}/getFile?file_id=${fileId}`
      });
      const filePath = (_b = (_a = fileRes.json) == null ? void 0 : _a.result) == null ? void 0 : _b.file_path;
      if (!filePath)
        return null;
      const audioRes = await (0, import_obsidian.requestUrl)({
        url: `https://api.telegram.org/file/bot${this.settings.botToken}/${filePath}`
      });
      const boundary = "----FlowBoundary" + Math.random().toString(36).slice(2);
      const enc = new TextEncoder();
      const preamble = enc.encode(
        `--${boundary}\r
Content-Disposition: form-data; name="model"\r
\r
whisper-large-v3-turbo\r
--${boundary}\r
Content-Disposition: form-data; name="file"; filename="voice.ogg"\r
Content-Type: audio/ogg\r
\r
`
      );
      const epilogue = enc.encode(`\r
--${boundary}--\r
`);
      const audio = new Uint8Array(audioRes.arrayBuffer);
      const body = new Uint8Array(preamble.byteLength + audio.byteLength + epilogue.byteLength);
      body.set(preamble, 0);
      body.set(audio, preamble.byteLength);
      body.set(epilogue, preamble.byteLength + audio.byteLength);
      const groqRes = await (0, import_obsidian.requestUrl)({
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.settings.groqApiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`
        },
        body: body.buffer
      });
      return (_d = (_c = groqRes.json) == null ? void 0 : _c.text) != null ? _d : null;
    } catch (e) {
      console.error("TelegramInbox transcribe error:", e);
      return null;
    }
  }
  async saveNote(text, utcSec, forwardedFrom, tags, chatId, type) {
    const filename = buildFilename(utcSec);
    const content = buildContent(text, utcSec, forwardedFrom, tags, type);
    const path = `${this.settings.inboxPath.replace(/\/$/, "")}/${filename}`;
    try {
      await this.ensureFolder(this.settings.inboxPath);
      await this.app.vault.create(path, content);
      this.settings.lastSavedFile = filename;
      new import_obsidian.Notice(`\u2705 ${filename}`);
      await this.sendMessage(chatId, `\u2705 \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: ${filename}`);
    } catch (e) {
      console.error("TelegramInbox create error:", path, e);
      new import_obsidian.Notice(`\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${filename}`);
    }
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
    new import_obsidian.Setting(containerEl).setName("Groq API Key").setDesc("\u0414\u043B\u044F \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439. \u041F\u043E\u043B\u0443\u0447\u0438\u0442\u044C: console.groq.com").addText(
      (t) => t.setPlaceholder("gsk_...").setValue(this.plugin.settings.groqApiKey).onChange(async (v) => {
        this.plugin.settings.groqApiKey = v.trim();
        await this.plugin.saveSettings();
      })
    );
  }
};

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
  todosPath: "backlog.md",
  sprintPath: "daily.todos.4.md",
  pollingIntervalSeconds: 30,
  lastUpdateId: 0,
  groqApiKey: "",
  lastSavedFile: "",
  autoRouteToSprint: false,
  pendingTasks: {}
};
function buildFilename(utcSec) {
  const d = new Date(utcSec * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.md`;
}
function buildIso(utcSec) {
  const d = new Date(utcSec * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
function stripTags(text) {
  return text.replace(/#[\wа-яёА-ЯЁ]+/gu, "").replace(/[ \t]+\n/g, "\n").trim();
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
  return fm + stripTags(text);
}
var TelegramInboxPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.isPolling = false;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TelegramInboxSettingTab(this.app, this));
    this.startPolling();
  }
  startPolling() {
    const ms = Math.max(5, this.settings.pollingIntervalSeconds) * 1e3;
    this.registerInterval(window.setInterval(() => this.poll(), ms));
    setTimeout(() => this.poll(), 3e3);
  }
  async poll() {
    if (!this.settings.botToken || !this.settings.allowedUserId)
      return;
    if (this.isPolling)
      return;
    this.isPolling = true;
    try {
      const allowedUpdates = encodeURIComponent(JSON.stringify(["message", "callback_query"]));
      const url = `https://api.telegram.org/bot${this.settings.botToken}/getUpdates?offset=${this.settings.lastUpdateId + 1}&timeout=5&limit=100&allowed_updates=${allowedUpdates}`;
      const res = await (0, import_obsidian.requestUrl)({ url });
      const data = res.json;
      if (!data.ok || !data.result.length)
        return;
      for (const update of data.result) {
        await this.handleUpdate(update);
      }
    } catch (e) {
      console.error("TelegramInbox poll error:", e);
    } finally {
      this.isPolling = false;
    }
  }
  async handleUpdate(update) {
    var _a, _b;
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query, update.update_id);
      return;
    }
    const msg = update.message;
    if (!msg || ((_a = msg.from) == null ? void 0 : _a.id) !== this.settings.allowedUserId) {
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }
    if (msg.text === "/status") {
      const last = this.settings.lastSavedFile || "none";
      await this.sendMessage(msg.from.id, `\u2705 Plugin is running.
Last saved: ${last}`);
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }
    if (msg.text === "/start" || msg.text === "/help") {
      await this.sendMessage(
        msg.from.id,
        "\u{1F44B} Send me a text or voice message and I'll save it to your Obsidian vault.\n\n\u2022 #tag \u2192 adds a tag\n\u2022 #todo \u2192 adds a task (I'll ask sprint or backlog)\n\u2022 Forward a message \u2192 source is recorded\n\u2022 /status \u2192 shows the last saved file"
      );
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }
    if ((_b = msg.text) == null ? void 0 : _b.startsWith("/")) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F Unknown command. Send /help to see what I can do.");
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }
    if (msg.voice) {
      await this.handleVoice(msg, update.update_id);
      return;
    }
    if (!msg.text) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F Only text and voice messages are supported.");
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }
    const tags = extractTags(msg.text);
    const hasTodoTag = tags.includes("todo") || tags.includes("todos");
    const saved = hasTodoTag ? await this.processTodosMessage(msg.text, msg.message_id, msg.from.id) : await this.saveNote(msg.text, msg.date, getForwardedFrom(msg), tags, msg.from.id, "text");
    if (saved) {
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
    }
  }
  async handleCallbackQuery(cq, updateId) {
    var _a;
    await this.answerCallbackQuery(cq.id);
    const data = (_a = cq.data) != null ? _a : "";
    const colonIdx = data.indexOf(":");
    const dest = data.slice(0, colonIdx);
    const msgId = parseInt(data.slice(colonIdx + 1));
    const tasks = this.settings.pendingTasks[String(msgId)];
    if (!tasks || !["sprint", "backlog"].includes(dest)) {
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
      return;
    }
    delete this.settings.pendingTasks[String(msgId)];
    const targetPath = dest === "sprint" ? this.settings.sprintPath || "daily.todos.4.md" : this.settings.todosPath || "backlog.md";
    const label = dest === "sprint" ? "sprint" : "backlog";
    await this.appendTodos(tasks, targetPath, cq.from.id, label);
    this.settings.lastUpdateId = updateId;
    await this.saveData(this.settings);
  }
  async handleVoice(msg, updateId) {
    if (!msg.voice || !msg.from)
      return;
    if (!this.settings.groqApiKey) {
      await this.sendMessage(msg.from.id, "\u26A0\uFE0F Groq API key is not set. Add it in plugin settings.");
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
      return;
    }
    await this.sendMessage(msg.from.id, "\u23F3 Transcribing voice message...");
    const text = await this.transcribeVoice(msg.voice.file_id);
    if (!text) {
      await this.sendMessage(msg.from.id, "\u274C Transcription failed. Check your Groq API key.");
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
      return;
    }
    const body = `\u{1F3A4} _\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435_

${text}`;
    const saved = await this.saveNote(body, msg.date, getForwardedFrom(msg), extractTags(text), msg.from.id, "voice");
    if (saved) {
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
    }
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
      await this.sendMessage(chatId, `\u2705 Saved: ${filename}`);
      return true;
    } catch (e) {
      console.error("TelegramInbox create error:", path, e);
      new import_obsidian.Notice(`\u274C Error: ${filename}`);
      return false;
    }
  }
  async processTodosMessage(text, msgId, chatId) {
    const lines = [];
    const taskTexts = [];
    let todoMode = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line)
        continue;
      const lineTags = extractTags(line);
      if (lineTags.includes("todo") && !lineTags.includes("todos")) {
        const taskText = line.replace(/#todo\b/giu, "").replace(/\s{2,}/g, " ").trim();
        if (taskText) {
          lines.push(`- [ ] ${taskText}`);
          taskTexts.push(taskText);
        } else {
          todoMode = true;
        }
      } else if (lineTags.includes("todos")) {
        todoMode = false;
        const contextText = line.replace(/#todos\b/giu, "").replace(/\s{2,}/g, " ").trim();
        if (contextText)
          lines.push(contextText);
      } else if (todoMode) {
        lines.push(`- [ ] ${line}`);
        taskTexts.push(line);
      } else {
        lines.push(line);
      }
    }
    if (!lines.length)
      return true;
    if (this.settings.autoRouteToSprint) {
      await this.appendTodos(lines, this.settings.sprintPath || "daily.todos.4.md", chatId, "sprint");
      return true;
    }
    this.settings.pendingTasks[String(msgId)] = lines;
    await this.saveData(this.settings);
    const preview = taskTexts.length ? taskTexts.map((t) => `\u2022 ${t.length > 50 ? t.slice(0, 50) + "\u2026" : t}`).join("\n") : lines[0];
    await this.sendMessageWithButtons(
      chatId,
      `\u{1F4CB} Where to add?

${preview}`,
      msgId
    );
    return true;
  }
  async appendTodos(lines, filePath, chatId, label) {
    var _a, _b;
    try {
      const folder = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (folder)
        await this.ensureFolder(folder);
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      const entry = lines.join("\n") + "\n";
      if (existing instanceof import_obsidian.TFile) {
        const content = await this.app.vault.read(existing);
        const inboxHeading = "\n##### \u0412\u0445\u043E\u0434\u044F\u0449\u0438\u0435";
        const inboxIdx = content.indexOf(inboxHeading);
        if (inboxIdx !== -1) {
          const afterHeading = content.indexOf("\n", inboxIdx + 1);
          const insertAt = afterHeading !== -1 ? afterHeading : content.length;
          await this.app.vault.modify(existing, content.slice(0, insertAt) + "\n" + entry + content.slice(insertAt));
        } else {
          const separator = content.endsWith("\n") ? "" : "\n";
          await this.app.vault.modify(existing, content + separator + entry);
        }
      } else {
        await this.app.vault.create(filePath, entry);
      }
      const firstTask = (_b = (_a = lines.find((l) => l.startsWith("- [ ]"))) == null ? void 0 : _a.slice(6)) != null ? _b : lines[0];
      new import_obsidian.Notice(`\u2705 ${label}: ${firstTask.slice(0, 40)}`);
      await this.sendMessage(chatId, `\u2705 Added to ${label}`);
    } catch (e) {
      console.error("TelegramInbox appendTodos error:", filePath, e);
      new import_obsidian.Notice("\u274C Failed to save task");
      await this.sendMessage(chatId, "\u274C Failed to save task");
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
  async sendMessageWithButtons(chatId, text, msgId) {
    try {
      await (0, import_obsidian.requestUrl)({
        url: `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: "\u{1F4CB} To sprint", callback_data: `sprint:${msgId}` },
              { text: "\u{1F4E6} To backlog", callback_data: `backlog:${msgId}` }
            ]]
          }
        })
      });
    } catch (e) {
      console.error("TelegramInbox sendMessageWithButtons error:", e);
    }
  }
  async answerCallbackQuery(callbackQueryId) {
    try {
      await (0, import_obsidian.requestUrl)({
        url: `https://api.telegram.org/bot${this.settings.botToken}/answerCallbackQuery`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId })
      });
    } catch (e) {
      console.error("TelegramInbox answerCallbackQuery error:", e);
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
    new import_obsidian.Setting(containerEl).setName("Bot Token").setDesc("Telegram bot token from @BotFather").addText(
      (t) => t.setPlaceholder("1234567890:AAF...").setValue(this.plugin.settings.botToken).onChange(async (v) => {
        this.plugin.settings.botToken = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Allowed User ID").setDesc("Only messages from this Telegram user ID will be processed").addText(
      (t) => t.setPlaceholder("5152249676").setValue(this.plugin.settings.allowedUserId ? String(this.plugin.settings.allowedUserId) : "").onChange(async (v) => {
        const id = parseInt(v.trim());
        if (!isNaN(id)) {
          this.plugin.settings.allowedUserId = id;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Inbox Path").setDesc("Vault folder where incoming notes are saved").addText(
      (t) => t.setPlaceholder("inbox").setValue(this.plugin.settings.inboxPath).onChange(async (v) => {
        this.plugin.settings.inboxPath = v.trim() || "inbox";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sprint Path").setDesc("File for active sprint tasks (messages with #todo \u2192 'To sprint' button)").addText(
      (t) => t.setPlaceholder("daily.todos.4.md").setValue(this.plugin.settings.sprintPath).onChange(async (v) => {
        this.plugin.settings.sprintPath = v.trim() || "daily.todos.4.md";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Backlog Path").setDesc("File for backlog tasks (messages with #todo \u2192 'To backlog' button)").addText(
      (t) => t.setPlaceholder("backlog.md").setValue(this.plugin.settings.todosPath).onChange(async (v) => {
        this.plugin.settings.todosPath = v.trim() || "backlog.md";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Always add to sprint").setDesc("Skip the sprint/backlog choice and send #todo tasks directly to the sprint file").addToggle(
      (t) => t.setValue(this.plugin.settings.autoRouteToSprint).onChange(async (v) => {
        this.plugin.settings.autoRouteToSprint = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Polling Interval (seconds)").setDesc("How often to check for new messages (minimum 5)").addText(
      (t) => t.setPlaceholder("30").setValue(String(this.plugin.settings.pollingIntervalSeconds)).onChange(async (v) => {
        const n = parseInt(v.trim());
        if (!isNaN(n) && n >= 5) {
          this.plugin.settings.pollingIntervalSeconds = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Groq API Key").setDesc("For voice message transcription. Get one at console.groq.com (free tier available)").addText(
      (t) => t.setPlaceholder("gsk_...").setValue(this.plugin.settings.groqApiKey).onChange(async (v) => {
        this.plugin.settings.groqApiKey = v.trim();
        await this.plugin.saveSettings();
      })
    );
  }
};

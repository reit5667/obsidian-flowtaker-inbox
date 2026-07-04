import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from "obsidian";

interface Settings {
  botToken: string;
  allowedUserId: number;
  inboxPath: string;
  todosPath: string;
  sprintPath: string;
  pollingIntervalSeconds: number;
  lastUpdateId: number;
  groqApiKey: string;
  lastSavedFile: string;
}

const DEFAULTS: Settings = {
  botToken: "",
  allowedUserId: 0,
  inboxPath: "inbox",
  todosPath: "backlog.md",
  sprintPath: "daily.todos.4.md",
  pollingIntervalSeconds: 30,
  lastUpdateId: 0,
  groqApiKey: "",
  lastSavedFile: "",
};

// --- Telegram API types ---

interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TgVoice {
  file_id: string;
  duration: number;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  date: number;
  text?: string;
  voice?: TgVoice;
  forward_origin?: {
    type: "user" | "hidden_user" | "chat" | "channel";
    sender_user?: TgUser;
    sender_user_name?: string;
    sender_chat?: { title: string };
    chat?: { title: string };
  };
  forward_from?: TgUser;
  forward_sender_name?: string;
  forward_from_chat?: { title: string };
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

// --- Helpers ---

function buildFilename(utcSec: number): string {
  const d = new Date((utcSec + 3 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${d.getUTCFullYear()}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.md`;
}

function buildIso(utcSec: number): string {
  return new Date((utcSec + 3 * 3600) * 1000).toISOString().slice(0, 19);
}

function getForwardedFrom(msg: TgMessage): string | null {
  const o = msg.forward_origin;
  if (o) {
    if (o.type === "user" && o.sender_user) {
      return [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ");
    }
    if (o.type === "hidden_user") return o.sender_user_name ?? null;
    if (o.type === "chat" && o.sender_chat) return o.sender_chat.title;
    if (o.type === "channel" && o.chat) return o.chat.title;
  }
  if (msg.forward_from) {
    return [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(" ");
  }
  return msg.forward_sender_name ?? msg.forward_from_chat?.title ?? null;
}

function extractTags(text: string): string[] {
  const matches = text.match(/#[\wа-яёА-ЯЁ]+/gu) ?? [];
  return matches.map((t) => t.slice(1));
}

function stripTags(text: string): string {
  return text.replace(/#[\wа-яёА-ЯЁ]+/gu, "").replace(/[ \t]+\n/g, "\n").trim();
}

function buildContent(text: string, utcSec: number, forwardedFrom: string | null, tags: string[], type: "text" | "voice"): string {
  let fm = `---\ncreated: ${buildIso(utcSec)}\nsource: telegram\ntype: ${type}`;
  if (forwardedFrom) fm += `\nforwarded_from: ${forwardedFrom}`;
  if (tags.length) fm += `\ntags: [${tags.join(", ")}]`;
  fm += "\n---\n\n";
  return fm + stripTags(text);
}

// --- Plugin ---

export default class TelegramInboxPlugin extends Plugin {
  settings: Settings;
  private pendingTasks = new Map<number, string[]>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TelegramInboxSettingTab(this.app, this));
    this.startPolling();
  }

  startPolling() {
    const ms = Math.max(5, this.settings.pollingIntervalSeconds) * 1000;
    this.registerInterval(window.setInterval(() => this.poll(), ms));
    setTimeout(() => this.poll(), 3000);
  }

  async poll() {
    if (!this.settings.botToken || !this.settings.allowedUserId) return;
    try {
      const url = `https://api.telegram.org/bot${this.settings.botToken}/getUpdates?offset=${this.settings.lastUpdateId + 1}&timeout=5&limit=100`;
      const res = await requestUrl({ url });
      const data = res.json as { ok: boolean; result: TgUpdate[] };
      if (!data.ok || !data.result.length) return;
      for (const update of data.result) {
        await this.handleUpdate(update);
      }
    } catch (e) {
      console.error("TelegramInbox poll error:", e);
    }
  }

  async handleUpdate(update: TgUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query, update.update_id);
      return;
    }

    const msg = update.message;

    if (!msg || msg.from?.id !== this.settings.allowedUserId) {
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }

    if (msg.text === "/status") {
      const last = this.settings.lastSavedFile || "none";
      await this.sendMessage(msg.from.id, `✅ Plugin is running.\nLast saved: ${last}`);
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }

    if (msg.voice) {
      await this.handleVoice(msg, update.update_id);
      return;
    }

    if (!msg.text) {
      await this.sendMessage(msg.from.id, "⚠️ Only text and voice messages are supported.");
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
      return;
    }

    const tags = extractTags(msg.text);
    const hasTodoTag = tags.includes("todo") || tags.includes("todos");
    const saved = hasTodoTag
      ? await this.processTodosMessage(msg.text, msg.message_id, msg.from.id)
      : await this.saveNote(msg.text, msg.date, getForwardedFrom(msg), tags, msg.from.id, "text");
    if (saved) {
      this.settings.lastUpdateId = update.update_id;
      await this.saveData(this.settings);
    }
  }

  async handleCallbackQuery(cq: TgCallbackQuery, updateId: number) {
    await this.answerCallbackQuery(cq.id);

    const data = cq.data ?? "";
    const colonIdx = data.indexOf(":");
    const dest = data.slice(0, colonIdx);
    const msgId = parseInt(data.slice(colonIdx + 1));

    const tasks = this.pendingTasks.get(msgId);
    this.settings.lastUpdateId = updateId;
    await this.saveData(this.settings);

    if (!tasks || !["sprint", "backlog"].includes(dest)) return;

    this.pendingTasks.delete(msgId);
    const targetPath = dest === "sprint"
      ? (this.settings.sprintPath || "daily.todos.4.md")
      : (this.settings.todosPath || "backlog.md");
    const label = dest === "sprint" ? "sprint" : "backlog";

    await this.appendTodos(tasks, targetPath, cq.from.id, label);
  }

  async handleVoice(msg: TgMessage, updateId: number) {
    if (!msg.voice || !msg.from) return;

    if (!this.settings.groqApiKey) {
      await this.sendMessage(msg.from.id, "⚠️ Groq API key is not set. Add it in plugin settings.");
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
      return;
    }

    await this.sendMessage(msg.from.id, "⏳ Transcribing voice message...");

    const text = await this.transcribeVoice(msg.voice.file_id);
    if (!text) {
      await this.sendMessage(msg.from.id, "❌ Transcription failed. Check your Groq API key.");
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
      return;
    }

    const body = `🎤 _Голосовое_\n\n${text}`;
    const saved = await this.saveNote(body, msg.date, getForwardedFrom(msg), extractTags(text), msg.from.id, "voice");
    if (saved) {
      this.settings.lastUpdateId = updateId;
      await this.saveData(this.settings);
    }
  }

  async transcribeVoice(fileId: string): Promise<string | null> {
    try {
      const fileRes = await requestUrl({
        url: `https://api.telegram.org/bot${this.settings.botToken}/getFile?file_id=${fileId}`,
      });
      const filePath: string = fileRes.json?.result?.file_path;
      if (!filePath) return null;

      const audioRes = await requestUrl({
        url: `https://api.telegram.org/file/bot${this.settings.botToken}/${filePath}`,
      });

      const boundary = "----FlowBoundary" + Math.random().toString(36).slice(2);
      const enc = new TextEncoder();
      const preamble = enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`
      );
      const epilogue = enc.encode(`\r\n--${boundary}--\r\n`);
      const audio = new Uint8Array(audioRes.arrayBuffer);

      const body = new Uint8Array(preamble.byteLength + audio.byteLength + epilogue.byteLength);
      body.set(preamble, 0);
      body.set(audio, preamble.byteLength);
      body.set(epilogue, preamble.byteLength + audio.byteLength);

      const groqRes = await requestUrl({
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.settings.groqApiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: body.buffer,
      });

      return groqRes.json?.text ?? null;
    } catch (e) {
      console.error("TelegramInbox transcribe error:", e);
      return null;
    }
  }

  async saveNote(text: string, utcSec: number, forwardedFrom: string | null, tags: string[], chatId: number, type: "text" | "voice"): Promise<boolean> {
    const filename = buildFilename(utcSec);
    const content = buildContent(text, utcSec, forwardedFrom, tags, type);
    const path = `${this.settings.inboxPath.replace(/\/$/, "")}/${filename}`;

    try {
      await this.ensureFolder(this.settings.inboxPath);
      await this.app.vault.create(path, content);
      this.settings.lastSavedFile = filename;
      new Notice(`✅ ${filename}`);
      await this.sendMessage(chatId, `✅ Saved: ${filename}`);
      return true;
    } catch (e) {
      console.error("TelegramInbox create error:", path, e);
      new Notice(`❌ Error: ${filename}`);
      return false;
    }
  }

  async processTodosMessage(text: string, msgId: number, chatId: number): Promise<boolean> {
    const lines: string[] = [];
    const taskTexts: string[] = [];

    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const lineTags = extractTags(line);
      if (lineTags.includes("todo") && !lineTags.includes("todos")) {
        const taskText = line.replace(/#todo\b/giu, "").replace(/\s{2,}/g, " ").trim();
        if (taskText) { lines.push(`- [ ] ${taskText}`); taskTexts.push(taskText); }
      } else if (lineTags.includes("todos")) {
        const contextText = line.replace(/#todos\b/giu, "").replace(/\s{2,}/g, " ").trim();
        if (contextText) lines.push(contextText);
      } else {
        lines.push(line);
      }
    }

    if (!lines.length) return true;

    this.pendingTasks.set(msgId, lines);

    const preview = taskTexts.length
      ? taskTexts.map(t => `• ${t.length > 50 ? t.slice(0, 50) + "…" : t}`).join("\n")
      : lines[0];

    await this.sendMessageWithButtons(
      chatId,
      `📋 Where to add?\n\n${preview}`,
      msgId,
    );
    return true;
  }

  async appendTodos(lines: string[], filePath: string, chatId: number, label: string): Promise<void> {
    try {
      const folder = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      if (folder) await this.ensureFolder(folder);
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      const entry = lines.join("\n") + "\n";
      if (existing instanceof TFile) {
        const content = await this.app.vault.read(existing);
        const separator = content.endsWith("\n") ? "" : "\n";
        await this.app.vault.modify(existing, content + separator + entry);
      } else {
        await this.app.vault.create(filePath, entry);
      }
      const firstTask = lines.find(l => l.startsWith("- [ ]"))?.slice(6) ?? lines[0];
      new Notice(`✅ ${label}: ${firstTask.slice(0, 40)}`);
      await this.sendMessage(chatId, `✅ Added to ${label}`);
    } catch (e) {
      console.error("TelegramInbox appendTodos error:", filePath, e);
      new Notice("❌ Failed to save task");
      await this.sendMessage(chatId, "❌ Failed to save task");
    }
  }

  async ensureFolder(path: string) {
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async sendMessage(chatId: number, text: string) {
    try {
      await requestUrl({
        url: `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (e) {
      console.error("TelegramInbox sendMessage error:", e);
    }
  }

  async sendMessageWithButtons(chatId: number, text: string, msgId: number) {
    try {
      await requestUrl({
        url: `https://api.telegram.org/bot${this.settings.botToken}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: "📋 To sprint", callback_data: `sprint:${msgId}` },
              { text: "📦 To backlog", callback_data: `backlog:${msgId}` },
            ]],
          },
        }),
      });
    } catch (e) {
      console.error("TelegramInbox sendMessageWithButtons error:", e);
    }
  }

  async answerCallbackQuery(callbackQueryId: string) {
    try {
      await requestUrl({
        url: `https://api.telegram.org/bot${this.settings.botToken}/answerCallbackQuery`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
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
}

// --- Settings Tab ---

class TelegramInboxSettingTab extends PluginSettingTab {
  plugin: TelegramInboxPlugin;

  constructor(app: App, plugin: TelegramInboxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Bot Token")
      .setDesc("Telegram bot token from @BotFather")
      .addText((t) =>
        t.setPlaceholder("1234567890:AAF...")
          .setValue(this.plugin.settings.botToken)
          .onChange(async (v) => {
            this.plugin.settings.botToken = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Allowed User ID")
      .setDesc("Only messages from this Telegram user ID will be processed")
      .addText((t) =>
        t.setPlaceholder("5152249676")
          .setValue(this.plugin.settings.allowedUserId ? String(this.plugin.settings.allowedUserId) : "")
          .onChange(async (v) => {
            const id = parseInt(v.trim());
            if (!isNaN(id)) {
              this.plugin.settings.allowedUserId = id;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Inbox Path")
      .setDesc("Vault folder where incoming notes are saved")
      .addText((t) =>
        t.setPlaceholder("inbox")
          .setValue(this.plugin.settings.inboxPath)
          .onChange(async (v) => {
            this.plugin.settings.inboxPath = v.trim() || "inbox";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sprint Path")
      .setDesc("File for active sprint tasks (messages with #todo → 'To sprint' button)")
      .addText((t) =>
        t.setPlaceholder("daily.todos.4.md")
          .setValue(this.plugin.settings.sprintPath)
          .onChange(async (v) => {
            this.plugin.settings.sprintPath = v.trim() || "daily.todos.4.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Backlog Path")
      .setDesc("File for backlog tasks (messages with #todo → 'To backlog' button)")
      .addText((t) =>
        t.setPlaceholder("backlog.md")
          .setValue(this.plugin.settings.todosPath)
          .onChange(async (v) => {
            this.plugin.settings.todosPath = v.trim() || "backlog.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Polling Interval (seconds)")
      .setDesc("How often to check for new messages (minimum 5)")
      .addText((t) =>
        t.setPlaceholder("30")
          .setValue(String(this.plugin.settings.pollingIntervalSeconds))
          .onChange(async (v) => {
            const n = parseInt(v.trim());
            if (!isNaN(n) && n >= 5) {
              this.plugin.settings.pollingIntervalSeconds = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Groq API Key")
      .setDesc("For voice message transcription. Get one at console.groq.com (free tier available)")
      .addText((t) =>
        t.setPlaceholder("gsk_...")
          .setValue(this.plugin.settings.groqApiKey)
          .onChange(async (v) => {
            this.plugin.settings.groqApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

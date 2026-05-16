import { App, Notice, Platform, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";

interface Settings {
  botToken: string;
  allowedUserId: number;
  inboxPath: string;
  pollingIntervalSeconds: number;
  lastUpdateId: number;
}

const DEFAULTS: Settings = {
  botToken: "",
  allowedUserId: 0,
  inboxPath: "inbox",
  pollingIntervalSeconds: 30,
  lastUpdateId: 0,
};

// --- Telegram API types ---

interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  date: number;
  text?: string;
  // forward_origin (Bot API 7.0+)
  forward_origin?: {
    type: "user" | "hidden_user" | "chat" | "channel";
    sender_user?: TgUser;
    sender_user_name?: string;
    sender_chat?: { title: string };
    chat?: { title: string };
  };
  // legacy forward fields
  forward_from?: TgUser;
  forward_sender_name?: string;
  forward_from_chat?: { title: string };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
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

function buildContent(text: string, utcSec: number, forwardedFrom: string | null): string {
  let fm = `---\ncreated: ${buildIso(utcSec)}\nsource: telegram`;
  if (forwardedFrom) fm += `\nforwarded_from: ${forwardedFrom}`;
  fm += "\n---\n\n";
  return fm + text;
}

// --- Plugin ---

export default class TelegramInboxPlugin extends Plugin {
  settings: Settings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TelegramInboxSettingTab(this.app, this));
    this.startPolling();
  }

  startPolling() {
    if (!Platform.isDesktop) return;
    const ms = Math.max(5, this.settings.pollingIntervalSeconds) * 1000;
    this.registerInterval(window.setInterval(() => this.poll(), ms));
    this.poll();
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
    this.settings.lastUpdateId = update.update_id;
    const msg = update.message;

    if (!msg || msg.from?.id !== this.settings.allowedUserId) {
      await this.saveData(this.settings);
      return;
    }

    if (!msg.text) {
      await this.sendMessage(msg.from.id, "⚠️ Пока поддерживается только текст. Просто напиши что хочешь сохранить.");
      await this.saveData(this.settings);
      return;
    }

    const filename = buildFilename(msg.date);
    const content = buildContent(msg.text, msg.date, getForwardedFrom(msg));
    const path = `${this.settings.inboxPath.replace(/\/$/, "")}/${filename}`;

    try {
      await this.ensureFolder(this.settings.inboxPath);
      await this.app.vault.create(path, content);
      new Notice(`✅ ${filename}`);
      await this.sendMessage(msg.from.id, `✅ Сохранено: ${filename}`);
    } catch (e) {
      console.error("TelegramInbox create error:", path, e);
      new Notice(`❌ Ошибка: ${filename}`);
    }

    await this.saveData(this.settings);
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
      .setDesc("Telegram bot token от BotFather")
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
      .setDesc("Telegram user ID — только этот пользователь может сохранять")
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
      .setDesc("Папка в vault для входящих заметок")
      .addText((t) =>
        t.setPlaceholder("inbox")
          .setValue(this.plugin.settings.inboxPath)
          .onChange(async (v) => {
            this.plugin.settings.inboxPath = v.trim() || "inbox";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Polling Interval (секунды)")
      .setDesc("Как часто проверять новые сообщения (минимум 5)")
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
  }
}

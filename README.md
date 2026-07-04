# Flowtaker Inbox

Send messages from Telegram to your Obsidian vault — no server required.

The bot runs directly inside Obsidian. Text yourself a note, tag a task, or send a voice message — it lands in your vault within seconds.

## How it works

```
You → Telegram bot → Obsidian plugin (polling) → vault/inbox/note.md
```

The plugin polls Telegram every 30 seconds. Files are created locally in your vault folder, so iCloud, Obsidian Sync, or any other sync solution picks them up automatically.

## Features

- **Text notes** — any message is saved as a `.md` file with YAML frontmatter
- **Tags** — `#tag` in your message becomes `tags: [tag]` in frontmatter and is stripped from the body
- **Forwarded messages** — source is recorded in `forwarded_from` frontmatter field
- **Tasks** (`#todo`) — bot asks where to route them: sprint or backlog, then appends as `- [ ] task`
- **Voice transcription** — voice messages are transcribed via Groq Whisper and saved as notes
- `/status` — bot replies with the last saved filename

## Note format

Filename: `DDMMYYYY_HHMMSS.md`

```markdown
---
created: 2026-07-04T15:30:00
source: telegram
type: text
tags: [idea, work]
---

Your message text here
```

## Setup

### 1. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather)
2. Send `/newbot` → set a name and username
3. Copy the **Bot Token** (`1234567890:AAF...`)

### 2. Get your Telegram User ID

Message [@userinfobot](https://t.me/userinfobot) — it replies with your numeric ID.

### 3. Install the plugin

**From Obsidian (after community approval):**
Settings → Community plugins → Search "Flowtaker Inbox" → Install

**Manual install:**
```bash
VAULT="$HOME/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/flowtaker-inbox"
cp main.js manifest.json "$VAULT/.obsidian/plugins/flowtaker-inbox/"
```

Then: Settings → Community plugins → enable "Flowtaker Inbox"

### 4. Configure

Open Settings → Flowtaker Inbox:
- Paste your **Bot Token**
- Enter your **Allowed User ID**
- Adjust paths if needed (defaults work for most setups)

## Settings

| Setting | Description | Default |
|---|---|---|
| Bot Token | Token from @BotFather | — |
| Allowed User ID | Only this user's messages are processed | — |
| Inbox Path | Folder for incoming notes | `inbox` |
| Sprint Path | File for tasks routed to sprint | `daily.todos.4.md` |
| Backlog Path | File for tasks routed to backlog | `backlog.md` |
| Polling Interval | How often to check for messages (seconds, min 5) | `30` |
| Groq API Key | For voice transcription. Get one at [console.groq.com](https://console.groq.com) | — |

## Tasks workflow

Send a message with `#todo`:

```
Buy oat milk #todo
Write blog post #todo
```

The bot replies with inline buttons: **📋 To sprint** / **📦 To backlog**.  
Tap one — tasks are appended as `- [ ] ...` to the configured file.

Use `#todos` to add a context line (plain text, not a checkbox):

```
Project planning session #todos
Define MVP scope #todo
Write tech spec #todo
```

## Voice transcription

Requires a [Groq API key](https://console.groq.com) (free tier available).

Send a voice message → plugin downloads and transcribes it via `whisper-large-v3-turbo` → saves to inbox with `type: voice` in frontmatter.

## Troubleshooting

**Messages not appearing**
- Check Bot Token and User ID in plugin settings
- Make sure you're writing to your own bot
- Open Obsidian console (Ctrl+Shift+I → Console) for errors

**Plugin stops after Obsidian restart**
- Normal behavior — `lastUpdateId` is saved in `data.json`, no messages will be duplicated on restart

**Voice not transcribing**
- Add Groq API key in settings
- Voice messages must be under Telegram's file size limit (~20 MB)

## License

MIT

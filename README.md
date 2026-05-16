# Flowtaker Inbox — Obsidian Plugin

Obsidian-плагин для автоматического захвата Telegram-сообщений в vault.

Отправляешь текст себе в Telegram → файл `.md` появляется в `inbox/` твоего vault → через iCloud синхронизируется на iPhone.

## Как работает

```
Telegram (iPhone / любое устройство)
        ↓
Obsidian-плагин на Mac (polling каждые 30 сек)
        ↓
vault/inbox/DDMMYYYY_HHMMSS.md
        ↓
iCloud → iPhone
```

Никаких серверов. Бот работает прямо внутри Obsidian.

## Установка

### 1. Создать Telegram-бота

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram
2. Отправить `/newbot` → задать имя и username
3. Скопировать **Bot Token** (формат `1234567890:AAF...`)

### 2. Узнать свой Telegram User ID

Написать боту [@userinfobot](https://t.me/userinfobot) — он ответит твоим ID.

### 3. Установить плагин вручную

```bash
# Путь к vault на Mac (стандартный iCloud-путь)
VAULT=~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/Obsidian\ Vault

mkdir -p "$VAULT/.obsidian/plugins/flowtaker-inbox"
cp main.js manifest.json "$VAULT/.obsidian/plugins/flowtaker-inbox/"
```

### 4. Включить плагин в Obsidian

1. Obsidian → Settings → Community plugins → Enable community plugins
2. Найти **Flowtaker Inbox** → включить
3. Перейти в настройки плагина → ввести Bot Token и User ID

## Формат заметок

Имя файла: `DDMMYYYY_HHMMSS.md` (московское время UTC+3)

```markdown
---
created: 2026-05-16T10:00:00
source: telegram
forwarded_from: Имя (если пересланное)
---

Текст сообщения
```

## Настройки

| Параметр | Описание | По умолчанию |
|---|---|---|
| Bot Token | Токен от BotFather | — |
| Allowed User ID | Только этот пользователь может сохранять | — |
| Inbox Path | Папка в vault для входящих | `inbox` |
| Polling Interval | Как часто проверять сообщения (сек, мин 5) | `30` |

## iPhone

Плагин работает только на Mac (desktop). На iPhone заметки появляются автоматически через iCloud синхронизацию.

## Troubleshooting

**Сообщения не сохраняются**
- Проверь Bot Token и User ID в настройках плагина
- Убедись что пишешь именно своему боту (не в чужой)

**Ошибка в Notice (красный крестик)**
- Возможно файл с таким именем уже существует (крайне редко)
- Проверь консоль Obsidian: Ctrl+Shift+I → Console

**Плагин не видит новые сообщения после перезапуска Obsidian**
- Это нормально: `lastUpdateId` сохранён в `data.json`, дублей не будет

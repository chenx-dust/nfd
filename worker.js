const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const startMsgUrl = 'https://github.com/chenx-dust/nfd/raw/refs/heads/main/data/startMessage.md';

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null) {
  console.log(JSON.stringify({
    "type": "request",
    "method": methodName,
    "body": body,
    "params": params
  }))
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

function editMessageText(msg = {}) {
  return requestTelegram('editMessageText', makeReqBody(msg))
}

function editMessageCaption(msg = {}) {
  return requestTelegram('editMessageCaption', makeReqBody(msg))
}

function editMessageMedia(msg = {}) {
  return requestTelegram('editMessageMedia', makeReqBody(msg))
}

function deleteMessage(msg = {}) {
  return requestTelegram('deleteMessage', makeReqBody(msg))
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook(event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate(update) {
  console.log(JSON.stringify({
    type: "webhook",
    data: update
  }))

  let rtn
  if ('message' in update) {
    rtn = await onMessage(update.message, false)
  }
  if ('edited_message' in update) {
    rtn = await onMessage(update.edited_message, true)
  }
  console.log(JSON.stringify({
    type: "result",
    data: rtn
  }))
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */

async function onMessage(message, edited) {
  if (message.text === '/start') {
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id: message.chat.id,
      text: startMsg
    })
  }

  if (message.chat.id.toString() === ADMIN_UID) {
    if ('forward_origin' in message) {
      if (message.forward_origin?.type == "user"){
        if (message.forward_origin.sender_user.is_bot){
          return sendMessage({
            chat_id: ADMIN_UID,
            text: "Bot 之间的相互聊天是被禁止的"
          })
        }
        let id = message.forward_origin.sender_user.id
        return handleInject(message, id)
      } else {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: `不支持注入的转发消息类型：\`${message.forward_origin.type}\``,
          parse_mode: "MarkdownV2"
        })
      }
    }
    let guestChatId = null
    if (message?.reply_to_message?.chat) {
      guestChatId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" })
    }
    if (!edited && message.text.startsWith('/')) {
      let params = message.text.trim().replace(/ +/g, " ").split(' ')
      let id = guestChatId
      if (params.length >= 2) {
        id = params[1]
      }
      if (/^\/d$/.exec(params[0])) {
        return handleDelete(message)
      }
      else if (/^\/delete$/.exec(params[0])) {
        return handleDelete(message)
      }
      else if (/^\/block$/.exec(params[0])) {
        return handleBlock(id)
      }
      else if (/^\/unblock$/.exec(params[0])) {
        return handleUnBlock(id)
      }
      else if (/^\/checkblock$/.exec(params[0])) {
        return handleCheckBlock(id)
      }
      else if (/^\/info$/.exec(params[0])) {
        return handleInfo(id)
      }
      else if (/^\/inject$/.exec(params[0])) {
        return handleInject(message, id)
      }
      else if (/^\/help$/.exec(params[0])) {
        return handleHelp()
      }
      else {
        return handleDefault()
      }
    }
    if (!message?.reply_to_message?.chat) {
      return handleDefault()
    }
    if (guestChatId == null) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: "发送/编辑失败，可能是未记录的消息，或是回复了错误的消息"
      })
    }
    if (edited) {
      let replyMessageId = await nfd.get('reply-msg-' + message.message_id, { type: "json" })
      let rtn = []
      if ('text' in message) {
        let reply = await editMessageText({
          chat_id: guestChatId,
          message_id: replyMessageId,
          text: message.text
        })
        rtn.push(reply)
        if (!reply.ok) {
          rtn.push(sendMessage({
            chat_id: ADMIN_UID,
            text: `编辑 \`text\` 失败：\n\`\`\`json\n${JSON.stringify(reply, null, 4)}\n\`\`\``,
            parse_mode: "MarkdownV2"
          }))
        }
      }
      if ('caption' in message) {
        let reply = await editMessageCaption({
          chat_id: guestChatId,
          message_id: replyMessageId,
          caption: message.caption,
          caption_entities: message.caption_entities,
          show_caption_above_media: message.show_caption_above_media
        })
        rtn.push(reply)
        if (!reply.ok) {
          rtn.push(sendMessage({
            chat_id: ADMIN_UID,
            text: `编辑 \`caption\` 失败：\n\`\`\`json\n${JSON.stringify(reply, null, 4)}\n\`\`\``,
            parse_mode: "MarkdownV2"
          }))
        }
      }
      if ('media' in message) {
        let reply = await editMessageMedia({
          chat_id: guestChatId,
          message_id: replyMessageId,
          media: message.media
        })
        rtn.push(reply)
        if (!reply.ok) {
          rtn.push(sendMessage({
            chat_id: ADMIN_UID,
            text: `编辑 \`media\` 失败：\n\`\`\`json\n${JSON.stringify(reply, null, 4)}\n\`\`\``,
            parse_mode: "MarkdownV2"
          }))
        }
      }
      return rtn
    } else {
      let reply = await copyMessage({
        chat_id: guestChatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      })
      if (reply.ok) {
        await nfd.put('reply-msg-' + message.message_id, reply.result.message_id)
        await nfd.put('msg-map-' + message.message_id, guestChatId)
      } else {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: `发送失败：\n\`\`\`json\n${JSON.stringify(reply, null, 4)}\n\`\`\``,
          parse_mode: "MarkdownV2"
        })
      }
      return reply
    }
  } else {
    return handleGuestMessage(message, edited)
  }
}

async function handleGuestMessage(message, edited) {
  let chatId = message.chat.id;
  if ('from' in message) {
    await nfd.put('user-info-' + chatId, JSON.stringify(message.from))
  }
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })

  if (isblocked) {
    return sendMessage({
      chat_id: chatId,
      text: 'Your are blocked. 你被屏蔽了。'
    })
  }

  let rtn = []
  if ('forward_origin' in message) {
    rtn.push(await sendMessage({
      chat_id: ADMIN_UID,
      text: `以下为 ${getPrettyName(message.chat)} 转发的 \`${message.forward_origin.type}\` 消息：`,
      parse_mode: "MarkdownV2"
    }))
  }
  if (edited) {
    rtn.push(await sendMessage({
      chat_id: ADMIN_UID,
      text: `对方修改了消息：`
    }))
  }
  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  })
  rtn.push(forwardReq)
  if (forwardReq.ok) {
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return rtn
}

async function handleDelete(message) {
  let guestChatId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" })
  let replyMessageId = await nfd.get('reply-msg-' + message?.reply_to_message.message_id, { type: "json" })
  if (guestChatId == null || replyMessageId == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '删除失败，可能是未记录的消息，或是回复了错误的消息'
    })
  }

  let rtn = []
  let reply = await deleteMessage({
    chat_id: guestChatId,
    message_id: replyMessageId
  })
  rtn.push(reply)
  if (reply.ok) {
    rtn.push(await sendMessage({
      chat_id: ADMIN_UID,
      text: '删除成功'
    }))
    rtn.push(await deleteMessage({
      chat_id: ADMIN_UID,
      message_id: message.reply_to_message.message_id
    }));
    rtn.push(await deleteMessage({
      chat_id: ADMIN_UID,
      message_id: message.message_id
    }));
  } else {
    let send = await sendMessage({
      chat_id: ADMIN_UID,
      text: `删除失败\n\`\`\`json\n${JSON.stringify(reply, null, 4)}\n\`\`\``,
      parse_mode: "MarkdownV2"
    })
    rtn.push(send)
  }
  return rtn
}

async function handleBlock(id) {
  if (id == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未知 ID'
    })
  }
  if (id === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + id, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: [${id}](tg://user?id=${id}) 屏蔽成功`,
    parse_mode: "MarkdownV2"
  })
}

async function handleUnBlock(id) {
  if (id == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未知 ID'
    })
  }
  await nfd.put('isblocked-' + id, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: [${id}](tg://user?id=${id}) 解除屏蔽成功`,
    parse_mode: "MarkdownV2"
  })
}

async function handleCheckBlock(id) {
  if (id == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未知 ID'
    })
  }
  let blocked = await nfd.get('isblocked-' + id, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: [${id}](tg://user?id=${id}) ` + (blocked ? '被屏蔽' : '没有被屏蔽'),
    parse_mode: "MarkdownV2"
  })
}

async function handleInfo(id) {
  if (id == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未知 ID'
    })
  }
  let userInfo = await nfd.get('user-info-' + id, { type: "json" })
  return sendMessage({
    chat_id: ADMIN_UID,
    text:
      getPrettyName(userInfo) + ` UID: [${id}](tg://user?id=${id})
\`\`\`json\n${JSON.stringify(userInfo, null, 4)}\n\`\`\``,
    parse_mode: "MarkdownV2"
  })
}

async function handleInject(message, id) {
  if (id == null) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '未知 ID'
    })
  }
  if (id.toString() === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text: "注入您的 ID 是没有意义的"
    })
  }

  await nfd.put('msg-map-' + message.message_id, id)
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `已注入 UID: [${id}](tg://user?id=${id})`,
    parse_mode: "MarkdownV2"
  })
}

async function handleDefault() {
  return sendMessage({
    chat_id: ADMIN_UID,
    text: '使用方法：回复转发的消息，并发送回复消息，使用 `/help` 了解更多指令',
    parse_mode: "MarkdownV2"
  })
}

async function handleHelp() {
  return sendMessage({
    chat_id: ADMIN_UID,
    text:
      `使用方法：回复转发的消息，并发送回复消息
指令：
\`/start\` - 欢迎语
\`/inject <id>\` - 注入 <id> 的对话以开始聊天（转发消息亦可以）
\`/block [id]\` - 屏蔽 id 或是回复的消息对应的账号
\`/unblock [id]\` - 解除屏蔽 [id] 或是回复的消息对应的账号
\`/checkblock [id]\` - 检查 [id] 或是回复的消息对应的账号的屏蔽情况
\`/info [id]\` - 查看 [id] 或是回复的消息对应的账号的详细信息
\`/d\` \`/delete\` - 删除回复的消息
\`/help\` - 帮助`,
    parse_mode: "Markdown"
  })
}

function getPrettyName(chat) {
  let username = chat?.first_name
  if ('last_name' in chat) {
    username += " " + chat.last_name
  }
  if (username == "") {
    username = chat.id.toString()
  }
  if ('username' in chat) {
    return `[${username}](tg://user?id=${chat.id}) \\(@${chat.username}\\)`.replace('_', '\\_')
  } else {
    return `[${username}](tg://user?id=${chat.id})`.replace('_', '\\_')
  }
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

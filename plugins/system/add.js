
import cfg from '../../lib/config/config.js'
import plugin from '../../lib/plugins/plugin.js'
import fs from 'node:fs'
import lodash from 'lodash'
import { segment } from 'oicq'
import { pipeline } from 'stream'
import { promisify } from 'util'
import fetch from 'node-fetch'
import moment from 'moment'

let textArr = {}

export class add extends plugin {
  constructor () {
    super({
      name: '添加表情',
      dsc: '添加表情，文字等',
      event: 'message',
      priority: 50000,
      rule: [
        {
          reg: '^#添加(.*)',
          fnc: 'add'
        },
        {
          reg: '^#删除(.*)',
          fnc: 'del'
        },
        {
          reg: '(.*)',
          fnc: 'getText',
          log: false
        },
        {
          reg: '#(表情|词条)(.*)',
          fnc: 'list'
        }
      ]
    })

    this.path = './data/textJson/'
    this.facePath = './data/face/'
  }

  async init () {
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path)
    }
    if (!fs.existsSync(this.facePath)) {
      fs.mkdirSync(this.facePath)
    }
  }

  async accept () {
    /** 处理消息 */
    if (this.e.atBot && this.e.msg.includes('添加') && !this.e.msg.includes('#')) {
      this.e.msg = '#' + this.e.msg
    }
  }

  /** 群号key */
  get grpKey () {
    return `Yz:group_id:${this.e.user_id}`
  }

  /** #添加 */
  async add () {
    await this.getGroupId()

    if (!this.group_id) {
      this.e.reply('请先在群内触发表情，确定添加的群')
      return
    }

    this.initTextArr()

    if (!this.checkAuth()) return
    if (!this.checkKeyWord()) return
    if (await this.singleAdd()) return
    /** 获取关键词 */
    this.getKeyWord()

    if (!this.keyWord) {
      this.e.reply('添加错误：没有关键词')
      return
    }

    this.setContext('addContext')

    await this.e.reply('请发送添加内容', false, { at: true })
  }

  /** 获取群号 */
  async getGroupId () {
    if (this.e.isGroup) {
      this.group_id = this.e.group_id
      redis.setEx(this.grpKey, 3600 * 24 * 30, String(this.group_id))
      return this.group_id
    }

    // redis获取
    let groupId = await redis.get(this.grpKey)
    if (groupId) {
      this.group_id = groupId
      return this.group_id
    }

    return false
  }

  checkAuth () {
    let groupCfg = cfg.getGroup(this.group_id)
    if (groupCfg.imgAddLimit == 2 && !this.e.isMaster) {
      this.e.reply('暂无权限，只有主人才能添加')
      return false
    }
    if (groupCfg.imgAddLimit == 1 && !this.e.isMaster) {
      if (!Bot.gml.has(this.group_id)) {
        return false
      }
      if (!Bot.gml.get(this.group_id).get(this.e.user_id)) {
        return false
      }
      if (!this.e.member.is_admin) {
        this.e.reply('暂无权限，只有管理员才能添加')
        return false
      }
    }

    return true
  }

  checkKeyWord () {
    if (this.e.img && this.e.img.length > 1) {
      this.e.reply('添加错误：只能发送一个表情当关键词')
      return false
    }

    if (this.e.at) {
      let at = lodash.filter(this.e.message, (o) => { return o.type == 'at' && o.qq != Bot.uin })
      if (at.length > 1) {
        this.e.reply('添加错误：只能@一个人当关键词')
        return false
      }
    }

    if (this.e.img && this.e.at) {
      this.e.reply('添加错误：没有关键词')
      return false
    }

    return true
  }

  /** 单独添加 */
  async singleAdd () {
    if (this.e.message.length != 2) return false
    let msg = lodash.keyBy(this.e.message, 'type')
    if (!this.e.msg || !msg.image) return false

    let keyWord = this.e.msg.replace(/#|＃|图片|表情|添加/g, '').trim()
    if (!keyWord) return false

    this.keyWord = this.trimAlias(keyWord)
    this.e.keyWord = this.keyWord

    if (this.e.msg.includes('添加图片')) {
      this.e.addImg = true
    }
    this.e.message = [msg.image]
    await this.addContext()

    return true
  }

  /** 获取添加关键词 */
  getKeyWord () {
    this.keyWord = this.e.toString()
      .trim()
      /** 过滤#添加 */
      .replace(/#|＃|图片|表情|添加/g, '')
      /** 过滤@ */
      .replace(new RegExp('{at:' + Bot.uin + '}', 'g'), '')
      .trim()

    this.keyWord = this.trimAlias(this.keyWord)
    this.e.keyWord = this.keyWord

    if (this.e.msg.includes('添加图片')) {
      this.e.addImg = true
    }
  }

  /** 过滤别名 */
  trimAlias (msg) {
    let groupCfg = cfg.getGroup(this.group_id)
    let alias = groupCfg.botAlias
    if (!Array.isArray(alias)) {
      alias = [alias]
    }
    for (let name of alias) {
      if (msg.startsWith(name)) {
        msg = lodash.trimStart(msg, name).trim()
      }
    }

    return msg
  }

  /** 添加内容 */
  async addContext () {
    await this.getGroupId()
    /** 关键词 */
    let keyWord = this.keyWord || this.getContext()?.addContext?.keyWord
    let addImg = this.e.addImg || this.getContext()?.addContext?.addImg

    /** 添加内容 */
    let message = this.e.message

    for (let i in message) {
      if (message[i].type == 'at') {
        if (message[i].qq == Bot.uin) {
          this.e.reply('添加内容不能@机器人！')
          this.finish('addContext')
          return
        }
      }
    }

    if (message.length == 1 && message[0].type == 'image') {
      let local = await this.saveImg(message[0].url, keyWord)
      if (!local) return
      message[0].local = local
      message[0].asface = true
      if (addImg) message[0].asface = false
    }

    if (!textArr[this.group_id]) textArr[this.group_id] = new Map()

    /** 支持单个关键词添加多个 */
    let text = textArr[this.group_id].get(keyWord)
    if (text) {
      text.push(message)
      textArr[this.group_id].set(keyWord, text)
    } else {
      text = [message]
      textArr[this.group_id].set(keyWord, text)
    }

    let retMsg = this.getRetMsg()

    if (text.length > 1 && retMsg[0].type != 'image') {
      retMsg.push(String(text.length))
    }

    retMsg.unshift('添加成功：')

    this.saveJson()
    this.e.reply(retMsg)
    this.finish('addContext')
  }

  /** 添加成功回复消息 */
  getRetMsg () {
    let retMsg = this.getContext()
    let msg = ''
    if (retMsg?.addContext?.message) {
      msg = retMsg.addContext.message

      for (let i in msg) {
        if (msg[i].type == 'text' && msg[i].text.includes('添加')) {
          msg[i].text = this.trimAlias(msg[i].text)
          msg[i].text = msg[i].text.trim().replace(/#|＃|图片|表情|添加/g, '')
          if (!msg[i].text) delete msg[i]
          continue
        }
        if (msg[i].type == 'at') {
          if (msg[i].qq == Bot.uin) {
            delete msg[i]
            continue
          } else {
            msg[i].text = ''
          }
        }
      }
    }
    if (!msg && this.keyWord) {
      msg = [this.keyWord]
    }
    return lodash.compact(msg)
  }

  saveJson () {
    let obj = {}
    for (let [k, v] of textArr[this.group_id]) {
      obj[k] = v
    }

    fs.writeFileSync(`${this.path}${this.group_id}.json`, JSON.stringify(obj, '', '\t'))
  }

  async saveImg (url, keyWord) {
    let groupCfg = cfg.getGroup(this.group_id)
    let savePath = `${this.facePath}${this.group_id}/`

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath)
    }

    const response = await fetch(url)

    keyWord = keyWord.replace(/\.|\\|\/|:|\*|\?|<|>|\|"/g, '_')

    if (!response.ok) {
      this.e.reply('添加图片下载失败。。')
      return false
    }

    let imgSize = (response.headers.get('size') / 1024 / 1024).toFixed(2)
    if (imgSize > 1024 * 1024 * groupCfg.imgMaxSize) {
      this.e.reply(`添加失败：表情太大了，${imgSize}m`)
      return false
    }

    let type = response.headers.get('content-type').split('/')[1]
    if (type == 'jpeg') type = 'jpg'

    if (fs.existsSync(`${savePath}${keyWord}.${type}`)) {
      keyWord = `${keyWord}_${moment().format('X')}`
    }

    savePath = `${savePath}${keyWord}.${type}`

    const streamPipeline = promisify(pipeline)
    await streamPipeline(response.body, fs.createWriteStream(savePath))

    return savePath
  }

  async getText () {
    if (!this.e.message) return false

    await this.getGroupId()

    if (!this.group_id) return false

    this.initTextArr()

    let keyWord = this.e.toString()
      .replace(/#|＃/g, '')
      .replace(`{at:${Bot.uin}}`, '')
      .trim()

    keyWord = this.trimAlias(keyWord)

    let num = 0
    if (isNaN(keyWord)) {
      num = keyWord.charAt(keyWord.length - 1)

      if (!isNaN(num)) {
        keyWord = lodash.trimEnd(keyWord, num).trim()
        num--
      }
    }

    let msg = textArr[this.group_id].get(keyWord)
    if (lodash.isEmpty(msg)) return false

    if (num >= 0 && num < msg.length) {
      msg = msg[num]
    } else {
      /** 随机获取一个 */
      msg = lodash.sample(msg)
    }

    if (msg[0] && msg[0].local) {
      if (fs.existsSync(msg[0].local)) {
        let tmp = segment.image(msg[0].local)
        tmp.asface = msg[0].asface
        msg = tmp
      } else {
        // this.e.reply(`表情已删除：${keyWord}`)
        return
      }
    }

    logger.mark(`[发送表情]${this.e.logText} ${keyWord}`)
    this.e.reply(msg)

    return true
  }

  /** 初始化已添加内容 */
  initTextArr () {
    if (textArr[this.group_id]) return

    textArr[this.group_id] = new Map()

    let path = `${this.path}${this.group_id}.json`
    if (!fs.existsSync(path)) {
      return
    }

    try {
      let text = JSON.parse(fs.readFileSync(path, 'utf8'))
      for (let i in text) {
        if (text[i][0] && !Array.isArray(text[i][0])) {
          text[i] = [text[i]]
        }

        textArr[this.group_id].set(String(i), text[i])
      }
    } catch (error) {
      logger.error(`json格式错误：${path}`)
      delete textArr[this.group_id]
      return false
    }

    /** 加载表情 */
    let facePath = `${this.facePath}${this.group_id}`

    if (fs.existsSync(facePath)) {
      const files = fs.readdirSync(`${this.facePath}${this.group_id}`).filter(file => /\.(jpeg|jpg|png|gif)$/g.test(file))
      for (let val of files) {
        let tmp = val.split('.')
        tmp[0] = tmp[0].replace(/_[0-9]{10}$/, '')
        if (/at|img/g.test(val)) continue

        if (textArr[this.group_id].has(tmp[0])) continue

        textArr[this.group_id].set(tmp[0], [[{
          local: `${facePath}/${val}`,
          asface: true
        }]])
      }

      this.saveJson()
    } else {
      fs.mkdirSync(facePath)
    }
  }

  async del () {
    await this.getGroupId()
    if (!this.group_id) return false

    this.initTextArr()

    let keyWord = this.e.msg.replace(/#|＃|图片|表情|删除|全部/g, '')

    keyWord = this.trimAlias(keyWord)

    let num = false
    let index = 0
    if (isNaN(keyWord)) {
      num = keyWord.charAt(keyWord.length - 1)

      if (!isNaN(num)) {
        keyWord = lodash.trimEnd(keyWord, num).trim()
        index = num - 1
      } else {
        num = false
      }
    }

    let arr = textArr[this.group_id].get(keyWord)
    if (!arr) {
      await this.e.reply(`暂无此表情：${keyWord}`)
      return
    }

    let tmp = []
    if (num) {
      if (!arr[index]) {
        await this.e.reply(`暂无此表情：${keyWord}${num}`)
        return
      }

      tmp = arr[index]
      arr.splice(index, 1)

      if (arr.length <= 0) {
        textArr[this.group_id].delete(keyWord)
      } else {
        textArr[this.group_id].set(keyWord, arr)
      }
    } else {
      if (this.e.msg.includes('删除全部')) {
        tmp = arr
        arr = []
      } else {
        tmp = arr.pop()
      }

      if (arr.length <= 0) {
        textArr[this.group_id].delete(keyWord)
      } else {
        textArr[this.group_id].set(keyWord, arr)
      }
    }
    if (!num) num = ''
    await this.e.reply(`删除成功：${keyWord}${num}`)

    /** 删除图片 */
    tmp.forEach(item => {
      let img = item
      if (Array.isArray(item)) {
        img = item[0]
      }
      if (img.local) {
        fs.unlink(img.local, () => {})
      }
    })

    this.saveJson()
  }

  async list () {
    let page = 1
    let pageSize = 100
    let type = 'list'

    await this.getGroupId()
    if (!this.group_id) return false

    this.initTextArr()

    let search = this.e.msg.replace(/#|＃|表情|词条/g, '')

    if (search.includes('列表')) {
      page = search.replace(/列表/g, '') || 1
    } else {
      type = 'search'
    }

    let list = textArr[this.group_id]

    if (lodash.isEmpty(list)) {
      await this.e.reply('暂无表情')
      return
    }

    let arr = []
    for (let [k, v] of textArr[this.group_id]) {
      if (type == 'list') {
        arr.push({ key: k, val: v, num: arr.length + 1 })
      } else if (k.includes(search)) {
        /** 搜索表情 */
        arr.push({ key: k, val: v, num: arr.length + 1 })
      }
    }

    let count = arr.length
    arr = arr.reverse()

    if (type == 'list') {
      arr = this.pagination(page, pageSize, arr)
    }

    if (lodash.isEmpty(arr)) {
      return
    }

    let msg = []
    let num = 0
    for (let i in arr) {
      if (num >= page * pageSize) break

      let keyWord = await this.keyWordTran(arr[i].key)
      if (!keyWord) continue

      if (keyWord.type) {
        msg.push(`${arr[i].num}.`, keyWord, '\n')
      } else {
        msg.push(`${arr[i].num}.${keyWord}\n`)
      }
      num++
    }

    if (type == 'list' && count > 100) {
      msg.push(`\n更多内容请翻页查看\n如：#表情列表${Number(page) + 1}`)
    }

    let title = `表情列表，第${page}页，共${count}条`
    if (type == 'search') {
      title = `表情${search}，${count}条`
    }

    let forwardMsg = await this.makeForwardMsg(Bot.uin, title, msg)

    this.e.reply(forwardMsg)
  }

  async makeForwardMsg (qq, title, msg) {
    let info = await Bot.getGroupMemberInfo(this.group_id, qq)

    let userInfo = {
      user_id: Bot.uin,
      nickname: info.card ?? info.nickname
    }

    let forwardMsg = [
      {
        ...userInfo,
        message: title
      },
      {
        ...userInfo,
        message: msg
      }
    ]

    /** 制作转发内容 */
    if (this.e.isGroup) {
      forwardMsg = await this.e.group.makeForwardMsg(forwardMsg)
    } else {
      forwardMsg = await this.e.friend.makeForwardMsg(forwardMsg)
    }

    /** 处理描述 */
    forwardMsg.data = forwardMsg.data
      .replace(/\n/g, '')
      .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
      .replace(/___+/, `<title color="#777777" size="26">${title}</title>`)

    return forwardMsg
  }

  /** 分页 */
  pagination (pageNo, pageSize, array) {
    let offset = (pageNo - 1) * pageSize
    return offset + pageSize >= array.length ? array.slice(offset, array.length) : array.slice(offset, offset + pageSize)
  }

  /** 关键词转换成可发送消息 */
  async keyWordTran (msg) {
    /** 图片 */
    if (msg.includes('{image:')) {
      let tmp = msg.split('image:')
      if (tmp.length > 2) return false

      let md5 = tmp[1].replace('}', '')

      msg = segment.image(`http://gchat.qpic.cn/gchatpic_new/0/0-0-${md5}/0`)
      msg.asface = true
    } else if (msg.includes('{at:')) {
      let tmp = msg.match(/{at:(.+?)}/g)

      for (let qq of tmp) {
        qq = qq.match(/[1-9][0-9]{4,14}/g)[0]
        let member = await await Bot.getGroupMemberInfo(this.group_id, Number(qq)).catch(() => { })
        let name = member?.card ?? member?.nickname
        if (!name) continue
        msg = msg.replace(`{at:${qq}}`, `@${name}`)
      }
    }

    return msg
  }
}
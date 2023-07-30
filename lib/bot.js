import './config/init.js'
import ListenerLoader from './listener/loader.js'
import { Client } from 'icqq'
import cfg from './config/config.js'

export default class Yunzai extends Client {
  // eslint-disable-next-line no-useless-constructor
  constructor (uin, conf) {
    super(uin, conf)
  }

  /** 登录机器人 */
static async run () {
    const bot = new Yunzai(cfg.bot)
    await ListenerLoader.load(bot)
    bot.emit("system.online")
    return bot
  }
}

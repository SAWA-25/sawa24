import plugin from '../../lib/plugins/plugin.js'

export class example3 extends plugin {
  constructor () {
    super({
      name: 'redis-io示例',
      dsc: 'redis-io监听与回调',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      priority: 5000,
      rule: [
        {
          /** 命令正则匹配 */
          reg: '^#Hello$',
          /** 执行方法 */
          fnc: 'hello'
        }
      ]
    })
    redis.io.on('Yz:example:msg:', this.onMsg)
  }

  /** emit */
  hello () {
    let key = `Yz:example:msg:${this.e.user_id}`
    let cd = 3 // 缓存3s
    /** 客户端1 redis.set触发emit */
    redis.setEx(key, cd, '你好！')
  }

  /** on */
  onMsg (value, key) {
    /** 客户端2 回调默认传value, key两个参数 */
    console.log(value) // '你好！'
    console.log(key) // 'Yz:example:msg:10001'
  }
}

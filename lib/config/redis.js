import cfg from './config.js'
import common from '../common/common.js'
import { createClient } from 'redis'
import { exec } from 'node:child_process'

let _events = {}

/**
 * 初始化全局redis客户端
 */
export default async function redisInit () {

  const rc = cfg.getConfig('redis')
  let redisUn = rc.username || ''
  let redisPw = rc.password ? `:${rc.password}` : ''
  if (rc.username || rc.password) redisPw += '@'
  let redisUrl = `redis://${redisUn}${redisPw}${rc.host}:${rc.port}/${rc.db}`

  // 初始化reids
  let client = createClient({ url: redisUrl })
  let sub = client.duplicate()

  try {
    logger.mark(`正在连接 Redis...`)
    logger.mark(redisUrl)

    await client.connect()
    await sub.connect()
    await sub.sendCommand(['config', 'set', 'notify-keyspace-events', 'EA'])
  } catch (error) {
    await onError(error)
  }

  client.on('error', (err) => {})

  /** 订阅set事件 */
  await sub.subscribe(`__keyevent@${rc.db}__:set`, onMessage)
  client.io = { on, emit, once, off }

  /** 全局变量 redis */
  global.redis = client

  logger.mark('Redis 连接成功')

  return client
}

async function onError (error) {
  let err = error.toString()

  if (err != 'Error: connect ECONNREFUSED 127.0.0.1:6379') {
    logger.error('redis链接失败！')
    process.exit()
  }

  /** windows */
  if (process.platform == 'win32') {
    logger.error('请先开启Redis')
    logger.error('window系统：双击redis-server.exe启动')
    process.exit()
  } else {
    let cmd = 'redis-server --save 900 1 --save 300 10 --daemonize yes'
    let arm = await aarch64()
    /** 安卓端自动启动redis */
    if (arm) {
      client = await startRedis(`${cmd}${arm}`, client, redisUrl)
    } else {
      logger.error('请先开启Redis')
      logger.error(`redis启动命令：${cmd} ${arm}`)
      process.exit()
    }
  }
}

async function onMessage (channel, msg) {
  let res = await redis.get(channel)
  if (res && channel && msg.includes(':set')) {
    emit(channel, res, channel)
  }
}

/**
 * 监听event事件，触发时调用callback函数
 * 调用redis.set时触发event事件，与其他后端交互需连接同一个redis库
 * @param event 监听事件名称，可传入名称前缀或正则表达式
 * @param callback 事件回调，默认传入value，key参数
 * @param id 表示`callback_id`，防止相同回调函数注册多个监听，
 * * 为指定事件注册多个监听时必须传入不同id
 */
function on (event, callback, id = 0) {
  if (!event || !callback) {
    logger.error('[Redis监听错误] missing event or callback parameter')
    return false
  }
  let callbacks = _events[event] || {}
  if (!callbacks[id]) {
    callbacks[id] = callback
  }
  _events[event] = callbacks
}

/**
 * 为指定事件注册一个单次监听器，单次监听器最多只触发一次，触发后立即解除监听器
 * 在 `plugins.deal()` 内调用时需要在外部添加判断条件决定是否重复调用, 
 * * 否则once将失去作用
 * @param event 监听事件名称，可传入名称前缀或正则表达式
 * @param callback 事件回调，默认传入value，key参数
 * @param id 表示`callback_id`，防止相同回调函数注册多个监听，
 * * 为指定事件注册多个监听时必须传入不同id
 */
function once (event, callback, id = 0) {
  let wrapFanc = (...args) => {
    callback(...args)
    off(event, id)
  }
  on(event, wrapFanc, id)
}

/**
 * 停止监听指定event事件
 * 在 `plugins.deal()` 内调用时需要在外部添加判断条件决定是否重复调用on, 
 * * 否则off将失去作用
 * @param event 监听事件名称，必须与on时传入的名称完全一致
 * @param id 表示`callback_id`，解除event对应id的回调函数, 没写all
 */
function off (event, id = 0) {
  if (typeof id !== 'number') {
    logger.error('[Redis停止监听] id is not numeric type')
    return false
  }
  let callbacks = _events[event] || {}
  if (callbacks[id]) {
    delete callbacks[id]
    _events[event] = callbacks
    return true
  }
}

/**
 * 触发事件
 * `args[0]` 为事件名称，除外的参数传给事件的回调函数
 * @param arguments
 */
function emit (...args) {
  let event, callbacks = []
  for (let v of Object.keys(_events)) {
    if (regExp(v).test(args[0])) {
      callbacks.push(...Object.values(_events[v]))
    }
  }
  callbacks.forEach(fn => fn(...[].slice.call(args, 1)))
}

async function aarch64 () {
  let tips = ''
  /** 判断arch */
  let arch = await execSync('arch')
  if (arch.stdout && arch.stdout.includes('aarch64')) {
    /** 判断redis版本 */
    let v = await execSync('redis-server -v')
    if (v.stdout) {
      v = v.stdout.match(/v=(\d)./)
      /** 忽略arm警告 */
      if (v && v[1] >= 6) tips = ' --ignore-warnings ARM64-COW-BUG'
    }
  }
  tips = ' --ignore-warnings ARM64-COW-BUG'
  return tips
}

/** 尝试自动启动redis */
async function startRedis (cmd, client, redisUrl) {
  logger.mark('正在启动 Redis...')
  await execSync(cmd)
  await common.sleep(500)
  try {
    /** 重新链接 */
    client = createClient({ url: redisUrl })
    await client.connect()
  } catch (error) {
    let err = error.toString()
    logger.mark(err)
    logger.error('请先启动 Redis')
    logger.error(`Redis 启动命令：${cmd}`)
    process.exit()
  }
  return client
}

async function execSync (cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

function regExp (text) {
  let Reg
  try {
    Reg = eval(text) instanceof RegExp && eval(text) || new RegExp(`^${text}`)
  } catch (err) {
    Reg = new RegExp(`^${text}`)
  }
  return Reg
}

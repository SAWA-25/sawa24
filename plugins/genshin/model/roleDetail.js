import base from './base.js'
import MysInfo from './mys/mysInfo.js'
import gsCfg from './gsCfg.js'
import lodash from 'lodash'
import { segment } from 'oicq'

export default class RoleDetail extends base {
  constructor (e) {
    super(e)
    this.model = 'roleDetail'
  }

  static async get (e) {
    let roleDetail = new RoleDetail(e)
    return await roleDetail.getDetail()
  }

  async getDetail () {
    /** 获取绑定uid */
    let uid = await MysInfo.getUid(this.e)
    if (!uid) return false

    /** 判断是否绑定了ck */
    this.isBing = await MysInfo.checkUidBing(uid)

    let param = { character: '' }
    if (this.isBing && this.e.roleId != '20000000') {
      param.detail = { avatar_id: this.e.roleId }
    }

    let res = await MysInfo.get(this.e, param)
    if (!res || res[0].retcode !== 0) return false

    let avatar = await this.getAvatar(res[0].data)
    if (!avatar) return false

    /** 获取技能等级 */
    let skill = {}
    if (res[1] && res[1].data) {
      skill = this.getSkill(res[1].data, avatar)
    }

    /** 截图数据 */
    let data = {
      quality: 80,
      ...this.screenData,
      uid: this.e.uid,
      saveId: this.e.uid,
      ...avatar,
      skill
    }

    return data
  }

  async getAvatar (data) {
    let avatars = lodash.keyBy(data.avatars, 'id')

    /** 旅行者特殊处理 */
    if (this.e.roleId == '20000000') {
      if (avatars['10000007']) this.e.roleId = '10000007'
      if (avatars['10000005']) this.e.roleId = '10000005'
    }

    if (!avatars[this.e.roleId]) {
      await this.noAvatar()
      return false
    }

    /** 角色数据 */
    avatars = avatars[this.e.roleId]
    let list = []
    let set = {}
    let setArr = []
    let text1 = ''
    let text2 = ''
    let bg = 2

    list[0] = {
      type: 'weapon',
      name: avatars.weapon.name,
      showName: gsCfg.shortName(avatars.weapon.name, true),
      level: avatars.weapon.level,
      affix_level: avatars.weapon.affix_level
    }

    for (let val of avatars.reliquaries) {
      if (set[val.set.name]) {
        set[val.set.name]++

        if (set[val.set.name] == 2) {
          if (text1) {
            text2 = '2件套：' + val.set.affixes[0].effect
          } else {
            text1 = '2件套：' + val.set.affixes[0].effect
          }
        }

        if (set[val.set.name] == 4) {
          text2 = '4件套：' + val.set.name
        }
      } else {
        set[val.set.name] = 1
      }

      list.push({
        type: 'reliquaries',
        name: val.name,
        level: val.level
      })
    }

    for (let val of Object.keys(set)) {
      setArr.push({
        name: val,
        num: set[val],
        showName: gsCfg.shortName(val, true)
      })
    }

    if (avatars.reliquaries.length >= 2 && !text1) {
      text1 = '无套装效果'
    }

    if (avatars.id == '10000005') avatars.name = '空'
    if (avatars.id == '10000007') avatars.name = '荧'

    // 皮肤图片
    if (['魈', '甘雨'].includes(avatars.name)) {
      if (lodash.random(0, 100) > 50) {
        bg = 3
      }
    } else if (['芭芭拉', '凝光', '刻晴', '琴'].includes(avatars.name)) {
      if (avatars.costumes && avatars.costumes.length >= 1) {
        bg = 3
      }
    }

    return {
      name: avatars.name,
      showName: gsCfg.shortName(avatars.name),
      level: avatars.level,
      fetter: avatars.fetter,
      actived_constellation_num: avatars.actived_constellation_num,
      list,
      text1,
      text2,
      bg,
      set: setArr,
      constellations: avatars.constellations
    }
  }

  async noAvatar () {
    let msg = ''
    if (this.isBing) {
      let randFace = lodash.sample([26, 111, 110, 173, 177, 36, 37, 5, 9, 267, 264, 262, 265])
      msg = [`\n尚未拥有${this.e.roleName}`, segment.face(randFace)]
    } else {
      msg = '\n请先在米游社展示该角色'
    }
    await this.e.reply(msg, false, { at: true })
  }

  getSkill (data = {}, avatar) {
    if (!this.isBing) return {}

    let skill = {}
    skill.id = this.e.roleId
    let skillList = lodash.orderBy(data.skill_list, ['id'], ['asc'])

    for (let val of skillList) {
      val.level_original = val.level_current
      if (val.name.includes('普通攻击')) {
        skill.a = val
        continue
      }
      if (val.max_level >= 10 && !skill.e) {
        skill.e = val
        continue
      }
      if (val.max_level >= 10 && !skill.q) {
        skill.q = val
        continue
      }
    }
    if (avatar.actived_constellation_num >= 3) {
      if (avatar.constellations[2].effect.includes(skill.e.name)) {
        skill.e.level_current += 3
      } else if (avatar.constellations[2].effect.includes(skill.q.name)) {
        skill.q.level_current += 3
      }
    }
    if (avatar.actived_constellation_num >= 5) {
      if (avatar.constellations[4].effect.includes(skill.e.name)) {
        skill.e.level_current += 3
      } else if (avatar.constellations[4].effect.includes(skill.q.name)) {
        skill.q.level_current += 3
      }
    }

    return skill
  }
}

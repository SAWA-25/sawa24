
export default class base {
  constructor (e = {}) {
    this.e = e
    this.isSr = e.isSr
    this.userId = e?.user_id
    this.model = 'genshin' 
    this._path = process.cwd().replace(/\\/g, '/')
  }

  get prefix () {
    return `Yz:genshin:${this.model}:`
  }

  /**
   * 截图默认数据
   * @param saveId html保存id
   * @param tplFile 模板html路径
   * @param pluResPath 插件资源路径
   */
  get screenData () {
    let headImg = this.isSr ? 'StarRail/img/worldcard/星穹列车' : 'img/namecard/白术'
    let gsStyle = 'background-position-x: 42px;  background-size: auto 101%;'
    let srStyle = 'background-position-x: -10px; background-size: 500px; background-position-y: -90px;'
    let pluResPath = `${this._path}/plugins/genshin/resources/`

    return {
      saveId: this.userId,
      cwd: this._path,
      tplFile: `./plugins/genshin/resources/html/${this.model}/${this.model}.html`,
      /** 绝对路径 */
      pluResPath: pluResPath,
      srResPath: this.isSr ? `${pluResPath}StarRail/` : pluResPath,
      headStyle: `<style> .head_box { background: url(${this._path}/plugins/genshin/resources/${headImg}.png) #fff; background-repeat: no-repeat; ${this.isSr ? srStyle : gsStyle} }</style>`
    }
  }
}

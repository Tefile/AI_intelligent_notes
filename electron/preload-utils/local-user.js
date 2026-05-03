// 本地用户桥接：暴露当前用户信息和会话级身份数据。
const dbBridge = require('./db-bridge')

module.exports = {
  getCurrentUser() {
    return dbBridge.getCurrentUser()
  },

  listUsers() {
    return dbBridge.listUsers()
  },

  saveUser(user, options = {}) {
    return dbBridge.saveUser(user, options)
  },

  switchUser(id) {
    return dbBridge.switchUser(id)
  },

  deleteUser(id) {
    return dbBridge.deleteUser(id)
  },

  getUsersFilePath() {
    return ''
  }
}

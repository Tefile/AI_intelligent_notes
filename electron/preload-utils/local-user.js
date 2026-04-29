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

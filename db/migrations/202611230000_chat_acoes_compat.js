// Move as propostas V2 antigas para tabelas próprias antes da migração V1.
const { convergirV2, reverterComBackup } = require('../chatActionSchema.js')

exports.config = { transaction: false }
exports.up = convergirV2
exports.down = reverterComBackup

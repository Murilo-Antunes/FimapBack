// Mantém a tabela usada pelos rascunhos com código de confirmação do chat V1.
const { garantirV1, reverterComBackup } = require('../chatActionSchema.js')

exports.config = { transaction: false }
exports.up = garantirV1
exports.down = reverterComBackup

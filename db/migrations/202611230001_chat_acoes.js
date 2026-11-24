// Garante as tabelas V2 e mantém o nome já registrado pelo Knex.
const { convergirV2, reverterComBackup } = require('../chatActionSchema.js')

exports.config = { transaction: false }
exports.up = convergirV2
exports.down = reverterComBackup

// Cria a tabela que guarda os alertas e recomendações da IA por usuário,
// incluindo a mensagem, a ação sugerida e quando o alerta foi dispensado.
const table = 'tbl_alerta_gasto_ia'

exports.up = (knex) => knex.schema.createTable(table, (columns) => {
    columns.increments('id')
    columns.integer('id_usuario').notNullable().references('id').inTable('tbl_usuario').onDelete('CASCADE')
    columns.string('chave', 100).notNullable()
    columns.string('mes', 7).notNullable()
    columns.string('categoria', 64).notNullable()
    columns.string('titulo', 100).notNullable()
    columns.string('mensagem', 512).notNullable()
    columns.string('acao', 32).notNullable()
    columns.timestamp('dispensada_em').nullable()
    columns.unique(['id_usuario', 'chave'])
    columns.index(['id_usuario', 'mes', 'dispensada_em'])
})

exports.down = (knex) => knex.schema.dropTable(table)

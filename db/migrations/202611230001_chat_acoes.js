// Cria as tabelas que guardam as propostas do chat e suas versões.
exports.up = async (knex) => {
    await knex.schema.createTable('tbl_chat_acao', (t) => {
        t.engine('InnoDB')
        t.string('id', 36).primary()
        t.integer('id_chat').notNullable().references('id').inTable('tbl_chat').onDelete('CASCADE')
        t.enu('tipo', ['meta', 'investimento', 'amortizacao']).notNullable()
        t.integer('versao').notNullable()
        t.integer('id_registro').nullable()
        t.unique(['tipo', 'id_registro'])
        t.index(['id_chat', 'id_registro'])
    })
    await knex.schema.createTable('tbl_chat_acao_versao', (t) => {
        t.engine('InnoDB')
        t.string('id_acao', 36).notNullable().references('id').inTable('tbl_chat_acao').onDelete('CASCADE')
        t.integer('versao').notNullable()
        t.integer('id_mensagem').notNullable().references('id').inTable('tbl_mensagem').onDelete('CASCADE')
        t.json('payload').notNullable()
        t.primary(['id_acao', 'versao'])
    })
}

exports.down = async (knex) => {
    await knex.schema.dropTable('tbl_chat_acao_versao')
    await knex.schema.dropTable('tbl_chat_acao')
}

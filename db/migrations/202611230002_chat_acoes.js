exports.up = (knex) => knex.schema.createTable('tbl_chat_acao', (t) => {
    t.engine('InnoDB')
    t.integer('id_chat').primary().references('id').inTable('tbl_chat').onDelete('CASCADE')
    t.string('codigo', 8).notNullable()
    t.text('proposta').notNullable()
    t.bigInteger('expira_ms').notNullable()
})

exports.down = (knex) => knex.schema.dropTable('tbl_chat_acao')

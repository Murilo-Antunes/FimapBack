// Adiciona área e validade às recomendações para a exibição e o histórico.
// Também guarda posições de investimento para comparar quantidade e valor ao longo do tempo.
exports.up = async (db) => {
    await db.schema.alterTable('tbl_alerta_gasto_ia', (columns) => {
        columns.string('area', 24).notNullable().defaultTo('nucleo')
        columns.bigInteger('expira_ms').notNullable().defaultTo(0)
        columns.index(['id_usuario', 'area', 'expira_ms'], 'idx_alerta_usuario_area_expira')
    })
    await db.schema.createTable('tbl_posicao_recomendacao_ia', (columns) => {
        columns.integer('id_usuario').notNullable().references('id').inTable('tbl_usuario').onDelete('CASCADE')
        columns.string('posicao', 64).notNullable()
        columns.double('quantidade').notNullable()
        columns.bigInteger('valor_centavos').notNullable()
        columns.bigInteger('referencia_ms').notNullable()
        columns.primary(['id_usuario', 'posicao'])
    })
}

exports.down = async (db) => {
    await db.schema.dropTable('tbl_posicao_recomendacao_ia')
    await db.schema.alterTable('tbl_alerta_gasto_ia', (columns) => {
        columns.dropIndex(['id_usuario', 'area', 'expira_ms'], 'idx_alerta_usuario_area_expira')
        columns.dropColumns('area', 'expira_ms')
    })
}

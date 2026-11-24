const colunas = {
    tbl_usuario: {
        perfil_social_ativo: (t) => t.boolean('perfil_social_ativo').notNullable().defaultTo(true)
    },
    tbl_configuracoes: {
        quem_comenta: (t) => t.enu('quem_comenta', ['todos', 'seguidores', 'ninguem']).notNullable().defaultTo('todos'),
        notif_respostas_mencoes: (t) => t.boolean('notif_respostas_mencoes').notNullable().defaultTo(true),
        notif_conquistas: (t) => t.boolean('notif_conquistas').notNullable().defaultTo(true)
    },
    tbl_notificacao: {
        tipo_referencia: (t) => t.string('tipo_referencia', 30),
        id_referencia: (t) => t.integer('id_referencia')
    }
}

exports.config = { transaction: false }

exports.up = async (knex) => {
    for (const [tabela, campos] of Object.entries(colunas)) {
        for (const [nome, adicionar] of Object.entries(campos)) {
            if (!await knex.schema.hasColumn(tabela, nome)) {
                await knex.schema.alterTable(tabela, adicionar)
            }
        }
    }

    if (!await knex.schema.hasTable('tbl_bloqueio_usuario')) {
        await knex.schema.createTable('tbl_bloqueio_usuario', (t) => {
            t.increments('id')
            t.integer('id_bloqueador').notNullable().references('tbl_usuario.id').onDelete('CASCADE')
            t.integer('id_bloqueado').notNullable().references('tbl_usuario.id').onDelete('CASCADE')
            t.timestamp('data_criacao').notNullable().defaultTo(knex.fn.now())
            t.unique(['id_bloqueador', 'id_bloqueado'])
        })
    }

    if (!await knex.schema.hasTable('tbl_solicitacao_acesso')) {
        await knex.schema.createTable('tbl_solicitacao_acesso', (t) => {
            t.increments('id')
            t.integer('id_solicitante').notNullable().references('tbl_usuario.id').onDelete('CASCADE')
            t.integer('id_destinatario').notNullable().references('tbl_usuario.id').onDelete('CASCADE')
            t.enu('tipo', ['conexao', 'seguir']).notNullable()
            t.enu('status', ['pendente', 'aceita', 'recusada']).notNullable().defaultTo('pendente')
            t.timestamp('data_criacao').notNullable().defaultTo(knex.fn.now())
            t.timestamp('data_resposta').nullable()
            t.unique(['id_solicitante', 'id_destinatario'])
            t.index(['id_destinatario', 'status', 'data_criacao'])
        })
    }

    const [indices] = await knex.raw('SHOW INDEX FROM tbl_post')
    const indiceDeConteudo = indices.some((indice) =>
        indice.Index_type === 'FULLTEXT' && indice.Column_name === 'conteudo' &&
        !indices.some((outro) => outro.Key_name === indice.Key_name && outro.Seq_in_index > 1)
    )
    if (!indiceDeConteudo) {
        await knex.raw('ALTER TABLE tbl_post ADD FULLTEXT INDEX idx_fimap_post_busca (conteudo)')
    }
}

exports.down = async () => {
    throw new Error('A reversão exige revisão manual para preservar os dados sociais e o esquema preexistente.')
}

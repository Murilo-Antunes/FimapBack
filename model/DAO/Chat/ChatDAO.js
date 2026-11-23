/*
 * PARA QUE SERVE: Lê e altera os dados do chat no banco: nome, dono, criação e exclusão.
 * QUANDO ENTRA EM AÇÃO: Entra quando o ChatController precisa criar, listar, renomear ou apagar um chat.
 * QUANDO FAZ DIFERENÇA: Faz diferença para manter os IDs corretos e executar as consultas com parâmetros.
 */

const db = require('../../Database_config_knex/connection.js')
const { criarErro } = require('../../../src/services/chatValidation.js')

const LIMITE_CHATS_POR_USUARIO = 20

const insertChat = (nome, id_usuario) => db.transaction(async (trx) => {
    // O bloqueio por usuário serializa criações em todas as instâncias do backend.
    const usuario = await trx('tbl_usuario').where('id', id_usuario).select('id').forUpdate().first()
    if (!usuario) throw criarErro(404, 'Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO')

    const { quantidade } = await trx('tbl_chat').where({ id_usuario }).count({ quantidade: '*' }).first()
    if (Number(quantidade) >= LIMITE_CHATS_POR_USUARIO) {
        throw criarErro(409, `Limite de ${LIMITE_CHATS_POR_USUARIO} chats atingido. Apague um chat para criar outro.`, 'CHAT_LIMITE_USUARIO')
    }

    const [result] = await trx.raw(
        'insert into tbl_chat (nome, data_criacao, id_usuario) values (?, now(), ?);', [nome, id_usuario])
    return result.insertId
})

// O id também é retornado para os controllers conseguirem referenciar o chat.
const GetChatById = async (id_chat, id_usuario) => {
    const [rows] = await db.raw('select id, nome, data_criacao, id_usuario from tbl_chat where id = ? and id_usuario = ?;', [id_chat, id_usuario])
    return rows[0] || null
}

const ListChatsByUserId = async (id_usuario) => {
    const [rows] = await db.raw(
        'select id, nome, data_criacao, id_usuario from tbl_chat where id_usuario = ? order by data_criacao desc, id desc;',
        [id_usuario])
    return rows
}

// A exclusão exige que chat e usuário correspondam no próprio comando SQL.
const apagarChat = async (id_chat, id_usuario) => {
    const [result] = await db.raw('delete from tbl_chat where id = ? and id_usuario = ?;', [id_chat, id_usuario])
    return result.affectedRows > 0
}

const UpdateChatName = async (id_chat, novo_nome, id_usuario) => {
    const [result] = await db.raw('update tbl_chat set nome = ? where id = ? and id_usuario = ?;', [novo_nome, id_chat, id_usuario])
    return result.affectedRows > 0
}

module.exports = {
    insertChat,
    inssertChat: insertChat, // Compatibilidade com chamadas existentes.
    GetChatById,
    ListChatsByUserId,
    apagarChat,
    UpdateChatName
}

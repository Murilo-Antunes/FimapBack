// Busca as mensagens e os cartões de uma conversa.
// O banco mantém papel 1/2; o contrato do frontend recebe 0/1.
const db = require('../../Database_config_knex/connection.js')
const chatDAO = require('../Chat/ChatDAO.js')
const acoes = require('./AcaoChatDAO.js')
const formatarMensagem = (m) => ({ id: m.id, conteudo: m.conteudo,
    papel: Number(m.papel) - 1, data_envio: m.data_envio,
    ...(m.acoes_financeiras?.length ? { acoes_financeiras: m.acoes_financeiras } : {}) })

const buscarChat = (chat, usuario) => chatDAO.GetChatById(chat, usuario)
const listarMensagensChat = async (chat, usuario) => {
    if (!await buscarChat(chat, usuario)) return null
    const linhas = await db('tbl_mensagem as m').join('tbl_chat as c', 'c.id', 'm.id_chat')
        .where('c.id', chat).where('c.id_usuario', usuario)
        .select('m.id', 'm.conteudo', 'm.papel', 'm.data_envio')
        .orderBy('m.data_envio', 'asc').orderBy('m.id', 'asc')
    await acoes.anexar(chat, linhas, db)
    return linhas.map(formatarMensagem)
}

module.exports = { buscarChat, listarMensagensChat, formatarMensagem }

const config_message = require('../modulo/configMensagens.js')
const nivelDAO = require('../../../model/DAO/Nivel/nivelDAO.js')

const responderErro = (res, cfg) =>
    res.status(cfg.status).json({ sucesso: false, mensagem: cfg.mensagem })

const responderSucesso = (res, cfg, dados = {}) =>
    res.status(cfg.status).json({ sucesso: true, mensagem: cfg.mensagem, ...dados })

// GET /niveis
// Lista de todos os níveis cadastrados (nivel, titulo, xp_necessario),
// usada pelo front pra parar de ter um mapa de títulos fixo no código.
const buscarNiveis = async (req, res) => {
    try {
        const niveis = await nivelDAO.BuscarTodosNiveis()
        return responderSucesso(res, config_message.NIVEIS_ENCONTRADOS, { niveis })
    } catch (error) {
        console.error('Erro ao buscar níveis:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_NIVEIS)
    }
}

module.exports = { buscarNiveis }

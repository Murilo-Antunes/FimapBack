const config_message = require('../modulo/configMensagens.js')

const seguir_seguidoresDAO = require('../../../model/DAO/Seguir_Seguidores/seguir_seguidoresDAO.js')


const seguir = async (req, res) => {
    const { id_seguidor, id_seguindo } = req.body

    if (!id_seguidor || !id_seguindo) {
        return res.status(400).json({ mensagem: config_message.ERROR_REQUIRED_FIELDS })
    }

    try {
        const resultado = await seguir_seguidoresDAO.createSeguir({ id_seguidor, id_seguindo })
        if (resultado) {
            return res.status(201).json({ mensagem: config_message.SUCCESS_CREATED })
        } else {
            return res.status(400).json({ mensagem: config_message.ERROR_ALREADY_FOLLOWING })
        }
    } catch (error) {
        console.error('Erro ao criar seguir:', error)
        return res.status(500).json({ mensagem: config_message.ERROR_INTERNAL_SERVER })
    }
}

const deixarDeSeguir = async (req, res) => {
    const { id_seguidor, id_seguindo } = req.body

    if (!id_seguidor || !id_seguindo) {
        return res.status(400).json({ mensagem: config_message.ERROR_REQUIRED_FIELDS })
    }

    try {
        const resultado = await seguir_seguidoresDAO.deleteSeguir(id_seguidor, id_seguindo)
        if (resultado) {
            return res.status(200).json({ mensagem: config_message.SUCCESS_DELETED })
        } else {
            return res.status(404).json({ mensagem: config_message.ERROR_NOT_FOUND })
        }
    } catch (error) {
        console.error('Erro ao deixar de seguir:', error)
        return res.status(500).json({ mensagem: config_message.ERROR_INTERNAL_SERVER })
    }
}

const listarSeguidores = async (req, res) => {
    const { id_usuario } = req.params

    if (!id_usuario) {
        return res.status(400).json({ mensagem: config_message.ERROR_REQUIRED_FIELDS })
    }

    try {
        const seguidores = await seguir_seguidoresDAO.getSeguidoresByUsuarioId(id_usuario)
        return res.status(200).json(seguidores)
    } catch (error) {
        console.error('Erro ao listar seguidores:', error)
        return res.status(500).json({ mensagem: config_message.ERROR_INTERNAL_SERVER })
    }
}

const listarSeguindo = async (req, res) => {
    const { id_usuario } = req.params

    if (!id_usuario) {
        return res.status(400).json({ mensagem: config_message.ERROR_REQUIRED_FIELDS })
    }

    try {
        const seguindo = await seguir_seguidoresDAO.getSeguindoByUsuarioId(id_usuario)
        return res.status(200).json(seguindo)
    } catch (error) {
        console.error('Erro ao listar seguindo:', error)
        return res.status(500).json({ mensagem: config_message.ERROR_INTERNAL_SERVER })
    }
}  

// GET /seguir/verificar?id_seguidor=1&id_seguindo=2
// Responde { segue: boolean }. Evita que o front precise baixar a lista
// inteira de seguidores só pra saber se "eu" sigo "fulano".
const verificarSegue = async (req, res) => {
    try {
        const id_seguidor = Number(req.query?.id_seguidor)
        const id_seguindo = Number(req.query?.id_seguindo)

        const idValido = (id) => Number.isInteger(id) && id > 0

        if (!idValido(id_seguidor) || !idValido(id_seguindo)) {
            return res.status(400).json({ sucesso: false, mensagem: 'Informe id_seguidor e id_seguindo válidos.' })
        }

        const relacao = await seguir_seguidoresDAO.verificarSegue(id_seguidor, id_seguindo)

        return res.status(200).json({ sucesso: true, mensagem: 'Verificação concluída.', segue: Boolean(relacao) })

    } catch (error) {
        console.error('Erro ao verificar se segue:', error)
        return res.status(500).json({ sucesso: false, mensagem: 'Erro interno do servidor.' })
    }
}


module.exports = {
    seguir,
    deixarDeSeguir,
    listarSeguidores,
    listarSeguindo,
    verificarSegue
}
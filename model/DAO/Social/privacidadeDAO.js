const knexConex = require('../../Database_config_knex/knexConex.js')

async function BuscarDono(id_usuario) {
    const row = await knexConex('tbl_usuario')
        .select('id', 'visibilidade', 'perfil_social_ativo')
        .where({ id: id_usuario })
        .first()

    return row ?? null
}

// O visualizador tem uma solicitação ACEITA para ver o perfil do dono?
async function TemAcessoAprovado(id_visualizador, id_dono) {
    const row = await knexConex('tbl_solicitacao_acesso')
        .select('id')
        .where({ id_solicitante: id_visualizador, id_destinatario: id_dono, status: 'aceita' })
        .first()

    return Boolean(row)
}

// id_bloqueador bloqueou id_bloqueado?
async function EstaBloqueado(id_bloqueador, id_bloqueado) {
    const row = await knexConex('tbl_bloqueio_usuario')
        .select('id')
        .where({ id_bloqueador, id_bloqueado })
        .first()

    return Boolean(row)
}

async function SegueUsuario(id_seguidor, id_seguindo) {
    const row = await knexConex('tbl_seguidores')
        .select('id')
        .where({ id_seguidor, id_seguindo })
        .first()

    return Boolean(row)
}

// Regra "Quem pode comentar em seus posts" + bloqueio.
async function PodeComentar(id_autor, id_usuario) {
    if (id_autor === id_usuario) return true
    if (await EstaBloqueado(id_autor, id_usuario)) return false

    const cfg = await knexConex('tbl_configuracoes')
        .select('quem_comenta')
        .where({ id_usuario: id_autor })
        .first()

    const regra = cfg?.quem_comenta ?? 'todos'

    if (regra === 'todos') return true
    if (regra === 'ninguem') return false

    // 'seguidores': só comenta quem segue o autor
    return SegueUsuario(id_usuario, id_autor)
}

module.exports = { BuscarDono, TemAcessoAprovado, EstaBloqueado, SegueUsuario, PodeComentar }

const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

// Convenção deste arquivo: erros de banco são relançados (throw);
// quem trata é o controller.

// Dono de um username_social (já em minúsculas) ou null
const GetUsuarioByUsernameSocial = async (usernameSocial) => {
    try {
        const [rows] = await knexConex.raw(
            'select id from tbl_usuario where username_social = ? limit 1',
            [usernameSocial]
        )

        return rows[0] ?? null
    } catch (error) {
        console.error('Erro ao buscar username social:', error)
        throw error
    }
}

// Foto atual do usuário. Retorna { foto_perfil } ou null se o usuário não existe
const GetFotoPerfil = async (idUsuario) => {
    try {
        const [rows] = await knexConex.raw(
            'select foto_perfil from tbl_usuario where id = ? limit 1',
            [idUsuario]
        )

        return rows[0] ?? null
    } catch (error) {
        console.error('Erro ao buscar foto de perfil:', error)
        throw error
    }
}

// Grava (url) ou limpa (null) a foto de perfil. Retorna as linhas afetadas
const UpdateFotoPerfil = async (idUsuario, url) => {
    try {
        const [result] = await knexConex.raw(
            'update tbl_usuario set foto_perfil = ? where id = ?',
            [url, idUsuario]
        )

        return result.affectedRows
    } catch (error) {
        console.error('Erro ao atualizar foto de perfil:', error)
        throw error
    }
}

module.exports = {
    GetUsuarioByUsernameSocial,
    GetFotoPerfil,
    UpdateFotoPerfil
}

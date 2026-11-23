const knex = require('knex')

const knexConfig = require('../../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

const STATUS_ATIVO = 1
const STATUS_REMOVIDO = 0

// Convenção deste arquivo: erros de banco são relançados (throw);
// quem trata é o controller.

/* ------------------------------ Helpers ------------------------------ */

// Post + autor + contagens + "curtiu" do usuário que está vendo (idVisualizador).
// idVisualizador = 0 quando não há usuário: "curtiu" nunca dá true.
const SQL_POST_COM_AUTOR = `
    select p.*,
        u.id as autor_id,
        u.nome_exibicao as autor_nome_exibicao,
        u.username_social as autor_username_social,
        u.foto_perfil as autor_foto_perfil,
        (select count(*) from tbl_curtida_post cp where cp.id_post = p.id) as total_curtidas,
        (select count(*) from tbl_comentario c where c.id_post = p.id) as total_comentarios,
        exists(select 1 from tbl_curtida_post cp
               where cp.id_post = p.id and cp.id_usuario = ?) as curtiu
    from tbl_post p
    join tbl_usuario u on u.id = p.id_usuario`

// Escapa % _ \ para o termo digitado não virar curinga do LIKE
const escapeLike = (texto) => texto.replace(/[\\%_]/g, '\\$&')

// Lista posts de um usuário filtrando pelo status
const buscarPostsPorStatus = async (idUsuario, status, mensagemErro) => {
    const sql = `${SQL_POST_COM_AUTOR} where p.id_usuario = ? and p.status = ?`

    try {
        const [rows] = await knexConex.raw(sql, [0, idUsuario, status])

        return rows
    } catch (error) {
        console.error(mensagemErro, error)
        throw error
    }
}

/* ------------------------------ Create ------------------------------ */

// Cria o post como ativo. Retorna o id criado
const CreatePost = async (post) => {
    const sql = `insert into tbl_post
        (conteudo, data_criacao, data_atualizacao, status, id_usuario)
        values (?, now(), now(), ?, ?)`

    try {
        const [result] = await knexConex.raw(sql, [
            post.conteudo,
            STATUS_ATIVO,
            post.id_usuario
        ])

        return result.insertId
    } catch (error) {
        // Usuário inexistente é tratado pelo controller (validação), sem log de erro
        if (error.code !== 'ER_NO_REFERENCED_ROW_2') {
            console.error('Erro ao criar post:', error)
        }

        throw error
    }
}

/* ------------------------------- Read ------------------------------- */

// Verifica se o usuário existe (true/false)
const ExisteUsuario = async (idUsuario) => {
    try {
        const [rows] = await knexConex.raw(
            'select id from tbl_usuario where id = ? limit 1',
            [idUsuario]
        )

        return rows.length > 0
    } catch (error) {
        console.error('Erro ao verificar usuário:', error)
        throw error
    }
}

// Retorna o post (qualquer status) com autor e contagens, ou null.
// idVisualizador é opcional: quem chama sem ele (ex.: curtidas) recebe curtiu = false.
const GetPostById = async (postId, idVisualizador = 0) => {
    try {
        const [rows] = await knexConex.raw(
            `${SQL_POST_COM_AUTOR} where p.id = ?`,
            [Number(idVisualizador) || 0, postId]
        )

        return rows[0] ?? null
    } catch (error) {
        console.error('Erro ao buscar post:', error)
        throw error
    }
}

// Todos os posts do usuário, de qualquer status (inclui removidos)
const GetAllPostsByIdUsuario = async (idUsuario) => {
    try {
        const [rows] = await knexConex.raw(`${SQL_POST_COM_AUTOR} where p.id_usuario = ?`, [0, idUsuario])

        return rows
    } catch (error) {
        console.error('Erro ao buscar posts:', error)
        throw error
    }
}

const GetAllPostsAtivosByIdUsuario = (idUsuario) =>
    buscarPostsPorStatus(idUsuario, STATUS_ATIVO, 'Erro ao buscar posts ativos:')

const GetAllPostsInativosByIdUsuario = (idUsuario) =>
    buscarPostsPorStatus(idUsuario, STATUS_REMOVIDO, 'Erro ao buscar posts inativos:')

// Feed da comunidade: posts ativos de usuários com perfil social completo.
// ordem: 'recentes' | 'antigos'. busca: texto procurado dentro de conteudo[*].valor.
// Retorna { posts, total }.
const GetFeedPosts = async ({ idVisualizador = 0, limite, offset, ordem, busca }) => {
    // conteudo é TEXT: se for JSON válido procura dentro de conteudo[*].valor;
    // se for texto puro (posts muito antigos), faz LIKE direto
    const filtroBusca = busca
        ? `and case when json_valid(p.conteudo)
                then json_search(p.conteudo, 'one', ?, null, '$[*].valor') is not null
                else p.conteudo like ? end`
        : ''
    const termo = busca ? `%${escapeLike(busca)}%` : null
    const paramsBusca = busca ? [termo, termo] : []
    const direcao = ordem === 'antigos' ? 'asc' : 'desc'

    const where = `where p.status = ?
        and u.nome_exibicao is not null and u.nome_exibicao <> ''
        and u.username_social is not null and u.username_social <> ''
        and coalesce(u.visibilidade, 1) = 1
        ${filtroBusca}`

    try {
        const [[{ total }]] = await knexConex.raw(
            `select count(*) as total
             from tbl_post p join tbl_usuario u on u.id = p.id_usuario
             ${where}`,
            [STATUS_ATIVO, ...paramsBusca]
        )

        const [posts] = await knexConex.raw(
            `${SQL_POST_COM_AUTOR}
             ${where}
             order by p.data_criacao ${direcao}, p.id ${direcao}
             limit ? offset ?`,
            [Number(idVisualizador) || 0, STATUS_ATIVO, ...paramsBusca, limite, offset]
        )

        return { posts, total: Number(total) }
    } catch (error) {
        console.error('Erro ao buscar feed:', error)
        throw error
    }
}

// Dados sociais do usuário (para o criarPost exigir perfil completo). Retorna a linha ou null.
const GetPerfilSocial = async (idUsuario) => {
    try {
        const [rows] = await knexConex.raw(
            'select id, nome_exibicao, username_social from tbl_usuario where id = ? limit 1',
            [idUsuario]
        )

        return rows[0] ?? null
    } catch (error) {
        console.error('Erro ao buscar perfil social:', error)
        throw error
    }
}

/* ------------------------------ Update ------------------------------ */

// Atualiza o conteúdo de um post ativo do usuário. Retorna as linhas afetadas
const UpdatePost = async (post) => {
    const sql = `update tbl_post
        set conteudo = ?, data_atualizacao = now()
        where id = ? and id_usuario = ? and status = ?`

    try {
        const [result] = await knexConex.raw(sql, [
            post.conteudo,
            post.id,
            post.id_usuario,
            STATUS_ATIVO
        ])

        return result.affectedRows
    } catch (error) {
        console.error('Erro ao atualizar post:', error)
        throw error
    }
}

/* ------------------------------ Delete ------------------------------ */

// Exclusão lógica: muda o status para removido. Retorna as linhas afetadas
const DeletePost = async (postId, idUsuario) => {
    const sql = `update tbl_post
        set status = ?
        where id = ? and id_usuario = ? and status = ?`

    try {
        const [result] = await knexConex.raw(sql, [
            STATUS_REMOVIDO,
            postId,
            idUsuario,
            STATUS_ATIVO
        ])

        return result.affectedRows
    } catch (error) {
        console.error('Erro ao deletar post:', error)
        throw error
    }
}

module.exports = {
    CreatePost,
    UpdatePost,
    DeletePost,
    ExisteUsuario,
    GetPostById,
    GetFeedPosts,
    GetPerfilSocial,
    GetAllPostsByIdUsuario,
    GetAllPostsInativosByIdUsuario,
    GetAllPostsAtivosByIdUsuario
}

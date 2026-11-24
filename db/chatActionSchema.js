// Separa as tabelas de propostas antigas e novas sem apagar os dados.
const legado = 'tbl_chat_acao'
const versaoAntiga = 'tbl_chat_acao_versao'
const acoes = 'tbl_chat_acao_v2'
const versoes = 'tbl_chat_acao_v2_versao'

const colunasV1 = { id_chat: 'int', codigo: 'varchar(8)', proposta: 'text', expira_ms: 'bigint' }
const colunasV2 = { id: 'varchar(36)', id_chat: 'int', tipo: "enum('meta','investimento','amortizacao')",
    versao: 'int', id_registro: 'int' }
const colunasVersoes = { id_acao: 'varchar(36)', versao: 'int', id_mensagem: 'int', payload: 'json' }

function incompatível(tabela) {
    return new Error('Esquema de ações do chat incompatível em ' + tabela + '. Confira as tabelas e o histórico do Knex.')
}

async function inspecionar(knex, tabela) {
    const [[registro]] = await knex.raw('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabela])
    if (!registro) return null
    if (registro.engine !== 'InnoDB') throw incompatível(tabela)
    const [colunas] = await knex.raw(`
        SELECT COLUMN_NAME AS nome, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulavel
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabela])
    const [indices] = await knex.raw(`
        SELECT INDEX_NAME AS nome, COLUMN_NAME AS coluna, NON_UNIQUE AS nao_unico
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [tabela])
    const [fks] = await knex.raw(`
        SELECT k.COLUMN_NAME AS coluna, k.REFERENCED_TABLE_NAME AS destino,
               k.REFERENCED_COLUMN_NAME AS chave, r.DELETE_RULE AS exclusao,
               k.REFERENCED_TABLE_SCHEMA = DATABASE() AS local
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL`, [tabela])
    return { colunas, indices, fks }
}

function confere(registro, campos, pk) {
    return registro.colunas.length === Object.keys(campos).length &&
        registro.colunas.every(({ nome, tipo, nulavel }) =>
            campos[nome] === tipo && nulavel === (nome === 'id_registro' ? 'YES' : 'NO')) &&
        registro.indices.filter(({ nome }) => nome === 'PRIMARY').map(({ coluna }) => coluna).join(',') === pk
}

function conferirFk(registro, tabela, coluna, destino) {
    const fks = registro.fks.filter((fk) => fk.coluna === coluna)
    if (fks.some((fk) => fk.destino !== destino || fk.chave !== 'id' || fk.exclusao !== 'CASCADE' || !Number(fk.local)))
        throw incompatível(tabela)
    return fks.length > 0
}

async function garantirFk(knex, tabela, registro, coluna, destino) {
    if (!conferirFk(registro, tabela, coluna, destino))
        await knex.raw('ALTER TABLE ?? ADD FOREIGN KEY (??) REFERENCES ?? (id) ON DELETE CASCADE', [tabela, coluna, destino])
}

function temUnico(registro, colunas) {
    const unicos = new Map()
    for (const indice of registro.indices) {
        if (Number(indice.nao_unico)) continue
        unicos.set(indice.nome, [...(unicos.get(indice.nome) ?? []), indice.coluna])
    }
    return [...unicos.values()].some((indexadas) => indexadas.join(',') === colunas)
}

async function convergirV2(knex) {
    const [anterior, historicoAntigo, atual, historicoAtual] = await Promise.all(
        [legado, versaoAntiga, acoes, versoes].map((tabela) => inspecionar(knex, tabela))
    )
    const v2NoNomeLegado = anterior && confere(anterior, colunasV2, 'id')
    if (anterior && !v2NoNomeLegado && !confere(anterior, colunasV1, 'id_chat')) throw incompatível(legado)
    if (atual && (!confere(atual, colunasV2, 'id') || v2NoNomeLegado)) throw incompatível(acoes)
    if (historicoAntigo && (!confere(historicoAntigo, colunasVersoes, 'id_acao,versao') || historicoAtual))
        throw incompatível(versaoAntiga)
    if (historicoAtual && !confere(historicoAtual, colunasVersoes, 'id_acao,versao')) throw incompatível(versoes)
    const cabecalho = atual || (v2NoNomeLegado ? anterior : null)
    const historico = historicoAntigo || historicoAtual
    if (cabecalho) conferirFk(cabecalho, v2NoNomeLegado ? legado : acoes, 'id_chat', 'tbl_chat')
    if (historico) {
        const tabela = historicoAntigo ? versaoAntiga : versoes
        if (!cabecalho) throw incompatível(tabela)
        conferirFk(historico, tabela, 'id_acao', v2NoNomeLegado ? legado : acoes)
        conferirFk(historico, tabela, 'id_mensagem', 'tbl_mensagem')
    }
    if (v2NoNomeLegado && historicoAntigo) {
        // Uma operação só para que a referência entre as duas tabelas acompanhe a troca de nome.
        await knex.raw('RENAME TABLE ?? TO ??, ?? TO ??', [legado, acoes, versaoAntiga, versoes])
    } else if (v2NoNomeLegado) await knex.raw('RENAME TABLE ?? TO ??', [legado, acoes])
    else if (historicoAntigo) await knex.raw('RENAME TABLE ?? TO ??', [versaoAntiga, versoes])

    if (!cabecalho) await knex.raw(`
        CREATE TABLE ?? (
            id VARCHAR(36) NOT NULL PRIMARY KEY, id_chat INT NOT NULL,
            tipo ENUM('meta','investimento','amortizacao') NOT NULL,
            versao INT NOT NULL, id_registro INT NULL,
            UNIQUE (tipo, id_registro), INDEX (id_chat, id_registro),
            FOREIGN KEY (id_chat) REFERENCES tbl_chat(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`, [acoes])
    else {
        await garantirFk(knex, acoes, cabecalho, 'id_chat', 'tbl_chat')
        if (!temUnico(cabecalho, 'tipo,id_registro'))
            await knex.raw('ALTER TABLE ?? ADD UNIQUE (tipo, id_registro)', [acoes])
    }
    if (!historico) await knex.raw(`
        CREATE TABLE ?? (
            id_acao VARCHAR(36) NOT NULL, versao INT NOT NULL, id_mensagem INT NOT NULL, payload JSON NOT NULL,
            PRIMARY KEY (id_acao, versao),
            FOREIGN KEY (id_acao) REFERENCES ??(id) ON DELETE CASCADE,
            FOREIGN KEY (id_mensagem) REFERENCES tbl_mensagem(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`, [versoes, acoes])
    else {
        // Leia de novo caso o RENAME tenha atualizado a FK para a tabela V2.
        const estado = await inspecionar(knex, versoes)
        await garantirFk(knex, versoes, estado, 'id_acao', acoes)
        await garantirFk(knex, versoes, estado, 'id_mensagem', 'tbl_mensagem')
    }
}

async function garantirV1(knex) {
    const tabela = await inspecionar(knex, legado)
    if (tabela) {
        if (!confere(tabela, colunasV1, 'id_chat')) throw incompatível(legado)
        await garantirFk(knex, legado, tabela, 'id_chat', 'tbl_chat')
        return
    }
    await knex.raw(`
        CREATE TABLE ?? (
            id_chat INT NOT NULL PRIMARY KEY, codigo VARCHAR(8) NOT NULL, proposta TEXT NOT NULL, expira_ms BIGINT NOT NULL,
            FOREIGN KEY (id_chat) REFERENCES tbl_chat(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`, [legado])
}

const reverterComBackup = async () => {
    throw new Error('A reversão automática das ações do chat foi bloqueada para preservar os dados. Consulte docs/copilot-planning.md.')
}

module.exports = { acoes, versoes, convergirV2, garantirV1, reverterComBackup }

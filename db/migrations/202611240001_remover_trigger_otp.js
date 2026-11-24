exports.up = async (knex) => {
    // O DAO desativa os códigos anteriores na mesma transação que cria o novo.
    await knex.raw('DROP TRIGGER IF EXISTS trg_antes_inserir_otp')
}

exports.down = async () => {
    // Recriar a trigger impediria inserções com o erro 1442 do MySQL.
}


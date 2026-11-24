exports.up = async (knex) => {
    await knex.raw('DROP TRIGGER IF EXISTS trg_antes_inserir_otp')
    await knex.raw(`CREATE TRIGGER trg_antes_inserir_otp
BEFORE INSERT ON tbl_codigo_otp
FOR EACH ROW
BEGIN
    IF NEW.ativo = 1 AND EXISTS (
        SELECT 1 FROM tbl_codigo_otp
        WHERE id_usuario = NEW.id_usuario AND ativo = 1
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O usuário já possui um OTP ativo.';
    END IF;
END`)
}

exports.down = async (knex) => {
    await knex.raw('DROP TRIGGER IF EXISTS trg_antes_inserir_otp')
}

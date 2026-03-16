const { chamarTOTVSeParse } = require('./totvsConsultaSql');

const { TOTVS_WSURL, TOTVS_USER } = process.env;

/**
 * Executa a consulta BPM.SUP.007 no TOTVS RM por chave (P_CHAVE).
 * @param {string} chave - Chave da NF-e (44 caracteres, ex.: 42260102492310000287550010009069891004961297)
 * @returns {Promise<{ sucesso: boolean, dados: Array, erro?: string }>}
 */
async function consultarPorChave(chave) {
  if (!TOTVS_WSURL) {
    throw new Error('Variável de ambiente TOTVS_WSURL não configurada.');
  }

  const parameters = `P_CHAVE=${chave || ''}`;
  const soapEnvelope = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <tot:RealizarConsultaSQL>
      <tot:codSentenca>BPM.SUP.008.2</tot:codSentenca>
      <tot:codColigada>1</tot:codColigada>
      <tot:codSistema>T</tot:codSistema>
      <tot:codUsuario>${TOTVS_USER || ''}</tot:codUsuario>
      <tot:parameters>${parameters}</tot:parameters>
    </tot:RealizarConsultaSQL>
  </soapenv:Body>
</soapenv:Envelope>`.trim();

  return chamarTOTVSeParse(soapEnvelope);
}

module.exports = {
  consultarPorChave,
};

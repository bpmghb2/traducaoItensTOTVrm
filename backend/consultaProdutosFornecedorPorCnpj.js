const { chamarTOTVSeParse } = require('./totvsConsultaSql');

const { TOTVS_WSURL, TOTVS_USER } = process.env;

/**
 * Executa a sentença BPM.SUP.008.3 no TOTVS RM por CNPJ do fornecedor (P_CNPJ).
 * Retorna itens com CD_PRD_FORNECEDOR, IDPRD, DESCRICAO, etc.
 * @param {string} cnpj
 * @returns {Promise<{ sucesso: boolean, dados: Array, erro?: string }>}
 */
async function consultarProdutosFornecedorPorCnpj(cnpj) {
  if (!TOTVS_WSURL) {
    throw new Error('Variável de ambiente TOTVS_WSURL não configurada.');
  }

  const parameters = `P_CNPJ=${cnpj || ''}`;
  const soapEnvelope = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <tot:RealizarConsultaSQL>
      <tot:codSentenca>BPM.SUP.008.3</tot:codSentenca>
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
  consultarProdutosFornecedorPorCnpj,
};


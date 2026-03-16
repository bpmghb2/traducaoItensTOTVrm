const https = require('https');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

// URL do DataServer (SaveRecord). No WSDL do RM, o SOAP não é enviado ao /MEX e sim ao /IwsDataServer.
// Se TOTVS_DSURL apontar para .../MEX ou .../MEX?wsdl, convertemos para .../IwsDataServer para o POST.
const { TOTVS_DSURL, TOTVS_USER, TOTVS_PASS } = process.env;

function getDataServerPostUrl() {
  const raw = TOTVS_DSURL ? TOTVS_DSURL.replace(/#.*$/, '').trim() : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/$/, '');
    if (path.endsWith('/MEX')) {
      url.pathname = path.replace(/\/MEX$/i, '/IwsDataServer');
      url.search = '';
      return url.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

const DATA_SERVER_URL = getDataServerPostUrl();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/** Monta header Basic preemptive (igual SOAP UI: username/password, authenticate pre-emptively). */
function getBasicAuthHeader() {
  if (!TOTVS_USER || !TOTVS_PASS) return {};
  const token = Buffer.from(`${TOTVS_USER}:${TOTVS_PASS}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Envia um registro para o DataServer EstPrdCfoTOTVSColaboracaoData (SaveRecord),
 * criando o vínculo entre produto interno (IDPRD) e código do fornecedor (CODPRDFORNECEDOR),
 * bem como a unidade do produto no fornecedor (TUNDPRDCFOCOLAB).
 *
 * @param {{
 *   idPrd: string|number,
 *   codPrdFornecedor: string|number,
 *   codCfo: string|number,
 *   codUnd?: string|number,
 *   codUndCfo?: string|number,
 *   codColigada?: number,
 *   codColcfo?: number,
 *   codColPrd?: number,
 * }} params
 */
async function salvarVinculoProduto(params) {
  if (!DATA_SERVER_URL) {
    throw new Error('Variável de ambiente TOTVS_DSURL não configurada.');
  }

  const {
    idPrd,
    codPrdFornecedor,
    codCfo,
    codUnd,
    codUndCfo,
    codColigada = 1,
    codColcfo = 0,
    codColPrd = codColigada,
  } = params;

  const xmlInner = `
<EstPrdCfoTOTVSColaboracaoData>
  <TPRDCFOCOLAB>
    <CODCOLIGADA>${codColigada}</CODCOLIGADA>
    <IDPRD>${idPrd}</IDPRD>
    <CODCOLCFO>${codColcfo}</CODCOLCFO>
    <CODCFO>${codCfo}</CODCFO>
    <CODPRDFORNECEDOR>${codPrdFornecedor}</CODPRDFORNECEDOR>
  </TPRDCFOCOLAB>
  <TUNDPRDCFOCOLAB>
    <CODCOLPRD>${codColPrd}</CODCOLPRD>
    <IDPRD>${idPrd}</IDPRD>
    <CODCOLCFO>${codColcfo}</CODCOLCFO>
    <CODCFO>${codCfo}</CODCFO>
    <CODPRDFORNECEDOR>${codPrdFornecedor}</CODPRDFORNECEDOR>
    <CODUND>${codUnd ?? ''}</CODUND>
    <CODUNDCFO>${codUndCfo ?? ''}</CODUNDCFO>
  </TUNDPRDCFOCOLAB>
</EstPrdCfoTOTVSColaboracaoData>`.trim();

  const soapEnvelope = `
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
  <soap:Header/>
  <soap:Body>
    <tot:SaveRecord>
      <tot:DataServerName>EstPrdCfoTOTVSColaboracaoData</tot:DataServerName>
      <tot:XML><![CDATA[${xmlInner}]]></tot:XML>
      <tot:Contexto>CODCOLIGADA=${codColigada}</tot:Contexto>
    </tot:SaveRecord>
  </soap:Body>
</soap:Envelope>`.trim();

  // Log no console: XML completo enviado ao DataServer (envelope SOAP)
  console.log('--- DataServer EstPrdCfo - XML enviado em', new Date().toISOString(), '---');
  console.log(soapEnvelope);
  console.log('--- fim XML ---');

  // Autenticação: Basic preemptive (header Authorization na 1ª requisição), igual SOAP UI.
  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
    SOAPAction: '"http://www.totvs.com/IwsDataServer/SaveRecord"',
    ...getBasicAuthHeader(),
  };

  console.log('DataServer EstPrdCfo - POST URL:', DATA_SERVER_URL);

  const response = await axios.post(DATA_SERVER_URL, soapEnvelope, {
    headers,
    timeout: 60000,
    httpsAgent,
    responseType: 'text',
    validateStatus: () => true,
  });

  const status = response?.status;
  const xml = response?.data;

  if (status !== 200 && status !== 201) {
    const preview = typeof xml === 'string' ? xml.slice(0, 500) : String(xml);
    console.error('DataServer EstPrdCfo - Resposta HTTP:', status, preview);
    throw new Error(
      `DataServer retornou HTTP ${status}. ${status === 401 ? 'Verifique usuário/senha (Basic auth).' : ''} ${preview}`,
    );
  }

  if (!xml) {
    throw new Error('Resposta vazia do DataServer TOTVS.');
  }

  let envelope;
  try {
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    envelope = parsed?.['s:Envelope'] || parsed?.['soap:Envelope'] || parsed?.Envelope || parsed;
  } catch (err) {
    throw new Error(`Erro ao parsear resposta do DataServer: ${err.message}`);
  }

  const body = envelope?.['s:Body'] || envelope?.['soap:Body'] || envelope?.Body || {};
  const fault = body['s:Fault'] || body['soap:Fault'] || body.Fault;
  if (fault) {
    const reason = fault.faultstring || fault.Reason || fault;
    const msg =
      typeof reason === 'string'
        ? reason
        : reason?._ || reason?.$ || JSON.stringify(reason);
    throw new Error(msg || 'Erro retornado pelo DataServer TOTVS');
  }

  // Tenta localizar o nó SaveRecordResult (pode vir com namespace diferente)
  let resultado = '';
  const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : [];
  const respKey = bodyKeys.find((k) => k.toLowerCase().includes('saverecordresponse'));
  const respNode = respKey ? body[respKey] : null;
  if (respNode && typeof respNode === 'object') {
    const respNodeKeys = Object.keys(respNode);
    const resultKey = respNodeKeys.find((k) => k.toLowerCase().includes('saverecordresult'));
    if (resultKey) {
      const raw = respNode[resultKey];
      if (typeof raw === 'string') {
        resultado = raw.trim();
      } else if (raw != null) {
        resultado = JSON.stringify(raw);
      }
    }
  }

  // Log do retorno bruto do DataServer (útil p/ depuração)
  console.log(
    'DataServer EstPrdCfo - SaveRecordResult:',
    new Date().toISOString(),
    '-',
    resultado || '<vazio>',
  );

  return { sucesso: true, resultado };
}

module.exports = {
  salvarVinculoProduto,
};


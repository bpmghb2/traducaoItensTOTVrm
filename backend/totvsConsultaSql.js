const https = require('https');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const { decode } = require('html-entities');

const { TOTVS_WSURL, TOTVS_USER, TOTVS_PASS } = process.env;
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Envia envelope SOAP ao TOTVS, parseia a resposta e retorna { sucesso, dados, erro? }.
 * @param {string} soapEnvelope - XML do envelope SOAP
 * @returns {Promise<{ sucesso: boolean, dados: Array, erro?: string }>}
 */
async function chamarTOTVSeParse(soapEnvelope) {
  const response = await axios.post(TOTVS_WSURL, soapEnvelope, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL',
    },
    auth: TOTVS_USER && TOTVS_PASS ? { username: TOTVS_USER, password: TOTVS_PASS } : undefined,
    timeout: 60000,
    httpsAgent,
    responseType: 'text',
    validateStatus: () => true,
  });

  const xml = response?.data;
  if (!xml) {
    return { sucesso: true, dados: [] };
  }

  let envelope;
  try {
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    envelope = parsed?.['s:Envelope'] || parsed?.['soap:Envelope'] || parsed?.Envelope || parsed;
  } catch (err) {
    console.error('Erro ao parsear XML externo:', err.message);
    return { sucesso: false, dados: [], erro: err.message };
  }

  const body = envelope?.['s:Body'] || envelope?.['soapenv:Body'] || envelope?.Body || {};
  const fault = body['s:Fault'] || body['soapenv:Fault'] || body.Fault;
  if (fault) {
    const reason = fault.Reason?.['s:Text'] || fault.Reason?.['soapenv:Text'] || fault.faultstring || fault.Reason || fault;
    const msg = typeof reason === 'string' ? reason : (reason?._ || reason?.$ || JSON.stringify(reason));
    console.error('TOTVS SOAP Fault:', msg);
    throw new Error(msg || 'Erro retornado pelo TOTVS');
  }

  const cdataRaw =
    body['RealizarConsultaSQLResponse']?.['RealizarConsultaSQLResult'] ||
    envelope?.['s:Body']?.['RealizarConsultaSQLResponse']?.['RealizarConsultaSQLResult'] ||
    envelope?.['soapenv:Body']?.['RealizarConsultaSQLResponse']?.['RealizarConsultaSQLResult'] ||
    envelope?.Body?.RealizarConsultaSQLResponse?.RealizarConsultaSQLResult;

  if (!cdataRaw) {
    return { sucesso: true, dados: [] };
  }

  const cdataXml = decode(cdataRaw);
  let parsedCdata;
  try {
    parsedCdata = await parseStringPromise(cdataXml, { explicitArray: false });
  } catch (err) {
    console.error('Erro ao parsear XML interno (CDATA):', err.message);
    return { sucesso: false, dados: [], erro: err.message };
  }

  const resultados = parsedCdata?.NewDataSet?.Resultado;
  const dados = Array.isArray(resultados) ? resultados : resultados ? [resultados] : [];
  return { sucesso: true, dados };
}

module.exports = {
  chamarTOTVSeParse,
};

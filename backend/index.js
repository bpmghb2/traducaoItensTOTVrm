const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

// Fallback: carrega .env manualmente se variáveis não foram definidas (ex.: BOM/encoding no Windows)
if (!process.env.TOTVS_WSURL && fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  raw.split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) {
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const express = require('express');
const cors = require('cors');
const { consultarFornecedorPorCnpj } = require('./consultaFornecedorPorCnpj');
const { consultarProdutosFornecedorPorCnpj } = require('./consultaProdutosFornecedorPorCnpj');
const { consultarPorChave } = require('./consultaPorChave');
const { salvarVinculoProduto } = require('./dataServerEstPrdCfo');

const app = express();
app.use(cors());
app.use(express.json());

// Rota: consulta BPM.SUP.006 por CNPJ (P_CNPJ)
app.post('/consultaFornecedorPorCnpj', async (req, res) => {
  const { cnpj } = req.body || {};

  if (!cnpj) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetro "cnpj" é obrigatório no corpo da requisição.',
    });
  }

  try {
    const resultado = await consultarFornecedorPorCnpj(cnpj);
    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro na consulta TOTVS:', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Falha ao chamar o WebService TOTVS.',
    });
  }
});

// Rota: consulta BPM.SUP.008.3 por CNPJ (P_CNPJ) - produtos x código do fornecedor
app.post('/consultaProdutosFornecedorPorCnpj', async (req, res) => {
  const { cnpj } = req.body || {};

  if (!cnpj) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetro "cnpj" é obrigatório no corpo da requisição.',
    });
  }

  try {
    const resultado = await consultarProdutosFornecedorPorCnpj(cnpj);
    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro na consulta TOTVS (produtos por CNPJ):', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Falha ao chamar o WebService TOTVS (BPM.SUP.008.3).',
    });
  }
});

// Rota: consulta BPM.SUP.007 por chave (P_CHAVE)
app.post('/consultaPorChave', async (req, res) => {
  const { chave } = req.body || {};

  if (!chave) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetro "chave" é obrigatório no corpo da requisição.',
    });
  }

  try {
    const resultado = await consultarPorChave(chave);
    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro na consulta TOTVS (por chave):', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Falha ao chamar o WebService TOTVS.',
    });
  }
});

// Rota: grava vínculos pendentes (itens em alaranjado) via DataServer EstPrdCfoTOTVSColaboracaoData
app.post('/traduzirVinculos', async (req, res) => {
  const { codCfo, vinculos } = req.body || {};

  if (!codCfo || !Array.isArray(vinculos) || vinculos.length === 0) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Parâmetros inválidos: é necessário informar "codCfo" e uma lista de "vinculos".',
    });
  }

  try {
    const resultados = await Promise.all(
      vinculos.map(async (v) => {
        const { idPrd, codPrdFornecedor, codUnd, codUndCfo } = v;
        if (!idPrd || !codPrdFornecedor) {
          return { sucesso: false, erro: 'Vínculo sem IDPRD ou CODPRDFORNECEDOR.' };
        }
        const resp = await salvarVinculoProduto({ idPrd, codPrdFornecedor, codCfo, codUnd, codUndCfo });
        return { sucesso: resp?.sucesso !== false, resultado: resp?.resultado || '' };
      }),
    );

    const falhas = resultados.filter((r) => !r.sucesso);
    if (falhas.length) {
      return res.status(207).json({
        sucesso: false,
        erro: `Alguns vínculos falharam (${falhas.length}/${resultados.length}).`,
      });
    }

    return res.status(200).json({
      sucesso: true,
      quantidade: resultados.length,
      mensagem: `Foram enviados ${resultados.length} vínculos para tradução.`,
      resultados,
    });
  } catch (error) {
    console.error('Erro ao salvar vínculos no DataServer:', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Falha ao chamar o DataServer TOTVS.',
    });
  }
});

const PORT = process.env.PORT || 4006;
app.listen(PORT, () => {
  console.log(`Backend ouvindo na porta ${PORT}`);
});

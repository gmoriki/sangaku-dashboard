/**
 * 産学連携ダッシュボード — Node.js / Express サーバー
 * Usage: npm install && npm start
 *        → http://localhost:8000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8000;

// CORS（開発用：全オリジン許可）
app.use(cors());

// ============================================================================
// データ読み込み
// ============================================================================

const DATA_PATH = path.join(__dirname, 'backend', 'data', 'dashboard_data.json');

let DATA = null;

function loadData() {
  console.log(`📂 データ読み込み中: ${DATA_PATH}`);
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  DATA = JSON.parse(raw);
  console.log(`✅ データ読み込み完了 — ${DATA.universities.length} 大学, ${DATA.metadata.kpis.length} KPI`);
}

// ============================================================================
// ヘルパー関数（data_loader.py の移植）
// ============================================================================

function getMetadata() {
  return DATA.metadata;
}

function getNationalData(kpiList) {
  if (!kpiList) return DATA.national;
  const result = {};
  for (const kpi of kpiList) {
    if (DATA.national[kpi] !== undefined) {
      result[kpi] = DATA.national[kpi];
    }
  }
  return result;
}

function getByTypeData(kpiList, typeFilter) {
  const result = {};
  const types = typeFilter ? [typeFilter] : Object.keys(DATA.by_type);
  for (const t of types) {
    if (!DATA.by_type[t]) continue;
    if (!kpiList) {
      result[t] = DATA.by_type[t];
    } else {
      result[t] = {};
      for (const kpi of kpiList) {
        if (DATA.by_type[t][kpi] !== undefined) {
          result[t][kpi] = DATA.by_type[t][kpi];
        }
      }
    }
  }
  return result;
}

function getByPrefectureData(kpiList, prefFilter) {
  const result = {};
  const prefs = prefFilter ? [prefFilter] : Object.keys(DATA.by_prefecture);
  for (const p of prefs) {
    if (!DATA.by_prefecture[p]) continue;
    if (!kpiList) {
      result[p] = DATA.by_prefecture[p];
    } else {
      result[p] = {};
      for (const kpi of kpiList) {
        if (DATA.by_prefecture[p][kpi] !== undefined) {
          result[p][kpi] = DATA.by_prefecture[p][kpi];
        }
      }
    }
  }
  return result;
}

function getUniversities({ typeFilter, prefFilter, search, kpiSort, sortDir = 'desc', limit = 50, offset = 0 }) {
  let filtered = DATA.universities;

  if (typeFilter) {
    filtered = filtered.filter(u => u.type === typeFilter);
  }
  if (prefFilter) {
    filtered = filtered.filter(u => u.prefecture === prefFilter);
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(u => u.name.toLowerCase().includes(s));
  }

  const totalCount = filtered.length;

  if (kpiSort) {
    filtered = [...filtered].sort((a, b) => {
      const aVals = (a.kpis && a.kpis[kpiSort]) || [];
      const bVals = (b.kpis && b.kpis[kpiSort]) || [];
      const aVal = aVals.length > 0 && aVals[aVals.length - 1] != null ? aVals[aVals.length - 1] : -Infinity;
      const bVal = bVals.length > 0 && bVals[bVals.length - 1] != null ? bVals[bVals.length - 1] : -Infinity;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  const paginated = filtered.slice(offset, offset + limit);
  return { universities: paginated, totalCount };
}

function getUniversity(code) {
  return DATA.universities.find(u => u.code === code) || null;
}

function getRanking({ kpi, yearIndex = 6, typeFilter, prefFilter, limit = 10 }) {
  let filtered = DATA.universities;

  if (typeFilter) filtered = filtered.filter(u => u.type === typeFilter);
  if (prefFilter) filtered = filtered.filter(u => u.prefecture === prefFilter);

  const ranking = [];
  for (const uni of filtered) {
    const vals = (uni.kpis && uni.kpis[kpi]) || [];
    if (vals.length > yearIndex && vals[yearIndex] != null) {
      ranking.push({
        name: uni.name,
        code: uni.code,
        type: uni.type,
        prefecture: uni.prefecture,
        value: vals[yearIndex],
      });
    }
  }

  ranking.sort((a, b) => b.value - a.value);
  return ranking.slice(0, limit);
}

function getRankingContext({ kpi, code, yearIndex = 6, range = 5 }) {
  const ranking = [];
  for (const uni of DATA.universities) {
    const vals = (uni.kpis && uni.kpis[kpi]) || [];
    if (vals.length > yearIndex && vals[yearIndex] != null) {
      ranking.push({ name: uni.name, code: uni.code, type: uni.type, prefecture: uni.prefecture, value: vals[yearIndex] });
    }
  }
  ranking.sort((a, b) => b.value - a.value);

  const targetIdx = ranking.findIndex(r => r.code === code);
  if (targetIdx === -1) return null;

  const start = Math.max(0, targetIdx - range);
  const end = Math.min(ranking.length, targetIdx + range + 1);
  return {
    total_ranked: ranking.length,
    target: { rank: targetIdx + 1, ...ranking[targetIdx] },
    context: ranking.slice(start, end).map((r, i) => ({ rank: start + i + 1, ...r, is_target: r.code === code })),
  };
}

function getUniversityRanks({ code, kpiList, yearIndex = 6 }) {
  const ranks = {};
  for (const kpi of kpiList) {
    const ranking = [];
    for (const uni of DATA.universities) {
      const vals = (uni.kpis && uni.kpis[kpi]) || [];
      if (vals.length > yearIndex && vals[yearIndex] != null) {
        ranking.push({ code: uni.code, value: vals[yearIndex] });
      }
    }
    ranking.sort((a, b) => b.value - a.value);
    const idx = ranking.findIndex(r => r.code === code);
    if (idx !== -1) {
      ranks[kpi] = { rank: idx + 1, total: ranking.length, value: ranking[idx].value };
    }
  }
  return ranks;
}

function getMultiUniversities({ codes, kpiList, yearIndex = 6 }) {
  const unis = codes.map(c => DATA.universities.find(u => u.code === c)).filter(Boolean);
  if (!kpiList || kpiList.length === 0) {
    return unis.map(u => ({ name: u.name, code: u.code, type: u.type, prefecture: u.prefecture, kpis: u.kpis }));
  }
  // Compute percentiles for requested KPIs
  const allVals = {};
  for (const kpi of kpiList) {
    const vals = [];
    for (const uni of DATA.universities) {
      const v = (uni.kpis && uni.kpis[kpi]) || [];
      if (v.length > yearIndex && v[yearIndex] != null) vals.push(v[yearIndex]);
    }
    vals.sort((a, b) => a - b);
    allVals[kpi] = vals;
  }

  return unis.map(u => {
    const percentiles = {};
    for (const kpi of kpiList) {
      const v = (u.kpis && u.kpis[kpi]) || [];
      const val = v.length > yearIndex ? v[yearIndex] : null;
      if (val != null) {
        const sorted = allVals[kpi];
        const below = sorted.filter(x => x < val).length;
        percentiles[kpi] = Math.round((below / sorted.length) * 1000) / 10;
      } else {
        percentiles[kpi] = null;
      }
    }
    return { name: u.name, code: u.code, type: u.type, prefecture: u.prefecture, kpis: u.kpis, percentiles };
  });
}

// ============================================================================
// KPI バリデーション
// ============================================================================

function parseKpis(kpisStr) {
  if (!kpisStr) return null;
  return kpisStr.split(',').map(k => k.trim());
}

function validateKpi(kpi, res) {
  if (kpi && !DATA.metadata.kpis.includes(kpi)) {
    res.status(400).json({ detail: `Unknown KPI: ${kpi}` });
    return false;
  }
  return true;
}

function validateType(type, res) {
  if (type && !DATA.metadata.establishment_types.includes(type)) {
    res.status(400).json({ detail: `Unknown establishment type: ${type}` });
    return false;
  }
  return true;
}

function validatePrefecture(pref, res) {
  if (pref && !DATA.metadata.prefectures.includes(pref)) {
    res.status(400).json({ detail: `Unknown prefecture: ${pref}` });
    return false;
  }
  return true;
}

function validateKpiList(kpiList, res) {
  if (!kpiList) return true;
  const valid = new Set(DATA.metadata.kpis);
  for (const kpi of kpiList) {
    if (!valid.has(kpi)) {
      res.status(400).json({ detail: `Unknown KPI: ${kpi}` });
      return false;
    }
  }
  return true;
}

// ============================================================================
// API エンドポイント
// ============================================================================

// メタデータ
app.get('/api/metadata', (req, res) => {
  const m = getMetadata();

  // 原則5: データ欠損マップを計算
  const dataAvailability = {};
  for (const kpi of m.kpis) {
    const national = DATA.national[kpi] || [];
    dataAvailability[kpi] = national.map(v => v !== null && v !== undefined && v !== 0);
  }

  res.json({
    years: m.years,
    kpis: m.kpis,
    kpi_categories: m.kpi_categories,
    categories_order: m.categories_order,
    prefectures: m.prefectures,
    establishment_types: m.establishment_types,
    university_count: m.university_count,
    data_availability: dataAvailability,
  });
});

// 全国集計（原則1: type/prefecture フィルタ対応）
app.get('/api/national', (req, res) => {
  const kpiList = parseKpis(req.query.kpis);
  if (!validateKpiList(kpiList, res)) return;
  const { type, prefecture } = req.query;
  if (!validateType(type, res)) return;
  if (!validatePrefecture(prefecture, res)) return;

  if (type || prefecture) {
    let unis = DATA.universities;
    if (type) unis = unis.filter(u => u.type === type);
    if (prefecture) unis = unis.filter(u => u.prefecture === prefecture);
    const kpis = kpiList || DATA.metadata.kpis;
    const result = {};
    for (const kpi of kpis) {
      result[kpi] = DATA.metadata.years.map((_, yi) =>
        unis.reduce((sum, u) => sum + ((u.kpis?.[kpi]?.[yi]) || 0), 0)
      );
    }
    return res.json({ years: DATA.metadata.years, data: result, filtered: true, filter_label: [type, prefecture].filter(Boolean).join(' / ') });
  }

  const data = getNationalData(kpiList);
  res.json({ years: DATA.metadata.years, data });
});

// 設置形態別
app.get('/api/by-type', (req, res) => {
  const kpiList = parseKpis(req.query.kpis);
  if (!validateKpiList(kpiList, res)) return;
  if (!validateType(req.query.type, res)) return;
  const data = getByTypeData(kpiList, req.query.type);
  res.json({
    years: DATA.metadata.years,
    types: Object.keys(data),
    data,
  });
});

// 都道府県別
app.get('/api/by-prefecture', (req, res) => {
  const kpiList = parseKpis(req.query.kpis);
  if (!validateKpiList(kpiList, res)) return;
  if (!validatePrefecture(req.query.prefecture, res)) return;
  const data = getByPrefectureData(kpiList, req.query.prefecture);
  res.json({
    years: DATA.metadata.years,
    prefectures: Object.keys(data),
    data,
  });
});

// 大学リスト
app.get('/api/universities', (req, res) => {
  const { type, prefecture, search, kpi, sort = 'desc' } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  if (!validateType(type, res)) return;
  if (!validatePrefecture(prefecture, res)) return;
  if (kpi && !validateKpi(kpi, res)) return;
  if (!['asc', 'desc'].includes(sort)) {
    return res.status(400).json({ detail: "sort must be 'asc' or 'desc'" });
  }

  const result = getUniversities({
    typeFilter: type,
    prefFilter: prefecture,
    search,
    kpiSort: kpi,
    sortDir: sort,
    limit,
    offset,
  });

  res.json({
    total_count: result.totalCount,
    limit,
    offset,
    universities: result.universities.map(u => ({
      name: u.name,
      code: u.code,
      type: u.type,
      prefecture: u.prefecture,
      kpis: u.kpis,
    })),
  });
});

// 大学詳細
app.get('/api/university/:code', (req, res) => {
  const uni = getUniversity(req.params.code);
  if (!uni) {
    return res.status(404).json({ detail: `University not found: ${req.params.code}` });
  }
  res.json({
    name: uni.name,
    code: uni.code,
    type: uni.type,
    prefecture: uni.prefecture,
    kpis: uni.kpis,
  });
});

// ランキング
app.get('/api/ranking', (req, res) => {
  const { kpi, type, prefecture } = req.query;
  const yearIndex = parseInt(req.query.year_index) || 6;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

  if (!kpi) {
    return res.status(400).json({ detail: 'kpi parameter is required' });
  }
  if (!validateKpi(kpi, res)) return;
  if (yearIndex < 0 || yearIndex >= DATA.metadata.years.length) {
    return res.status(400).json({ detail: `year_index must be between 0 and ${DATA.metadata.years.length - 1}` });
  }
  if (!validateType(type, res)) return;
  if (!validatePrefecture(prefecture, res)) return;

  const rankingData = getRanking({ kpi, yearIndex, typeFilter: type, prefFilter: prefecture, limit });

  res.json({
    kpi,
    year_index: yearIndex,
    year: DATA.metadata.years[yearIndex],
    type_filter: type || null,
    prefecture_filter: prefecture || null,
    ranking: rankingData.map((item, i) => ({
      rank: i + 1,
      ...item,
    })),
  });
});

// ランキングコンテキスト（±N校）
app.get('/api/ranking-context', (req, res) => {
  const { kpi, code } = req.query;
  const yearIndex = parseInt(req.query.year_index) || 6;
  const range = Math.min(Math.max(parseInt(req.query.range) || 5, 1), 20);

  if (!kpi) return res.status(400).json({ detail: 'kpi parameter is required' });
  if (!code) return res.status(400).json({ detail: 'code parameter is required' });
  if (!validateKpi(kpi, res)) return;

  const result = getRankingContext({ kpi, code, yearIndex, range });
  if (!result) return res.status(404).json({ detail: `University not found in ranking: ${code}` });

  res.json({ kpi, year_index: yearIndex, year: DATA.metadata.years[yearIndex], ...result });
});

// 大学別KPI順位一括取得
app.get('/api/university-ranks', (req, res) => {
  const { code } = req.query;
  const yearIndex = parseInt(req.query.year_index) || 6;
  const kpiList = parseKpis(req.query.kpis);

  if (!code) return res.status(400).json({ detail: 'code parameter is required' });
  if (!kpiList) return res.status(400).json({ detail: 'kpis parameter is required' });
  if (!validateKpiList(kpiList, res)) return;

  const uni = getUniversity(code);
  if (!uni) return res.status(404).json({ detail: `University not found: ${code}` });

  res.json({ code, year: DATA.metadata.years[yearIndex], ranks: getUniversityRanks({ code, kpiList, yearIndex }) });
});

// 複数大学一括取得（パーセンタイル付き）
app.get('/api/universities/multi', (req, res) => {
  const codesStr = req.query.codes;
  if (!codesStr) return res.status(400).json({ detail: 'codes parameter is required' });

  const codes = codesStr.split(',').map(c => c.trim()).slice(0, 4);
  const kpiList = parseKpis(req.query.kpis);
  const yearIndex = parseInt(req.query.year_index) || 6;
  if (kpiList && !validateKpiList(kpiList, res)) return;

  const results = getMultiUniversities({ codes, kpiList, yearIndex });
  res.json({ universities: results });
});

// P1-1: ピアグループ
app.get('/api/peer-group', (req, res) => {
  const { code, kpi, range = '0.5', group } = req.query;
  const yearIndex = parseInt(req.query.year_index) || 6;

  // プリセットグループ
  const PRESETS = {
    '旧帝大': ['東京大学','京都大学','大阪大学','東北大学','北海道大学','九州大学','名古屋大学'],
    'RU11': ['東京大学','京都大学','大阪大学','東北大学','北海道大学','九州大学','名古屋大学','早稲田大学','慶應義塾大学','筑波大学','東京工業大学'],
  };

  let peers;
  if (group && PRESETS[group]) {
    const names = new Set(PRESETS[group]);
    peers = DATA.universities.filter(u => names.has(u.name));
  } else if (group === '同設置区分') {
    const target = DATA.universities.find(u => u.code === code);
    if (!target) return res.status(404).json({ detail: 'University not found' });
    peers = DATA.universities.filter(u => u.type === target.type);
  } else if (group === '同地域') {
    const target = DATA.universities.find(u => u.code === code);
    if (!target) return res.status(404).json({ detail: 'University not found' });
    peers = DATA.universities.filter(u => u.prefecture === target.prefecture);
  } else if (kpi && code) {
    // 動的: KPI値の ±range 範囲
    if (!validateKpi(kpi, res)) return;
    const target = DATA.universities.find(u => u.code === code);
    if (!target) return res.status(404).json({ detail: 'University not found' });
    const targetVal = (target.kpis?.[kpi] || [])[yearIndex];
    if (targetVal == null) return res.json({ peers: [], avg: {} });
    const r = parseFloat(range);
    peers = DATA.universities.filter(u => {
      const v = (u.kpis?.[kpi] || [])[yearIndex];
      return v != null && v >= targetVal * (1 - r) && v <= targetVal * (1 + r);
    });
  } else {
    return res.status(400).json({ detail: 'group or (kpi + code) required' });
  }

  // ピアグループの平均を計算
  const allKpis = DATA.metadata.kpis;
  const avg = {};
  for (const k of allKpis) {
    avg[k] = DATA.metadata.years.map((_, yi) => {
      const vals = peers.map(u => (u.kpis?.[k] || [])[yi]).filter(v => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
  }

  res.json({
    count: peers.length,
    names: peers.map(u => u.name).slice(0, 50),
    avg,
  });
});

// P1-2/P2-3: 正規化・加工済み指標
app.get('/api/derived-kpis', (req, res) => {
  const { code } = req.query;
  const yearIndex = parseInt(req.query.year_index) || 6;
  if (!code) return res.status(400).json({ detail: 'code required' });
  const uni = getUniversity(code);
  if (!uni) return res.status(404).json({ detail: 'University not found' });

  const kpis = uni.kpis || {};
  const get = (k, yi) => (kpis[k] || [])[yi] ?? null;
  const safe_div = (a, b) => (a != null && b != null && b > 0) ? a / b : null;

  const derived = {};
  DATA.metadata.years.forEach((_, yi) => {
    derived[yi] = {
      '共同研究_1件あたり受入額': safe_div(get('共同研究_受入額', yi), get('共同研究_件数', yi)),
      '共同研究_大企業比率': safe_div(get('共同研究_件数_大企業', yi), get('共同研究_件数', yi)),
      '共同研究_直接経費率': safe_div(get('共同研究_直接経費', yi), get('共同研究_受入額', yi)),
      '受託研究_1件あたり受入額': safe_div(get('受託研究_受入額', yi), get('受託研究_件数', yi)),
      '知財_実施許諾率': safe_div(get('特許保有_国内_実施許諾中', yi), get('特許保有_国内', yi)),
      '知財_1件あたり収入': safe_div(get('実施許諾収入_国内', yi), get('実施許諾_国内_権利数', yi)),
      '発明_出願率': safe_div(get('発明_特許出願件数', yi), get('発明届出件数', yi)),
    };
  });

  res.json({ code, derived });
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ============================================================================
// フロントエンド静的ファイル配信
// ============================================================================

const FRONTEND_DIR = path.join(__dirname, 'frontend', 'dist');

if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  // SPA: 未知のルートはindex.htmlを返す
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

// ============================================================================
// 起動
// ============================================================================

loadData();

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 産学連携ダッシュボード起動完了');
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   Ctrl+C で停止`);
  console.log('');
});

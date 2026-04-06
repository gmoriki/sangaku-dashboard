// Cloudflare Pages Worker — API endpoints for 産学連携ダッシュボード
let DATA = null;

async function loadData(env, request) {
  if (DATA) return DATA;
  const url = new URL('/data.json', request.url);
  const res = await env.ASSETS.fetch(url);
  DATA = await res.json();
  return DATA;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function parseKpis(str) {
  return str ? str.split(',').map(k => decodeURIComponent(k.trim())) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Static assets
    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const data = await loadData(env, request);
    const params = url.searchParams;

    // /api/metadata
    if (path === '/api/metadata') {
      const m = data.metadata;
      const dataAvailability = {};
      for (const kpi of m.kpis) {
        const national = data.national[kpi] || [];
        dataAvailability[kpi] = national.map(v => v !== null && v !== undefined && v !== 0);
      }
      return jsonResponse({ years: m.years, kpis: m.kpis, kpi_categories: m.kpi_categories, categories_order: m.categories_order, prefectures: m.prefectures, establishment_types: m.establishment_types, university_count: m.university_count, data_availability: dataAvailability });
    }

    // /api/national
    if (path === '/api/national') {
      const kpiList = parseKpis(params.get('kpis'));
      const type = params.get('type');
      const prefecture = params.get('prefecture');

      if (type || prefecture) {
        let unis = data.universities;
        if (type) unis = unis.filter(u => u.type === type);
        if (prefecture) unis = unis.filter(u => u.prefecture === prefecture);
        const kpis = kpiList || data.metadata.kpis;
        const result = {};
        for (const kpi of kpis) {
          result[kpi] = data.metadata.years.map((_, yi) =>
            unis.reduce((sum, u) => sum + ((u.kpis?.[kpi]?.[yi]) || 0), 0)
          );
        }
        return jsonResponse({ years: data.metadata.years, data: result, filtered: true });
      }

      const natData = {};
      const kpis = kpiList || data.metadata.kpis;
      for (const kpi of kpis) {
        if (data.national[kpi] !== undefined) natData[kpi] = data.national[kpi];
      }

      // mode=avg: 報告機関数で割った平均値
      if (params.get('mode') === 'avg') {
        const avgData = {};
        for (const kpi of kpis) {
          const nat = natData[kpi] || data.national[kpi] || [];
          avgData[kpi] = data.metadata.years.map((_, yi) => {
            if (nat[yi] == null) return null;
            let count = 0;
            for (const uni of data.universities) {
              const v = (uni.kpis?.[kpi] || [])[yi];
              if (v != null) count++;
            }
            return count > 0 ? nat[yi] / count : null;
          });
        }
        return jsonResponse({ years: data.metadata.years, data: avgData, mode: 'avg' });
      }

      return jsonResponse({ years: data.metadata.years, data: kpiList ? natData : data.national });
    }

    // /api/by-type
    if (path === '/api/by-type') {
      const kpiList = parseKpis(params.get('kpis'));
      const typeFilter = params.get('type');
      const result = {};
      const types = typeFilter ? [typeFilter] : Object.keys(data.by_type);
      for (const t of types) {
        if (!data.by_type[t]) continue;
        if (!kpiList) { result[t] = data.by_type[t]; } else {
          result[t] = {};
          for (const kpi of kpiList) { if (data.by_type[t][kpi] !== undefined) result[t][kpi] = data.by_type[t][kpi]; }
        }
      }
      return jsonResponse({ years: data.metadata.years, types: Object.keys(result), data: result });
    }

    // /api/universities
    if (path === '/api/universities') {
      const type = params.get('type');
      const prefecture = params.get('prefecture');
      const search = params.get('search');
      const kpi = params.get('kpi');
      const sort = params.get('sort') || 'desc';
      const limit = Math.min(Math.max(parseInt(params.get('limit')) || 50, 1), 1000);
      const offset = Math.max(parseInt(params.get('offset')) || 0, 0);

      let filtered = data.universities;
      if (type) filtered = filtered.filter(u => u.type === type);
      if (prefecture) filtered = filtered.filter(u => u.prefecture === prefecture);
      if (search) { const s = search.toLowerCase(); filtered = filtered.filter(u => u.name.toLowerCase().includes(s)); }

      const totalCount = filtered.length;
      if (kpi) {
        filtered = [...filtered].sort((a, b) => {
          const aV = (a.kpis?.[kpi] || []).at(-1) ?? -Infinity;
          const bV = (b.kpis?.[kpi] || []).at(-1) ?? -Infinity;
          return sort === 'asc' ? aV - bV : bV - aV;
        });
      }

      return jsonResponse({
        total_count: totalCount, limit, offset,
        universities: filtered.slice(offset, offset + limit).map(u => ({ name: u.name, code: u.code, type: u.type, prefecture: u.prefecture, kpis: u.kpis })),
      });
    }

    // /api/university/:code
    if (path.startsWith('/api/university/')) {
      const code = decodeURIComponent(path.split('/api/university/')[1]);
      const uni = data.universities.find(u => u.code === code);
      if (!uni) return jsonResponse({ detail: 'Not found' }, 404);
      return jsonResponse({ name: uni.name, code: uni.code, type: uni.type, prefecture: uni.prefecture, kpis: uni.kpis });
    }

    // /api/ranking
    if (path === '/api/ranking') {
      const kpi = decodeURIComponent(params.get('kpi'));
      const yearIndex = parseInt(params.get('year_index')) || 6;
      const limit = Math.min(parseInt(params.get('limit')) || 10, 100);
      const type = params.get('type');
      const prefecture = params.get('prefecture');

      let filtered = data.universities;
      if (type) filtered = filtered.filter(u => u.type === type);
      if (prefecture) filtered = filtered.filter(u => u.prefecture === prefecture);

      const ranking = [];
      for (const uni of filtered) {
        const vals = uni.kpis?.[kpi] || [];
        if (vals.length > yearIndex && vals[yearIndex] != null && vals[yearIndex] > 0) {
          ranking.push({ name: uni.name, code: uni.code, type: uni.type, prefecture: uni.prefecture, value: vals[yearIndex] });
        }
      }
      ranking.sort((a, b) => b.value - a.value);
      return jsonResponse({ kpi, year_index: yearIndex, year: data.metadata.years[yearIndex], ranking: ranking.slice(0, limit).map((item, i) => ({ rank: i + 1, ...item })) });
    }

    // /api/ranking-context
    if (path === '/api/ranking-context') {
      const kpi = decodeURIComponent(params.get('kpi'));
      const code = params.get('code');
      const yearIndex = parseInt(params.get('year_index')) || 6;
      const range = parseInt(params.get('range')) || 5;

      const ranking = [];
      for (const uni of data.universities) {
        const vals = uni.kpis?.[kpi] || [];
        if (vals.length > yearIndex && vals[yearIndex] != null && vals[yearIndex] > 0) {
          ranking.push({ name: uni.name, code: uni.code, type: uni.type, prefecture: uni.prefecture, value: vals[yearIndex] });
        }
      }
      ranking.sort((a, b) => b.value - a.value);
      const targetIdx = ranking.findIndex(r => r.code === code);
      if (targetIdx === -1) return jsonResponse({ detail: 'Not found' }, 404);

      const start = Math.max(0, targetIdx - range);
      const end = Math.min(ranking.length, targetIdx + range + 1);
      return jsonResponse({
        kpi, year_index: yearIndex, year: data.metadata.years[yearIndex],
        total_ranked: ranking.length,
        target: { rank: targetIdx + 1, ...ranking[targetIdx] },
        context: ranking.slice(start, end).map((r, i) => ({ rank: start + i + 1, ...r, is_target: r.code === code })),
      });
    }

    // /api/university-ranks
    if (path === '/api/university-ranks') {
      const code = params.get('code');
      const kpiList = parseKpis(params.get('kpis'));
      const yearIndex = parseInt(params.get('year_index')) || 6;

      const ranks = {};
      for (const kpi of (kpiList || [])) {
        const ranking = [];
        for (const uni of data.universities) {
          const vals = uni.kpis?.[kpi] || [];
          if (vals.length > yearIndex && vals[yearIndex] != null && vals[yearIndex] > 0) ranking.push({ code: uni.code, value: vals[yearIndex] });
        }
        ranking.sort((a, b) => b.value - a.value);
        const idx = ranking.findIndex(r => r.code === code);
        if (idx !== -1) ranks[kpi] = { rank: idx + 1, total: ranking.length, value: ranking[idx].value };
      }
      return jsonResponse({ code, year: data.metadata.years[yearIndex], ranks });
    }

    // /api/universities/multi
    if (path === '/api/universities/multi') {
      const codes = (params.get('codes') || '').split(',').slice(0, 4);
      const kpiList = parseKpis(params.get('kpis'));
      const yearIndex = parseInt(params.get('year_index')) || 6;

      const unis = codes.map(c => data.universities.find(u => u.code === c)).filter(Boolean);
      if (!kpiList || kpiList.length === 0) {
        return jsonResponse({ universities: unis.map(u => ({ name: u.name, code: u.code, type: u.type, prefecture: u.prefecture, kpis: u.kpis })) });
      }

      const allVals = {};
      for (const kpi of kpiList) {
        const vals = [];
        for (const uni of data.universities) {
          const v = uni.kpis?.[kpi] || [];
          if (v.length > yearIndex && v[yearIndex] != null) vals.push(v[yearIndex]);
        }
        vals.sort((a, b) => a - b);
        allVals[kpi] = vals;
      }

      return jsonResponse({
        universities: unis.map(u => {
          const percentiles = {};
          for (const kpi of kpiList) {
            const v = (u.kpis?.[kpi] || [])[yearIndex];
            if (v != null) {
              const sorted = allVals[kpi];
              const below = sorted.filter(x => x < v).length;
              percentiles[kpi] = Math.round((below / sorted.length) * 1000) / 10;
            } else {
              percentiles[kpi] = null;
            }
          }
          return { name: u.name, code: u.code, type: u.type, prefecture: u.prefecture, kpis: u.kpis, percentiles };
        }),
      });
    }

    // /health
    if (path === '/health') return jsonResponse({ status: 'healthy' });

    // Fallback
    return env.ASSETS.fetch(request);
  },
};

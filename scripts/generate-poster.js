/**
 * 성동자이리버뷰 온열질환 예방 포스터 자동 생성
 * POSTER_TYPE=daily   → 당일 체감온도 스냅샷 (09시/14시)
 * POSTER_TYPE=forecast → 내일 예보 포스터   (22시)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont, loadImage } = require('canvas');

// ── 폰트 등록 (개별 처리 + 폴백) ──
const NANUM_DIR = '/usr/share/fonts/truetype/nanum';
function tryRegister(file, opts) {
  try { registerFont(file, opts); return true; }
  catch(e) { return false; }
}
tryRegister(`${NANUM_DIR}/NanumGothic.ttf`,     { family:'Nanum', weight:'normal' });
tryRegister(`${NANUM_DIR}/NanumGothicBold.ttf`, { family:'Nanum', weight:'bold' });
// ExtraBold(900)는 환경에 없을 수 있으므로, 없으면 Bold 파일을 900으로 대체 등록
if (!tryRegister(`${NANUM_DIR}/NanumGothicExtraBold.ttf`, { family:'Nanum', weight:'900' })) {
  tryRegister(`${NANUM_DIR}/NanumGothicBold.ttf`, { family:'Nanum', weight:'900' });
}

// ── 환경변수 ──
const API_KEY    = process.env.KMA_API_KEY;
const NX         = process.env.GRID_NX || '61';
const NY         = process.env.GRID_NY || '127';
const AREA_NO    = process.env.AREA_NO || '1123060000'; // 동대문구 답십리제1동 (생활기상지수 지점코드, 격자 61/127)
const POSTER_TYPE = process.env.POSTER_TYPE || 'daily'; // 'daily' | 'forecast'

if (!API_KEY) { console.error('KMA_API_KEY 없음'); process.exit(1); }

// ── 공통 상수 ──
const SC     = ['#22c55e','#3b82f6','#f59e0b','#f97316','#ef4444'];
const SLABEL = ['정상','1단계 주의','2단계 경고','3단계 위험','4단계 전면중지'];
const PREVENT5 = [
  { tag:'물',       txt:'시원하고 깨끗한 물 충분히 제공' },
  { tag:'바람·그늘', txt:'실내외 작업 시 에어컨·선풍기 등 냉방장치 및 그늘막 설치' },
  { tag:'휴식',     txt:'체감온도 33°C 이상 폭염작업 시 매 2시간 이내 20분 이상 휴식' },
  { tag:'보냉장구', txt:'냉각의류·냉각조끼 등 개인 보냉장구 지급' },
  { tag:'응급조치', txt:'온열질환 의심자가 의식이 없는 경우 즉시 119 신고' },
];

const pad  = n => String(n).padStart(2,'0');
const kNow = () => new Date(Date.now() + 9*3600*1000); // KST

// 기상청 여름철 체감온도 공식 (2022.6.2~ 적용)
// Ta: 기온(°C), RH: 상대습도(%)
function heatIndex(Ta, RH) {
  // 습구온도 Tw (Stull 추정식)
  const Tw = Ta*Math.atan(0.151977*Math.sqrt(RH+8.313659))
    + Math.atan(Ta+RH)
    - Math.atan(RH-1.67633)
    + 0.00391838*Math.pow(RH,1.5)*Math.atan(0.023101*RH)
    - 4.686035;
  const feels = -0.2442 + 0.55399*Tw + 0.45535*Ta
    - 0.0022*Tw*Tw + 0.00278*Tw*Ta + 3.0;
  return Math.round(feels*10)/10;
}
function getStage(fl) {
  if (fl>=38) return 4; if (fl>=35) return 3;
  if (fl>=33) return 2; if (fl>=31) return 1; return 0;
}
function fmtDate(d) {
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth()+1)}.${pad(d.getUTCDate())}`;
}
function dateKey(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
}

// ── 기상청 생활기상지수: 건설현장(A48) 여름철 체감온도 ──
// 발표 06·18시, 발표시각 +1h~+78h 예측. 기상청 날씨누리 표시값과 동일.
const SENTA_AREA = AREA_NO;
function sentaHourOffset(baseYmdH, targetYmd, targetHour) {
  const by=+baseYmdH.slice(0,4), bm=+baseYmdH.slice(4,6), bd=+baseYmdH.slice(6,8), bh=+baseYmdH.slice(8,10);
  const ty=+targetYmd.slice(0,4), tm=+targetYmd.slice(4,6), td=+targetYmd.slice(6,8);
  return Math.round((Date.UTC(ty,tm-1,td,targetHour)-Date.UTC(by,bm-1,bd,bh))/3600000);
}
// 발표시각(time) 1건 조회 → { h1:..., h2:..., date } 형태로 반환
async function fetchSenTa(timeYmdH) {
  const url = `http://apis.data.go.kr/1360000/LivingWthrIdxServiceV2/getSenTaIdxV2`
    + `?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=10&pageNo=1&dataType=JSON`
    + `&areaNo=${SENTA_AREA}&time=${timeYmdH}&requestCode=A48`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error(`체감온도 JSON 파싱 실패 ${timeYmdH}`); }
  const item = data?.response?.body?.items?.item?.[0] || data?.response?.body?.items?.item;
  if (!item) {
    const code = data?.response?.header?.resultCode;
    throw new Error(`체감온도 없음 ${timeYmdH} (resultCode=${code})`);
  }
  return item; // { date, h1, h2, ... h78 }
}
// 대상일(targetYmd)의 fromH~toH시 체감온도 배열.
// 1차: 기상청 생활기상지수 A48 (날씨누리와 일치)
// 폴백: 단기예보 기온·습도로 직접 계산 (A48 API 키 미승인 등 실패 시)
async function fetchSenTaHours(targetYmd, fromH, toH) {
  const now = kNow();
  const today = dateKey(now);
  const yest  = dateKey(new Date(now.getTime()-86400000));
  const h = now.getUTCHours();
  const cands = [];
  if (h >= 18) cands.push(today+'18');
  if (h >= 6)  cands.push(today+'06');
  cands.push(yest+'18', yest+'06');
  let lastErr;
  for (const t of cands) {
    try {
      const item = await fetchSenTa(t);
      const out = [];
      for (let hh=fromH; hh<=toH; hh++) {
        const off = sentaHourOffset(t, targetYmd, hh);
        if (off>=1 && off<=78) {
          const v = item['h'+off];
          if (v!==undefined && v!==null && v!=='') out.push({ hour:hh, fl: parseInt(v) });
        }
      }
      if (out.length) { console.log(`체감온도(A48) 조회 성공: 발표 ${t}, ${out.length}개 시간대`); return out; }
    } catch(e) { lastErr = e; }
  }
  // ── 폴백: 단기예보 기온·습도로 계산 ──
  console.log(`A48 조회 실패(${lastErr?.message}) → 단기예보 폴백`);
  try {
    const items = await fetchForecastAuto();
    const T={}, RH={};
    items.forEach(i=>{ const k=i.fcstDate+i.fcstTime;
      if(i.category==='TMP') T[k]=parseFloat(i.fcstValue);
      if(i.category==='REH') RH[k]=parseFloat(i.fcstValue); });
    const out = [];
    for (let hh=fromH; hh<=toH; hh++) {
      const k=targetYmd+pad(hh)+'00';
      if(T[k]!==undefined && RH[k]!==undefined)
        out.push({ hour:hh, fl: Math.round(heatIndex(T[k],RH[k])) });
    }
    if (out.length) { console.log(`폴백 성공: ${out.length}개 시간대`); return out; }
  } catch(e2) { throw new Error(`A48 실패(${lastErr?.message}), 폴백도 실패(${e2.message})`); }
  throw lastErr || new Error('체감온도 조회 실패: 발표분 없음');
}
// 단일 시각(targetYmd targetHour)의 체감온도 1개
async function fetchSenTaOne(targetYmd, targetHour) {
  const arr = await fetchSenTaHours(targetYmd, targetHour, targetHour);
  if (!arr.length) throw new Error(`체감온도 없음 ${targetYmd} ${targetHour}시`);
  return arr[0].fl;
}

// ── canvas 헬퍼 ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// ── 기상청 초단기실황 API (실제 관측값 — 엑셀 기록과 동일 소스) ──
async function fetchNcst(baseDate, baseTime) {
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst`
    + `?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=60&pageNo=1&dataType=JSON`
    + `&base_date=${baseDate}&base_time=${baseTime}&nx=${NX}&ny=${NY}`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error(`실황 JSON 파싱 실패 ${baseDate} ${baseTime}`); }
  const items = data?.response?.body?.items?.item;
  if (!items) {
    const code = data?.response?.header?.resultCode;
    throw new Error(`실황 없음 ${baseDate} ${baseTime} (resultCode=${code})`);
  }
  const m = {};
  items.forEach(i => { m[i.category] = parseFloat(i.obsrValue); });
  if (m.T1H === undefined || m.REH === undefined) throw new Error(`기온/습도 항목 없음 ${baseTime}`);
  return { temp: m.T1H, humid: m.REH };
}

// 현재 시각 기준 최신 실황을 가져온다 (엑셀 record-data.js와 동일 로직).
// 실황은 매시 40분 이후 제공되므로, 분<40이면 한 시간 전 정시를 조회한다.
async function fetchNcstAuto() {
  const now = kNow();
  let obsHour = now.getUTCHours();
  if (now.getUTCMinutes() < 40) obsHour -= 1;
  const today = dateKey(now);
  const yest  = dateKey(new Date(now.getTime() - 86400000));
  // 자정 전후 보정: obsHour가 음수면 어제 23시
  const candidates = [];
  if (obsHour >= 0) candidates.push([today, pad(obsHour)+'00']);
  else candidates.push([yest, '2300']);
  // 혹시 실패하면 직전 정시들로 재시도
  for (let k=1; k<=3; k++) {
    let hh = (obsHour>=0?obsHour:23) - k;
    if (hh >= 0) candidates.push([today, pad(hh)+'00']);
    else candidates.push([yest, pad(24+hh)+'00']);
  }
  let lastErr;
  for (const [bd, bt] of candidates) {
    try {
      const r = await fetchNcst(bd, bt);
      console.log(`실황 조회 성공: ${bd} ${bt} → ${r.temp}°C ${r.humid}%`);
      return { ...r, obsTime: `${bt.slice(0,2)}:00` };
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('실황 조회 실패');
}

// ── 기상청 단기예보 API ──
async function fetchForecast(baseDate, baseTime) {
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst`
    + `?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=800&pageNo=1&dataType=JSON`
    + `&base_date=${baseDate}&base_time=${baseTime}&nx=${NX}&ny=${NY}`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error(`JSON 파싱 실패(${baseDate} ${baseTime}) — 응답이 JSON이 아님`); }
  const items = data?.response?.body?.items?.item;
  if (!items) {
    const code = data?.response?.header?.resultCode;
    const msg  = data?.response?.header?.resultMsg;
    throw new Error(`예보 데이터 없음(${baseDate} ${baseTime}) resultCode=${code} msg=${msg}`);
  }
  return items;
}

// 발표 시각(02,05,08,11,14,17,20,23)을 현재 KST 기준 최신순으로 시도.
// 해당 발표가 아직 안 나왔거나 응답이 비면 이전 발표분으로 자동 재시도한다.
async function fetchForecastAuto() {
  const now = kNow();
  const h = now.getUTCHours(); // kNow가 +9 보정했으므로 이게 곧 KST 시
  const slots = [23,20,17,14,11,8,5,2];
  const today = dateKey(now);
  const yest  = dateKey(new Date(now.getTime() - 86400000));
  const candidates = [];
  // 오늘 발표분 중 현재 시각 이전(+10분 여유 위해 같은 시각도 제외) 것
  for (const s of slots) if (h > s) candidates.push([today, pad(s)+'00']);
  // 어제 발표분 (새벽 대비)
  for (const s of slots) candidates.push([yest, pad(s)+'00']);
  let lastErr;
  for (const [bd, bt] of candidates) {
    try {
      const items = await fetchForecast(bd, bt);
      console.log(`예보 조회 성공: base ${bd} ${bt}`);
      return items;
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('예보 조회 실패: 시도할 발표시각 없음');
}

// ── 단기예보에서 하늘상태(SKY)·강수형태(PTY)·강수확률(POP) 시간별 추출 ──
async function fetchWeatherHours(targetYmd, fromH, toH) {
  const items = await fetchForecastAuto();
  const SKY = {}, PTY = {}, POP = {};
  items.forEach(i => {
    const k = i.fcstDate + i.fcstTime;
    if (i.category === 'SKY') SKY[k] = i.fcstValue;
    if (i.category === 'PTY') PTY[k] = i.fcstValue;
    if (i.category === 'POP') POP[k] = i.fcstValue;
  });
  const out = [];
  for (let hh = fromH; hh <= toH; hh++) {
    const k = targetYmd + pad(hh) + '00';
    out.push({
      hour: hh,
      sky: SKY[k] !== undefined ? +SKY[k] : null,
      pty: PTY[k] !== undefined ? +PTY[k] : 0,
      pop: POP[k] !== undefined ? +POP[k] : null,
    });
  }
  return out;
}
// SKY(1맑음/3구름많음/4흐림) + PTY(0없음/1비/2비눈/3눈/4소나기) → 아이콘 종류
function weatherIconType(sky, pty) {
  if (pty === 4) return 'shower';
  if (pty && pty !== 0) return (pty === 2 || pty === 3) ? 'snow' : 'rain';
  if (sky === 1) return 'sunny';
  if (sky === 3) return 'cloudy';
  return 'overcast';
}
const WICON_COLOR = { sunny:'#f59e0b', cloudy:'#94a3b8', overcast:'#64748b', rain:'#3b82f6', shower:'#0ea5e9', snow:'#38bdf8' };
const WICON_LABEL  = { sunny:'맑음',   cloudy:'구름많음', overcast:'흐림',   rain:'비',       shower:'소나기', snow:'눈' };
// 강수 시간대인지 (아이콘 아래 문구 표시 여부 판단용)
const IS_PRECIP = { rain:true, shower:true, snow:true };
// 하루 대표 날씨 요약 (헤더 배지용): 강수 있으면 강수 우선 표시, 없으면 정오 무렵 하늘상태
function summarizeWeather(weatherHours) {
  const maxPop = Math.max(0, ...weatherHours.map(h => h.pop || 0));
  const rain = weatherHours.filter(h => h.pty && h.pty !== 0);
  if (rain.length) {
    const worstPty = rain.reduce((w,h)=> h.pty>w?h.pty:w, 0);
    const type = weatherIconType(null, worstPty);
    return { type, label: WICON_LABEL[type], pop:maxPop };
  }
  const mid = weatherHours.find(h=>h.hour===13) || weatherHours.find(h=>h.hour===12) || weatherHours[Math.floor(weatherHours.length/2)] || {};
  const type = weatherIconType(mid.sky, 0);
  return { type, label: WICON_LABEL[type], pop:maxPop };
}
// 벡터 구름 실루엣
function drawCloudShape(ctx, ox, oy, r, color) {
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = color;
  const baseY = r*0.15;
  ctx.beginPath(); ctx.ellipse(0, baseY, r*0.95, r*0.42, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-r*0.45, baseY-r*0.15, r*0.4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, baseY-r*0.38, r*0.48, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(r*0.42, baseY-r*0.1, r*0.38, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}
// 날씨 아이콘 (맑음/구름많음/흐림/비/눈)
function drawWeatherIcon(ctx, type, cx, cy, r, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = color; ctx.strokeStyle = color;
  if (type === 'sunny') {
    ctx.beginPath(); ctx.arc(0,0,r*0.52,0,Math.PI*2); ctx.fill();
    ctx.lineWidth = Math.max(1.2, r*0.14); ctx.lineCap='round';
    for (let i=0;i<8;i++) {
      const a = i*Math.PI/4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*r*0.72, Math.sin(a)*r*0.72);
      ctx.lineTo(Math.cos(a)*r*1.08, Math.sin(a)*r*1.08);
      ctx.stroke();
    }
  } else if (type === 'cloudy') {
    ctx.beginPath(); ctx.arc(-r*0.35,-r*0.28,r*0.34,0,Math.PI*2); ctx.fill();
    drawCloudShape(ctx, r*0.12, r*0.18, r*0.88, color);
  } else if (type === 'overcast') {
    drawCloudShape(ctx, 0, 0, r, color);
  } else if (type === 'rain') {
    drawCloudShape(ctx, 0, -r*0.2, r*0.85, color);
    ctx.lineWidth = Math.max(1.4, r*0.15); ctx.lineCap='round';
    [-1,0,1].forEach(i=>{
      ctx.beginPath();
      ctx.moveTo(i*r*0.36, r*0.3);
      ctx.lineTo(i*r*0.36 - r*0.14, r*0.72);
      ctx.stroke();
    });
  } else if (type === 'shower') {
    // 소나기: 해가 살짝 보이는 비구름 (일반 비와 구분)
    ctx.beginPath(); ctx.arc(-r*0.42,-r*0.5,r*0.3,0,Math.PI*2); ctx.fill();
    ctx.lineWidth = Math.max(1, r*0.1); ctx.lineCap='round';
    for (let i=0;i<5;i++) {
      const a = -Math.PI*0.9 + i*Math.PI*0.16;
      ctx.beginPath();
      ctx.moveTo(-r*0.42+Math.cos(a)*r*0.42, -r*0.5+Math.sin(a)*r*0.42);
      ctx.lineTo(-r*0.42+Math.cos(a)*r*0.6,  -r*0.5+Math.sin(a)*r*0.6);
      ctx.stroke();
    }
    drawCloudShape(ctx, r*0.12, -r*0.05, r*0.85, color);
    ctx.lineWidth = Math.max(1.4, r*0.15);
    [-1,0.4,1.6].forEach(i=>{
      ctx.beginPath();
      ctx.moveTo(i*r*0.3, r*0.42);
      ctx.lineTo(i*r*0.3 - r*0.14, r*0.82);
      ctx.stroke();
    });
  } else if (type === 'snow') {
    drawCloudShape(ctx, 0, -r*0.2, r*0.85, color);
    [-1,0,1].forEach(i=>{
      ctx.beginPath(); ctx.arc(i*r*0.36, r*0.55, r*0.09, 0, Math.PI*2); ctx.fill();
    });
  }
  ctx.restore();
}

// ── 기상청 폭염특보 API ──
async function fetchHeatAlert() {
  try {
    const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList`
      + `?serviceKey=${encodeURIComponent(API_KEY)}&pageNo=1&numOfRows=100&dataType=JSON`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    // 서울 관련 폭염 특보 필터링
    const seoulHeat = list.filter(i => {
      const content = (i.CONTENT||'') + (i.TITLE||'');
      return content.includes('서울') && content.includes('폭염');
    });
    if (!seoulHeat.length) return { level: 0, label: '없음', message: '' };
    const content = seoulHeat[0].CONTENT || seoulHeat[0].TITLE || '';
    if (content.includes('중대경보')) return { level: 3, label: '폭염 중대경보', message: content.slice(0,60) };
    if (content.includes('경보'))    return { level: 2, label: '폭염경보',      message: content.slice(0,60) };
    if (content.includes('주의보'))  return { level: 1, label: '폭염주의보',    message: content.slice(0,60) };
    return { level: 0, label: '없음', message: '' };
  } catch(e) {
    console.log('특보 API 실패(fallback):', e.message);
    return { level: -1, label: '조회불가', message: '' };
  }
}

// ────────────────────────────────────────────────
//  DAILY 포스터 (기존과 동일한 디자인)
// ────────────────────────────────────────────────
async function drawDailyPoster(weather) {
  const W=800, H=1131;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const fl = weather.feelsLike;
  const stage = getStage(fl);
  const color = SC[stage];
  const now = kNow();
  const dateStr = fmtDate(now);
  const timeStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=color; ctx.fillRect(0,0,W,12);

  ctx.fillStyle='#0a0e1a'; ctx.font='bold 26px Nanum'; ctx.textAlign='left';
  ctx.fillText('성동자이리버뷰', 60, 80);
  ctx.fillStyle='#5a6175'; ctx.font='18px Nanum';
  ctx.fillText('온열질환 예방 안전수칙', 60, 110);
  ctx.textAlign='right'; ctx.font='16px Nanum';
  ctx.fillText(`${dateStr}  ${timeStr} 기준`, W-60, 80);

  try {
    const logoPath = path.join(__dirname,'..','gsenc_logo.png');
    if (fs.existsSync(logoPath)) {
      const logo = await loadImage(logoPath);
      const lw=90, lh=lw*(logo.height/logo.width);
      ctx.drawImage(logo, W-60-lw, 92, lw, lh);
    }
  } catch(e) {}

  ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(60,135); ctx.lineTo(W-60,135); ctx.stroke();

  ctx.fillStyle=color; roundRect(ctx,60,165,W-120,90,16); ctx.fill();
  ctx.fillStyle='#ffffff'; ctx.textAlign='left'; ctx.font='900 38px Nanum';
  ctx.fillText(SLABEL[stage], 90, 222);
  ctx.textAlign='right'; ctx.font='18px Nanum';
  ctx.fillText(stage>0?'작업 시 각별히 주의하세요':'정상 작업 가능', W-90, 218);

  ctx.textAlign='center';
  ctx.fillStyle='#5a6175'; ctx.font='bold 22px Nanum';
  ctx.fillText('현재 체감온도', W/2, 320);
  ctx.fillStyle=color; ctx.font='900 120px Nanum';
  ctx.fillText(Math.round(fl)+'°C', W/2, 440);

  const bw=(W-120-20)/2;
  ctx.fillStyle='#f3f4f6';
  roundRect(ctx,60,480,bw,90,12); ctx.fill();
  roundRect(ctx,60+bw+20,480,bw,90,12); ctx.fill();
  ctx.fillStyle='#5a6175'; ctx.font='bold 16px Nanum'; ctx.textAlign='center';
  ctx.fillText('기온',60+bw/2,512); ctx.fillText('습도',60+bw+20+bw/2,512);
  ctx.fillStyle='#0a0e1a'; ctx.font='bold 36px Nanum';
  ctx.fillText((weather.temp!=null?weather.temp:'—')+'°C',60+bw/2,556);
  ctx.fillText((weather.humid!=null?weather.humid:'—')+'%',60+bw+20+bw/2,556);

  ctx.fillStyle='#0a0e1a'; ctx.font='bold 22px Nanum'; ctx.textAlign='left';
  ctx.fillText('폭염안전 5대 기본수칙', 60, 640);
  ctx.fillStyle=color; ctx.fillRect(60,652,60,3);
  let y=688;
  PREVENT5.forEach((item,i)=>{
    ctx.fillStyle=color; ctx.beginPath(); ctx.arc(78,y-6,16,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 16px Nanum'; ctx.textAlign='center';
    ctx.fillText(String(i+1), 78, y);
    ctx.fillStyle=color; ctx.font='bold 16px Nanum'; ctx.textAlign='left';
    ctx.fillText(item.tag, 110, y-9);
    ctx.fillStyle='#1a2235'; ctx.font='15px Nanum';
    ctx.fillText(item.txt, 110, y+11);
    y+=58;
  });

  ctx.fillStyle='#fef2f2'; roundRect(ctx,60,y+10,W-120,70,12); ctx.fill();
  ctx.fillStyle='#ef4444'; ctx.font='bold 20px Nanum'; ctx.textAlign='left';
  ctx.fillText('응급상황 발생 시', 90, y+52);
  ctx.font='bold 24px Nanum'; ctx.textAlign='right';
  ctx.fillText('즉시 119 신고', W-90, y+52);

  ctx.fillStyle='#9ca3af'; ctx.font='13px Nanum'; ctx.textAlign='center';
  ctx.fillText('GS E&C · 2026년 온열질환 예방대책 기준 적용 · 기상청 오픈API', W/2, H-40);

  return canvas;
}

// ────────────────────────────────────────────────
//  FORECAST 포스터 (내일 07~17시 예보 + 폭염특보)
// ────────────────────────────────────────────────
async function drawForecastPoster(hours, alert, tomorrowStr, weatherHours) {
  weatherHours = weatherHours || [];
  const wMap = new Map(weatherHours.map(w => [w.hour, w]));
  const weatherSummary = weatherHours.length ? summarizeWeather(weatherHours) : null;
  // 카카오톡 공지용 정사각형 1080x1080 레이아웃 (4분기)
  const W=1080, H=1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const maxFl = Math.max(...hours.map(h=>h.fl));
  // 근로자 체감 기준 3단계 색상: 31°C 미만(시원함)=파랑, 31~34°C(휴식 필요)=주황, 35°C↑(옥외중지)=빨강
  // 두 박스(옥외중지/휴식)의 기준과 색이 정확히 일치하도록 통일
  function heatColor3(fl) { return fl>=35 ? '#ef4444' : fl>=31 ? '#f97316' : '#3b82f6'; }
  const topColor = heatColor3(maxFl);

  // 시간대 분류
  const stopOut  = hours.filter(h=>h.fl>=35).map(h=>h.hour);   // 옥외중지 35↑
  const fullStop = hours.filter(h=>h.fl>=38).map(h=>h.hour);   // 전면중지 38↑

  // 구간 묶기 헬퍼
  function ranges(nums){
    if(!nums.length) return [];
    nums=nums.slice().sort((a,b)=>a-b);
    const out=[[nums[0],nums[0]]];
    for(let k=1;k<nums.length;k++){
      if(nums[k]===out[out.length-1][1]+1) out[out.length-1][1]=nums[k];
      else out.push([nums[k],nums[k]]);
    }
    return out;
  }
  const fmt = rs => rs.map(([a,b])=> a!==b? `${a}~${b}시` : `${a}시`).join(', ');

  // 폭염특보 텍스트 — 근로자에게 익숙한 공식 용어(폭염주의보/폭염경보 등)를 그대로 사용
  const alertLabel = alert.level===0?'특보 없음':alert.level===-1?'특보 확인중':alert.label;
  const alertTextColor = alert.level>=3?'#7f1d1d':alert.level===2?'#dc2626':alert.level===1?'#f97316':'#64748b';

  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);

  // ── 상단 색 헤더 ──
  const headH=300;
  ctx.fillStyle=topColor; ctx.fillRect(0,0,W,headH);
  ctx.fillStyle='#ffffff'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.font='bold 40px Nanum';
  ctx.fillText('성동자이리버뷰', 70, 88);
  ctx.font='26px Nanum';
  ctx.fillText(`${tomorrowStr} 체감온도 예보`, 70, 130);
  // 폭염특보 배지 — 근로자가 바로 알아볼 수 있도록 크고 분명하게
  ctx.font='900 32px Nanum';
  const albw = ctx.measureText(alertLabel).width + 64;
  const albX = W-70-albw;
  ctx.fillStyle='#ffffff'; roundRect(ctx, albX, 46, albw, 62, 31); ctx.fill();
  ctx.fillStyle=alertTextColor; ctx.font='900 32px Nanum'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(alertLabel, albX+albw/2, 46+31);
  ctx.textBaseline='alphabetic';
  // 폭염주의보 이상 발령 시 현장 조치(얼음물 배부) 안내 — 특보 배지 바로 아래, 특보가 없으면 표시하지 않음
  if (alert.level>=1) {
    ctx.fillStyle='rgba(255,255,255,0.95)'; ctx.font='bold 16px Nanum'; ctx.textAlign='right';
    ctx.fillText('→ 현장 얼음물 배부 시행', W-70, 126);
  }
  // 날씨 요약 배지 (아이콘 + 하늘상태 + 강수확률) — 특보 배지 아래
  if (weatherSummary) {
    const iconCx = W-250, iconCy=172, iconR=22;
    drawWeatherIcon(ctx, weatherSummary.type, iconCx, iconCy, iconR, '#ffffff');
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillStyle='#ffffff'; ctx.font='bold 25px Nanum';
    ctx.fillText(weatherSummary.label, iconCx+iconR+14, iconCy-8);
    if (weatherSummary.pop>=30) {
      ctx.font='19px Nanum'; ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.fillText(`강수확률 ${weatherSummary.pop}%`, iconCx+iconR+14, iconCy+17);
    }
    ctx.textBaseline='alphabetic';
  }
  // 최고 체감온도
  ctx.fillStyle='#ffffff'; ctx.textAlign='left';
  ctx.font='bold 27px Nanum'; ctx.fillText('오늘 최고 체감온도', 70, 188);
  ctx.font='900 86px Nanum'; ctx.fillText(Math.round(maxFl)+'°C', 70, 268);

  // ── 중앙 메인: 옥외작업 중지 시간 / 휴식 시간, 두 개의 고정 박스 ──
  // 매일 같은 자리에서 같은 정보를 찾을 수 있도록 상황별 분기 없이 두 박스를 항상 표시
  ctx.textAlign='center';
  const cardX=70, cardW=W-140;
  const card1Y=332, card1H=158;
  const card2Y=card1Y+card1H+16, card2H=122;

  function drawCard(x,yy,w,h,bg,border) {
    ctx.fillStyle=bg; roundRect(ctx,x,yy,w,h,20); ctx.fill();
    ctx.strokeStyle=border; ctx.lineWidth=2.5; roundRect(ctx,x,yy,w,h,20); ctx.stroke();
  }
  // 카드 우상단에 "예보 · 변동 가능" 태그 — 옥외중지/휴식 시간이 확정이 아니라 예보값임을 각 박스에서 바로 알 수 있게
  function drawForecastTag(x2, yy, color) {
    const prevAlign = ctx.textAlign, prevBaseline = ctx.textBaseline;
    const txt = '예보 · 변동 가능';
    ctx.font = 'bold 14px Nanum';
    const tw = ctx.measureText(txt).width + 20, th = 26;
    const tx = x2 - tw;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, tx, yy, tw, th, 13); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; roundRect(ctx, tx, yy, tw, th, 13); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(txt, tx+tw/2, yy+th/2);
    ctx.textAlign = prevAlign; ctx.textBaseline = prevBaseline;
  }
  // 카드 내부에 넓은 텍스트를 넣을 때 카드 폭을 넘지 않도록 폰트 크기를 자동으로 줄임
  function fitFont(text, maxW, baseSize, weight) {
    let size = baseSize;
    ctx.font = `${weight} ${size}px Nanum`;
    while (ctx.measureText(text).width > maxW && size > 26) {
      size -= 4; ctx.font = `${weight} ${size}px Nanum`;
    }
    return size;
  }

  const stopHours = stopOut; // 체감 35°C 이상
  const restHours = hours.filter(h=>h.fl>=31 && h.fl<35).map(h=>h.hour); // 체감 31~35°C

  // 박스1 — 옥외작업 중지 시간 (체감 35°C↑) — 내용 줄 수와 무관하게 박스 세로 중앙에 정렬
  const c1cy = card1Y + card1H/2;
  ctx.textBaseline='middle';
  if (stopHours.length) {
    drawCard(cardX,card1Y,cardW,card1H,'#fef2f2','#ef4444');
    drawForecastTag(cardX+cardW-14, card1Y+14, '#ef4444');
    ctx.fillStyle='#991b1b'; ctx.font='bold 24px Nanum';
    ctx.fillText('옥외작업 중지 시간 (체감 35°C↑)', W/2, c1cy-50);
    const rangeTxt1 = fmt(ranges(stopHours));
    const sz1 = fitFont(rangeTxt1, cardW-80, 60, '900');
    ctx.fillStyle='#ef4444'; ctx.font=`900 ${sz1}px Nanum`;
    ctx.fillText(rangeTxt1, W/2, c1cy+4);
    if (fullStop.length) {
      ctx.fillStyle='#7f1d1d'; ctx.font='bold 22px Nanum';
      ctx.fillText(`⚠ ${fmt(ranges(fullStop))} 전면 작업 중지 · 즉시 대피`, W/2, c1cy+54);
    } else {
      ctx.fillStyle='#991b1b'; ctx.font='bold 22px Nanum';
      ctx.fillText('이 시간 옥내작업만 가능', W/2, c1cy+54);
    }
  } else {
    drawCard(cardX,card1Y,cardW,card1H,'#f8fafc','#cbd5e1');
    drawForecastTag(cardX+cardW-14, card1Y+14, '#94a3b8');
    ctx.fillStyle='#475569'; ctx.font='bold 24px Nanum';
    ctx.fillText('옥외작업 중지 시간 (체감 35°C↑)', W/2, c1cy-30);
    ctx.fillStyle='#16a34a'; ctx.font='900 52px Nanum';
    ctx.fillText('없음', W/2, c1cy+26);
  }

  // 박스2 — 휴식 시간 (체감 31~34°C, 사내 기준: 50분 작업 · 10분 휴식) — 동일하게 세로 중앙 정렬
  const c2cy = card2Y + card2H/2;
  if (restHours.length) {
    drawCard(cardX,card2Y,cardW,card2H,'#fff8e6','#f59e0b');
    drawForecastTag(cardX+cardW-14, card2Y+14, '#f59e0b');
    ctx.fillStyle='#b45309'; ctx.font='bold 24px Nanum';
    ctx.fillText('휴식 시간 (체감 31~34°C)', W/2, c2cy-38);
    const rangeTxt2 = fmt(ranges(restHours));
    const sz2 = fitFont(rangeTxt2, cardW-80, 44, '900');
    ctx.fillStyle='#f59e0b'; ctx.font=`900 ${sz2}px Nanum`;
    ctx.fillText(rangeTxt2, W/2, c2cy+4);
    ctx.fillStyle='#b45309'; ctx.font='900 22px Nanum';
    ctx.fillText('50분 작업 · 10분 휴식', W/2, c2cy+42);
  } else {
    drawCard(cardX,card2Y,cardW,card2H,'#f8fafc','#cbd5e1');
    drawForecastTag(cardX+cardW-14, card2Y+14, '#94a3b8');
    ctx.fillStyle='#475569'; ctx.font='bold 24px Nanum';
    ctx.fillText('휴식 시간 (체감 31~34°C)', W/2, c2cy-22);
    ctx.fillStyle='#16a34a'; ctx.font='900 36px Nanum';
    ctx.fillText('의무 휴식 시간대 없음', W/2, c2cy+24);
  }
  ctx.textBaseline='alphabetic';

  // ── 시간대별 체감온도 (박스1·박스2와 같은 카드 스타일로 감싸서 통일감을 줌) ──
  const gy = card2Y + card2H + 16;
  const chartCardH = 270;
  drawCard(cardX, gy, cardW, chartCardH, '#f8fafc', '#cbd5e1');

  const chartX=cardX+20, chartW=cardW-40;
  ctx.fillStyle='#334155'; ctx.font='bold 22px Nanum'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillText('시간대별 체감온도', chartX, gy+38);

  const iconCy=gy+66, labelY=gy+92, numY=gy+126, chartY=gy+150, chartH=86;
  const dmin=Math.min(...hours.map(h=>h.fl)), dmax=Math.max(...hours.map(h=>h.fl));
  const minV=Math.floor(dmin)-2, maxV=Math.max(Math.ceil(dmax)+2,39);
  const toY = v => chartY+chartH-(v-minV)/(maxV-minV)*chartH;
  const n=hours.length, barW=(chartW/n)*0.66, gap=chartW/n;

  hours.forEach((h,i)=>{
    const cx=chartX+i*gap+gap/2, bx=cx-barW/2, by=toY(h.fl), c=heatColor3(h.fl);
    // 날씨 아이콘은 비/소나기/눈이 예보된 시간에만 표시 (맑음·구름은 표시하지 않아 정보량을 줄임)
    const wh = wMap.get(h.hour);
    const iType = wh ? weatherIconType(wh.sky, wh.pty) : null;
    if (iType && IS_PRECIP[iType]) {
      drawWeatherIcon(ctx, iType, cx, iconCy, 14, WICON_COLOR[iType]);
      ctx.fillStyle=WICON_COLOR[iType]; ctx.font='bold 14px Nanum'; ctx.textAlign='center';
      ctx.fillText(WICON_LABEL[iType], cx, labelY);
    }
    // 기온 (막대 높이와 무관하게 항상 같은 줄에 정렬)
    ctx.fillStyle=c; ctx.font='900 24px Nanum'; ctx.textAlign='center';
    ctx.fillText(String(Math.round(h.fl))+'°', cx, numY);
    // 막대
    ctx.fillStyle=c; roundRect(ctx,bx,by,barW,chartY+chartH-2-by,5); ctx.fill();
    if (h.fl===dmax){ ctx.strokeStyle='#92400e'; ctx.lineWidth=3; roundRect(ctx,bx,by,barW,chartY+chartH-2-by,5); ctx.stroke(); }
    // 시각 라벨
    ctx.fillStyle='#334155'; ctx.font='bold 18px Nanum';
    ctx.fillText(String(h.hour)+'시', cx, chartY+chartH+24);
  });



  // ── 하단 박스: 증상 + 연락 ──
  const by=H-150, boxH=122;
  ctx.fillStyle='#fdecec'; roundRect(ctx,70,by,W-140,boxH,18); ctx.fill();
  ctx.strokeStyle='#f5b8b8'; ctx.lineWidth=2; roundRect(ctx,70,by,W-140,boxH,18); ctx.stroke();
  ctx.fillStyle='#b91c1c'; ctx.font='900 31px Nanum'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('어지럼 · 두통 · 메스꺼움 · 근육경련', W/2, by+37);
  // 연락 줄 (번호 강조)
  ctx.textBaseline='middle';
  const pre='증상 있으면 즉시 ', num='1811-1139', post='로 연락';
  ctx.font='bold 27px Nanum';
  const wPre=ctx.measureText(pre).width;
  ctx.font='900 27px Nanum';
  const wNum=ctx.measureText(num).width;
  ctx.font='bold 27px Nanum';
  const wPost=ctx.measureText(post).width;
  const total=wPre+wNum+wPost, sx=(W-total)/2, cy=by+84;
  ctx.textAlign='left';
  ctx.fillStyle='#334155'; ctx.font='bold 27px Nanum'; ctx.fillText(pre, sx, cy);
  ctx.fillStyle='#ef4444'; ctx.font='900 27px Nanum'; ctx.fillText(num, sx+wPre, cy);
  ctx.fillStyle='#334155'; ctx.font='bold 27px Nanum'; ctx.fillText(post, sx+wPre+wNum, cy);
  ctx.textBaseline='alphabetic';

  ctx.fillStyle='#9ca3af'; ctx.font='13px Nanum'; ctx.textAlign='center';
  ctx.fillText('* 예보 값은 발표 시점 기준이며, 이후 기상 상황에 따라 변동될 수 있습니다', W/2, H-14);

  return canvas;
}


// ── MAIN ──
(async ()=>{
  try {
    const nowKST  = kNow();
    const todayStr = dateKey(nowKST);

    if (POSTER_TYPE === 'daily') {
      // 현재 체감온도 — 기상청 생활기상지수 건설현장(A48) 값 (날씨누리와 일치).
      // 기온·습도는 초단기실황에서 받아 함께 표시.
      const h = nowKST.getUTCHours();
      // 실황은 매시 40분 이후 제공 → 분<40이면 한 시간 전 정시 기준
      let obsHour = h; if (nowKST.getUTCMinutes() < 40) obsHour -= 1;
      if (obsHour < 0) obsHour = 0;
      const feelsLike = await fetchSenTaOne(todayStr, obsHour); // 정수
      let temp, humid;
      try {
        const ncst = await fetchNcstAuto();
        temp = ncst.temp; humid = ncst.humid;
      } catch(e) {
        console.log('실황 조회 실패(기온/습도 생략):', e.message);
        temp = null; humid = null;
      }
      console.log(`당일 체감온도(A48): ${feelsLike}°C` + (temp!=null?` (기온 ${temp}°C 습도 ${humid}%)`:''));

      const canvas = await drawDailyPoster({temp, humid, feelsLike});
      const dir = path.join(__dirname,'..','snapshots','daily');
      if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
      const fn = `${todayStr}-${pad(h)}${pad(nowKST.getUTCMinutes())}.jpg`;
      fs.writeFileSync(path.join(dir,fn), canvas.toBuffer('image/jpeg',{quality:0.92}));
      console.log('당일 포스터 저장:', fn);

    } else {
      // 예보 포스터 — KST 18시 기준으로 자동 분기
      // 18시 이전: 오늘 예보 (당일 포스터 재생성/수정 대응)
      // 18시 이후: 내일 예보 (18시 발표 직후부터 다음날 포스터 생성)
      const kstHour = nowKST.getUTCHours();
      const isTomorrow = kstHour >= 18;
      const targetKST = isTomorrow
        ? new Date(nowKST.getTime()+24*3600*1000)
        : nowKST;
      const targetStr = dateKey(targetKST);
      console.log(`예보 대상: ${targetStr} (KST ${kstHour}시 → ${isTomorrow?'내일':'오늘'})`);

      // 대상일 07~17시 체감온도 (정수, 기상청 제공값)
      const hours = await fetchSenTaHours(targetStr, 7, 17);
      if(!hours.length) throw new Error(`${targetStr} 07~17시 체감온도 데이터가 없음 — 발표분이 대상일을 커버하지 못함`);
      console.log(`예보(${targetStr}): ${hours.length}개 시간대, 최고 ${Math.max(...hours.map(h=>h.fl))}°C`);

      // 폭염특보
      const alert = await fetchHeatAlert();
      console.log(`폭염특보: ${alert.label}`);

      // 하늘상태·강수형태·강수확률 (날씨 아이콘용) — 실패해도 포스터 생성은 계속 진행
      let weatherHours = [];
      try {
        weatherHours = await fetchWeatherHours(targetStr, 7, 17);
        console.log(`날씨정보: ${weatherHours.length}개 시간대`);
      } catch(e) {
        console.log('날씨정보 조회 실패(아이콘 생략):', e.message);
      }

      const canvas = await drawForecastPoster(hours, alert, fmtDate(targetKST), weatherHours);
      const dir = path.join(__dirname,'..','snapshots','forecast');
      if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
      // 파일명: {대상날짜}-{KST생성시각}.jpg (예: 20260618-1810.jpg)
      const genH = pad(nowKST.getUTCHours()), genM = pad(nowKST.getUTCMinutes());
      const fn = `${targetStr}-${genH}${genM}.jpg`;
      fs.writeFileSync(path.join(dir,fn), canvas.toBuffer('image/jpeg',{quality:0.92}));
      console.log('예보 포스터 저장:', fn);
    }
  } catch(e) {
    console.error('포스터 생성 실패:', e);
    process.exit(1);
  }
})();

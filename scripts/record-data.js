/**
 * 매 실행 시 "07~17시 중 아직 기록되지 않은 시각"을 모두 채운다 (백필 방식)
 *  - GitHub Actions cron은 누락/지연이 잦으므로, 1줄만 쓰지 않고
 *    그날 07시부터 현재 관측 가능한 시각까지 빠진 칸을 한 번에 메운다.
 *  - 늦은 실행 한 번만 성공해도 그날 데이터가 완성된다.
 *
 * 체감온도  = 기상청 생활기상지수 건설현장(A48) (날씨누리·포스터와 일치)
 * 기온·습도 = 초단기실황(getUltraSrtNcst) 실제 관측값 (참고 표시용)
 * data/체감온도기록_YYYY.xlsx 에 누적
 *
 * 엑셀 구성:
 *  - 1행: 제목 "성동자이리버뷰 체감온도 기록" (A~G 병합)
 *  - 2행: 범례(헤더)  ← 인쇄 시 매 페이지 반복
 *  - 3행~: 데이터
 *  - A4 세로, 가로 한 페이지에 맞춤
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const API_KEY = process.env.KMA_API_KEY;
const NX = process.env.GRID_NX || '61';
const NY = process.env.GRID_NY || '127';
const AREA_NO = process.env.AREA_NO || '1123060000'; // 동대문구 답십리제1동 (생활기상지수 지점코드, 격자 61/127)
if (!API_KEY) { console.error('KMA_API_KEY 없음'); process.exit(1); }

const pad  = n => String(n).padStart(2,'0');
const kNow = () => new Date(Date.now() + 9*3600*1000); // KST

const TITLE  = '성동자이리버뷰 체감온도 기록';
const HEADER = ['날짜','관측시각','기록시각','기온(°C)','습도(%)','체감온도(°C)','단계'];
const WIDTHS = [13, 10, 10, 10, 9, 13, 16];

// 기록 대상 시각 범위 (KST)
const START_HOUR = 7;
const END_HOUR   = 17;

function dateKey(d){ return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`; }

// ── 기상청 생활기상지수: 건설현장(A48) 체감온도 (날씨누리와 동일, 발표 06·18시) ──
function sentaHourOffset(baseYmdH, targetYmd, targetHour) {
  const by=+baseYmdH.slice(0,4), bm=+baseYmdH.slice(4,6), bd=+baseYmdH.slice(6,8), bh=+baseYmdH.slice(8,10);
  const ty=+targetYmd.slice(0,4), tm=+targetYmd.slice(4,6), td=+targetYmd.slice(6,8);
  return Math.round((Date.UTC(ty,tm-1,td,targetHour)-Date.UTC(by,bm-1,bd,bh))/3600000);
}
async function fetchSenTa(timeYmdH) {
  const url = `http://apis.data.go.kr/1360000/LivingWthrIdxServiceV2/getSenTaIdxV2`
    + `?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=10&pageNo=1&dataType=JSON`
    + `&areaNo=${AREA_NO}&time=${timeYmdH}&requestCode=A48`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error(`체감온도 JSON 파싱 실패 ${timeYmdH}`); }
  const item = data?.response?.body?.items?.item?.[0] || data?.response?.body?.items?.item;
  if (!item) {
    const code = data?.response?.header?.resultCode;
    throw new Error(`체감온도 없음 ${timeYmdH} (resultCode=${code})`);
  }
  return item;
}
// 대상일 targetHour시의 체감온도(정수) 1개를 최신 발표분에서 가져온다
async function fetchSenTaOne(targetYmd, targetHour) {
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
      const off = sentaHourOffset(t, targetYmd, targetHour);
      if (off>=1 && off<=78) {
        const v = item['h'+off];
        if (v!==undefined && v!==null && v!=='') {
          console.log(`체감온도(A48) 조회 성공: ${targetYmd} ${pad(targetHour)}시 (발표 ${t}, h${off} = ${v})`);
          return parseInt(v);
        }
      }
    } catch(e) { lastErr = e; }
  }
  // 폴백: 초단기실황 기온·습도로 계산
  console.log(`A48 조회 실패(${lastErr?.message}) → 실황 폴백 (${pad(targetHour)}시)`);
  const ncst = await fetchNcst(targetYmd, pad(targetHour)+'00');
  const feels = Math.round(heatIndex(ncst.temp, ncst.humid));
  console.log(`폴백: 기온 ${ncst.temp}°C 습도 ${ncst.humid}% → 체감 ${feels}°C`);
  return feels;
}

// 기상청 여름철 체감온도 공식 (A48 폴백용)
function heatIndex(Ta, RH) {
  const Tw = Ta*Math.atan(0.151977*Math.sqrt(RH+8.313659))
    + Math.atan(Ta+RH) - Math.atan(RH-1.67633)
    + 0.00391838*Math.pow(RH,1.5)*Math.atan(0.023101*RH) - 4.686035;
  return Math.round((-0.2442+0.55399*Tw+0.45535*Ta-0.0022*Tw*Tw+0.00278*Tw*Ta+3.0)*10)/10;
}
function getStageLabel(fl) {
  if (fl>=38) return '4단계 전면중지';
  if (fl>=35) return '3단계 위험';
  if (fl>=33) return '2단계 경고';
  if (fl>=31) return '1단계 주의';
  return '정상';
}

// 초단기실황 (기온·습도 — 표시용)
async function fetchNcst(baseDate, baseTime) {
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst`
    + `?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=60&pageNo=1&dataType=JSON`
    + `&base_date=${baseDate}&base_time=${baseTime}&nx=${NX}&ny=${NY}`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error(`JSON 파싱 실패 ${baseDate} ${baseTime}`); }
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

// 한 시각 기록 (실패해도 그 시각만 건너뜀)
async function recordHour(dataRows, dateStr, baseDate, hour, recTime) {
  const obsTime = pad(hour) + ':00';
  if (dataRows.some(r => r[0] === dateStr && r[1] === obsTime)) {
    return false; // 이미 기록됨
  }
  let feels;
  try {
    feels = await fetchSenTaOne(baseDate, hour); // A48 (폴백 포함)
  } catch(e) {
    console.log(`${dateStr} ${obsTime} 체감온도 조회 실패 — 건너뜀: ${e.message}`);
    return false;
  }
  let temp = null, humid = null;
  try {
    const ncst = await fetchNcst(baseDate, pad(hour)+'00');
    temp = ncst.temp; humid = ncst.humid;
  } catch(e) {
    console.log(`${dateStr} ${obsTime} 기온/습도 실황 조회 실패(체감온도만 기록): ${e.message}`);
  }
  dataRows.push([dateStr, obsTime, recTime,
    temp!=null?temp:'', humid!=null?humid:'', feels, getStageLabel(feels)]);
  console.log(`기록: ${dateStr} ${obsTime} → ${temp}°C ${humid}% 체감 ${feels}°C`);
  return true;
}

(async () => {
  try {
    const now = kNow();
    const year = now.getUTCFullYear();
    const mm = now.getUTCMonth()+1, dd = now.getUTCDate();
    const dateStr  = `${year}-${pad(mm)}-${pad(dd)}`;
    const baseDate = `${year}${pad(mm)}${pad(dd)}`;
    const recTime  = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

    // 현재 관측 가능한 마지막 정시: 실황은 매시 40분 이후 제공 → 분<40이면 직전 정시
    let lastObs = now.getUTCHours();
    if (now.getUTCMinutes() < 40) lastObs -= 1;
    const endHour = Math.min(lastObs, END_HOUR);
    if (endHour < START_HOUR) {
      console.log(`아직 기록 가능한 시각 없음 (현재 관측가능 ${lastObs}시, 범위 ${START_HOUR}~${END_HOUR}시) — 종료`);
      return;
    }

    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `체감온도기록_${year}.xlsx`);

    // ── 기존 데이터 읽기 (제목/헤더 행 제외, 날짜형식 행만 데이터로 인식) ──
    let dataRows = [];
    if (fs.existsSync(file)) {
      const inWb = new ExcelJS.Workbook();
      await inWb.xlsx.readFile(file);
      const inWs = inWb.worksheets[0];
      if (inWs) {
        inWs.eachRow((row) => {
          const v = row.values; // 1-indexed (v[0] 비어있음)
          const first = v[1];
          if (typeof first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first)) {
            dataRows.push([v[1], v[2], v[3], v[4], v[5], v[6], v[7]]);
          }
        });
      }
    }

    // ── 백필: 07시부터 현재 관측 가능 시각까지 빠진 칸을 모두 채움 ──
    let added = 0;
    for (let h = START_HOUR; h <= endHour; h++) {
      const ok = await recordHour(dataRows, dateStr, baseDate, h, recTime);
      if (ok) added++;
    }
    if (added === 0) {
      console.log(`${dateStr} ${START_HOUR}~${endHour}시 모두 이미 기록됨 — 종료`);
      return;
    }

    // 날짜+관측시각 순 정렬
    dataRows.sort((a,b) => (a[0]+a[1]).localeCompare(b[0]+b[1]));

    // ── 새 워크북 작성 (제목 + 헤더 + 데이터 + 인쇄설정) ──
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('체감온도기록', {
      pageSetup: {
        paperSize: 9,            // A4
        orientation: 'portrait', // 세로
        fitToPage: true, fitToWidth: 1, fitToHeight: 0, // 가로 1페이지에 맞춤
        horizontalCentered: true,
        margins: { left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.3, footer:0.3 }
      }
    });
    // 인쇄 시 1~2행(제목+범례)을 매 페이지 반복
    ws.pageSetup.printTitlesRow = '1:2';

    // 컬럼 너비
    WIDTHS.forEach((w,i) => ws.getColumn(i+1).width = w);

    // 1행: 제목 (병합)
    const titleRow = ws.addRow([TITLE]);
    ws.mergeCells(1, 1, 1, HEADER.length);
    titleRow.getCell(1).font = { size: 16, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 30;

    // 2행: 범례(헤더)
    const headRow = ws.addRow(HEADER);
    headRow.font = { bold: true };
    headRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headRow.height = 22;
    headRow.eachCell((cell) => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFEFEFEF' } };
      cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    });

    // 3행~: 데이터
    dataRows.forEach((r) => {
      const row = ws.addRow(r);
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.eachCell((cell) => {
        cell.border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'thin'}, right:{style:'thin'} };
      });
    });

    await wb.xlsx.writeFile(file);
    console.log(`완료: ${dateStr} 신규 ${added}건 기록 (총 ${dataRows.length}행, 기록시각 ${recTime})`);
  } catch(e) {
    console.error('기록 실패:', e);
    process.exit(1);
  }
})();

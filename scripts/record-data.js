/**
 * 매시간 실행되어 "그 시각의 실황"을 엑셀에 1줄 추가
 * 기상청 초단기실황(getUltraSrtNcst) = 실제 관측값
 * 실행: 06~17시 매시간(KST). data/체감온도기록_YYYY.xlsx 에 1행씩 누적
 *
 * 관측시각 = 가장 최근 정시(예 06:00)
 * 기록시각 = 실제로 데이터를 받은 시각(예 06:17) → 신빙성용
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const API_KEY = process.env.KMA_API_KEY;
const NX = process.env.GRID_NX || '61';
const NY = process.env.GRID_NY || '127';
if (!API_KEY) { console.error('KMA_API_KEY 없음'); process.exit(1); }

const pad  = n => String(n).padStart(2,'0');
const kNow = () => new Date(Date.now() + 9*3600*1000); // KST

// 기상청 여름철 체감온도 (2022.6.2~)
function heatIndex(Ta, RH) {
  const Tw = Ta*Math.atan(0.151977*Math.sqrt(RH+8.313659))
    + Math.atan(Ta+RH) - Math.atan(RH-1.67633)
    + 0.00391838*Math.pow(RH,1.5)*Math.atan(0.023101*RH) - 4.686035;
  const feels = -0.2442 + 0.55399*Tw + 0.45535*Ta - 0.0022*Tw*Tw + 0.00278*Tw*Ta + 3.0;
  return Math.round(feels*10)/10;
}
function getStageLabel(fl) {
  if (fl>=38) return '4단계 전면중지';
  if (fl>=35) return '3단계 위험';
  if (fl>=33) return '2단계 경고';
  if (fl>=31) return '1단계 주의';
  return '정상';
}

// 초단기실황 조회 (특정 정시의 실제 관측값)
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

(async () => {
  try {
    const now = kNow();
    const year = now.getUTCFullYear();
    const mm = now.getUTCMonth()+1, dd = now.getUTCDate();
    const dateStr  = `${year}-${pad(mm)}-${pad(dd)}`;
    const baseDate = `${year}${pad(mm)}${pad(dd)}`;

    // 관측시각: 초단기실황은 매시 정시 발표 → 가장 최근 정시 사용.
    // 실황은 매시 40분 이후 제공되므로, 분이 40 미만이면 한 시간 전 정시를 쓴다.
    let obsHour = now.getUTCHours();
    if (now.getUTCMinutes() < 40) obsHour -= 1;
    if (obsHour < 0) { console.log('자정 이전 정시 없음 — 종료'); return; }
    const obsTime = pad(obsHour) + ':00';
    const obsBaseTime = pad(obsHour) + '00';

    // 기록시각: 실제로 데이터를 받은 시각 (분까지)
    const recTime = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `체감온도기록_${year}.xlsx`);

    const HEADER = ['날짜','관측시각','기록시각','기온(°C)','습도(%)','체감온도(°C)','단계'];

    // 기존 파일 읽기
    let rows = [];
    if (fs.existsSync(file)) {
      const wb = XLSX.readFile(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    }
    if (!rows.length) rows = [HEADER];

    // 중복 방지: 같은 (날짜, 관측시각) 이 이미 있으면 종료
    const dup = rows.some(r => r[0] === dateStr && r[1] === obsTime);
    if (dup) {
      console.log(`${dateStr} ${obsTime} 는 이미 기록됨 — 건너뜀`);
      return;
    }

    // 실황 조회
    const { temp, humid } = await fetchNcst(baseDate, obsBaseTime);
    const feels = heatIndex(temp, humid);
    rows.push([dateStr, obsTime, recTime, temp, humid, feels, getStageLabel(feels)]);

    // 저장
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:10},{wch:10},{wch:10},{wch:9},{wch:12},{wch:14}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '체감온도기록');
    XLSX.writeFile(wb, file);
    console.log(`기록 완료: ${dateStr} 관측 ${obsTime} / 기록 ${recTime} → ${temp}°C ${humid}% 체감 ${feels}°C`);
  } catch(e) {
    console.error('기록 실패:', e);
    process.exit(1);
  }
})();

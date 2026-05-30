// 성동자이리버뷰 온열질환 예방 포스터 자동 생성 스크립트
// GitHub Actions에서 매일 09시/14시(KST)에 실행됩니다.
// 기상청 API → 체감온도 계산 → 포스터(JPG) 생성 → snapshots/ 폴더에 저장

const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont, loadImage } = require('canvas');

// ── 한글 폰트 등록 ──
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
];
try {
  registerFont('/usr/share/fonts/truetype/nanum/NanumGothic.ttf', { family: 'Nanum', weight: 'normal' });
  registerFont('/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf', { family: 'Nanum', weight: 'bold' });
  registerFont('/usr/share/fonts/truetype/nanum/NanumGothicExtraBold.ttf', { family: 'Nanum', weight: '900' });
} catch (e) {
  console.log('일부 폰트 등록 실패 (계속 진행):', e.message);
}

// ── 설정 (GitHub Secrets / 환경변수) ──
const API_KEY = process.env.KMA_API_KEY;
const NX = process.env.GRID_NX || '61';
const NY = process.env.GRID_NY || '127';

if (!API_KEY) {
  console.error('KMA_API_KEY 환경변수가 없습니다. GitHub Secrets에 등록하세요.');
  process.exit(1);
}

// ── 폭염안전 5대 기본수칙 (고용노동부) ──
const PREVENT5 = [
  { tag: '물', txt: '시원하고 깨끗한 물 충분히 제공' },
  { tag: '바람·그늘', txt: '실내외 작업 시 에어컨·선풍기 등 냉방장치 및 그늘막 설치' },
  { tag: '휴식', txt: '체감온도 33°C 이상 폭염작업 시 매 2시간 이내 20분 이상 휴식' },
  { tag: '보냉장구', txt: '냉각의류·냉각조끼 등 개인 보냉장구 지급' },
  { tag: '응급조치', txt: '온열질환 의심자가 의식이 없는 경우 즉시 119 신고' },
];

const SC = ['#22c55e', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];
const SLABEL = ['정상', '1단계 주의', '2단계 경고', '3단계 위험', '4단계 전면중지'];

function heatIndex(t, rh) {
  if (t < 27) return Math.round(t * 10) / 10;
  const hi = -8.78469475556 + 1.61139411 * t + 2.33854883889 * rh
    - 0.14611605 * t * rh - 0.012308094 * t * t
    - 0.0164248277778 * rh * rh + 0.002211732 * t * t * rh
    + 0.00072546 * t * rh * rh - 0.000003582 * t * t * rh * rh;
  return Math.round(hi * 10) / 10;
}
function getStage(fl) {
  if (fl >= 38) return 4;
  if (fl >= 35) return 3;
  if (fl >= 33) return 2;
  if (fl >= 31) return 1;
  return 0;
}

async function fetchWeather() {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const pad = n => String(n).padStart(2, '0');
  const bd = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate());
  const h = now.getUTCHours();
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  let bh = 2;
  for (const s of slots) if (h >= s) bh = s;
  const bt = pad(bh) + '00';

  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${encodeURIComponent(API_KEY)}&numOfRows=400&pageNo=1&dataType=JSON&base_date=${bd}&base_time=${bt}&nx=${NX}&ny=${NY}`;

  const res = await fetch(url);
  const data = await res.json();
  const items = data.response.body.items.item;
  const T = {}, RH = {};
  items.forEach(i => {
    const k = i.fcstDate + i.fcstTime;
    if (i.category === 'TMP') T[k] = parseFloat(i.fcstValue);
    if (i.category === 'REH') RH[k] = parseFloat(i.fcstValue);
  });
  const tk = Object.keys(T).filter(k => k.startsWith(bd)).sort();
  const nk = bd + pad(h) + '00';
  const cl = tk.reduce((a, b) =>
    Math.abs(parseInt(b) - parseInt(nk)) < Math.abs(parseInt(a) - parseInt(nk)) ? b : a, tk[0]);
  const temp = T[cl], humid = RH[cl];
  return { temp, humid, feelsLike: heatIndex(temp, humid) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawPoster(weather) {
  const W = 800, H = 1131;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const fl = weather.feelsLike;
  const stage = getStage(fl);
  const color = SC[stage];
  const label = SLABEL[stage];

  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}`;
  const timeStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color; ctx.fillRect(0, 0, W, 12);

  ctx.fillStyle = '#0a0e1a'; ctx.font = 'bold 26px Nanum'; ctx.textAlign = 'left';
  ctx.fillText('성동자이리버뷰', 60, 80);
  ctx.fillStyle = '#5a6175'; ctx.font = '18px Nanum';
  ctx.fillText('온열질환 예방 안전수칙', 60, 110);
  ctx.textAlign = 'right'; ctx.fillStyle = '#5a6175'; ctx.font = '16px Nanum';
  ctx.fillText(`${dateStr}  ${timeStr} 기준`, W - 60, 80);

  // 로고 (저장소에 gsenc_logo.png가 있으면 삽입)
  try {
    const logoPath = path.join(__dirname, '..', 'gsenc_logo.png');
    if (fs.existsSync(logoPath)) {
      const logo = await loadImage(logoPath);
      const lw = 90, lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, W - 60 - lw, 92, lw, lh);
    }
  } catch (e) {}

  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, 135); ctx.lineTo(W - 60, 135); ctx.stroke();

  ctx.fillStyle = color; roundRect(ctx, 60, 165, W - 120, 90, 16); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.font = '900 38px Nanum';
  ctx.fillText(label, 90, 222);
  ctx.textAlign = 'right'; ctx.font = '18px Nanum';
  ctx.fillText(stage > 0 ? '작업 시 각별히 주의하세요' : '정상 작업 가능', W - 90, 218);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#5a6175'; ctx.font = 'bold 22px Nanum';
  ctx.fillText('현재 체감온도', W / 2, 320);
  ctx.fillStyle = color; ctx.font = '900 120px Nanum';
  ctx.fillText(fl + '°C', W / 2, 440);

  const bw = (W - 120 - 20) / 2;
  ctx.fillStyle = '#f3f4f6';
  roundRect(ctx, 60, 480, bw, 90, 12); ctx.fill();
  roundRect(ctx, 60 + bw + 20, 480, bw, 90, 12); ctx.fill();
  ctx.fillStyle = '#5a6175'; ctx.font = 'bold 16px Nanum'; ctx.textAlign = 'center';
  ctx.fillText('기온', 60 + bw / 2, 512);
  ctx.fillText('습도', 60 + bw + 20 + bw / 2, 512);
  ctx.fillStyle = '#0a0e1a'; ctx.font = 'bold 36px Nanum';
  ctx.fillText(weather.temp + '°C', 60 + bw / 2, 556);
  ctx.fillText(weather.humid + '%', 60 + bw + 20 + bw / 2, 556);

  ctx.fillStyle = '#0a0e1a'; ctx.font = 'bold 22px Nanum'; ctx.textAlign = 'left';
  ctx.fillText('폭염안전 5대 기본수칙', 60, 640);
  ctx.fillStyle = color; ctx.fillRect(60, 652, 60, 3);
  let y = 688;
  PREVENT5.forEach((item, i) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(78, y - 6, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Nanum'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), 78, y);
    ctx.fillStyle = color; ctx.font = 'bold 16px Nanum'; ctx.textAlign = 'left';
    ctx.fillText(item.tag, 110, y - 9);
    ctx.fillStyle = '#1a2235'; ctx.font = '15px Nanum';
    ctx.fillText(item.txt, 110, y + 11);
    y += 58;
  });

  ctx.fillStyle = '#fef2f2'; roundRect(ctx, 60, y + 10, W - 120, 70, 12); ctx.fill();
  ctx.fillStyle = '#ef4444'; ctx.font = 'bold 20px Nanum'; ctx.textAlign = 'left';
  ctx.fillText('응급상황 발생 시', 90, y + 52);
  ctx.font = 'bold 24px Nanum'; ctx.textAlign = 'right';
  ctx.fillText('즉시 119 신고', W - 90, y + 52);

  ctx.fillStyle = '#9ca3af'; ctx.font = '13px Nanum'; ctx.textAlign = 'center';
  ctx.fillText('GS E&C · 2026년 온열질환 예방대책 기준 적용 · 본 안내문은 자동 생성되었습니다', W / 2, H - 40);

  return canvas;
}

(async () => {
  try {
    const weather = await fetchWeather();
    console.log(`체감온도 ${weather.feelsLike}°C (기온 ${weather.temp}°C, 습도 ${weather.humid}%)`);
    const canvas = await drawPoster(weather);

    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const dir = path.join(__dirname, '..', 'snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fn = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.jpg`;
    const out = path.join(dir, fn);
    const buf = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    fs.writeFileSync(out, buf);
    console.log('포스터 저장 완료:', fn);
  } catch (e) {
    console.error('생성 실패:', e);
    process.exit(1);
  }
})();

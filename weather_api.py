import requests
import math
import os
import urllib.request
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont

# 1. 위도/경도를 기상청 격자(X, Y)로 변환
def lat_lon_to_grid(lat, lon):
    RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    DEGRAD, RADDEG = math.pi / 180.0, 180.0 / math.pi
    
    re = RE / GRID
    slat1, slat2 = SLAT1 * DEGRAD, SLAT2 * DEGRAD
    olon, olat = OLON * DEGRAD, OLAT * DEGRAD

    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.pow(math.tan(math.pi * 0.25 + slat1 * 0.5), sn) * math.cos(slat1) / sn
    ro = re * sf / math.pow(math.tan(math.pi * 0.25 + olat * 0.5), sn)

    ra = re * sf / math.pow(math.tan(math.pi * 0.25 + lat * DEGRAD * 0.5), sn)
    theta = lon * DEGRAD - olon
    if theta > math.pi: theta -= 2.0 * math.pi
    if theta < -math.pi: theta += 2.0 * math.pi
    theta *= sn

    x = math.floor(ra * math.sin(theta) + XO + 0.5)
    y = math.floor(ro - ra * math.cos(theta) + YO + 0.5)
    
    return int(x), int(y)

# 2. 기상청 날씨 데이터 가져오기 (시차 문제 해결 완료)
def get_current_weather(lat, lon, api_key):
    nx, ny = lat_lon_to_grid(lat, lon)
    
    # 수정된 부분: 깃허브 서버 시간(UTC)에 9시간을 더해 한국 시간(KST)으로 맞춤
    kst_now = datetime.now() + timedelta(hours=9)
    request_time = kst_now - timedelta(minutes=40)
    
    url = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'
    params = {
        'ServiceKey': api_key,
        'pageNo': '1', 'numOfRows': '1000', 'dataType': 'JSON',
        'base_date': request_time.strftime('%Y%m%d'),
        'base_time': request_time.strftime('%H00'),
        'nx': nx, 'ny': ny
    }

    response = requests.get(url, params=params)
    weather_data = {"temp": "-", "humidity": "-", "wind": "-", "feels_like": "-"}
    
    try:
        items = response.json().get('response', {}).get('body', {}).get('items', {}).get('item', [])
        for item in items:
            if item['category'] == 'T1H': weather_data['temp'] = item['obsrValue']
            elif item['category'] == 'REH': weather_data['humidity'] = item['obsrValue']
            elif item['category'] == 'WSD': weather_data['wind'] = item['obsrValue']
                
        if weather_data['temp'] != "-":
            T = float(weather_data['temp'])
            RH = float(weather_data['humidity'])
            weather_data['feels_like'] = round(-0.2442 + 0.55399 * T + 0.45535 * T + -0.0022 * (T**2) + 0.00278 * T * RH + 3.0, 1)
    except Exception as e:
        print("API 호출 에러:", e)

    return weather_data

# 3. 이미지 스냅샷 생성
def create_snapshot(weather_data):
    kst_now = datetime.now() + timedelta(hours=9)
    now_str = kst_now.strftime('%Y-%m-%d %H:00')
    
    img = Image.new('RGB', (400, 300), color=(44, 62, 80))
    draw = ImageDraw.Draw(img)
    
    font_path = "NanumGothic.ttf"
    if not os.path.exists(font_path):
        font_url = "https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf"
        urllib.request.urlretrieve(font_url, font_path)
        
    font_title = ImageFont.truetype(font_path, 24)
    font_body = ImageFont.truetype(font_path, 30)
    
    draw.text((20, 20), f"[{now_str} 현장 기상]", font=font_title, fill=(200, 200, 200))
    
    body_text = (
        f"기온: {weather_data['temp']}°C\n\n"
        f"체감: {weather_data['feels_like']}°C\n\n"
        f"습도: {weather_data['humidity']}%\n\n"
        f"풍속: {weather_data['wind']}m/s"
    )
    draw.text((20, 80), body_text, font=font_body, fill=(255, 255, 255))
    
    os.makedirs("snapshots", exist_ok=True)
    filename = f"snapshots/weather_{kst_now.strftime('%Y%m%d_%H%M')}.png"
    img.save(filename)
    print(f"스냅샷 저장 완료: {filename}")

if __name__ == "__main__":
    MY_API_KEY = os.environ.get("WEATHER_API_KEY") 
    
    # 현장 위도/경도 (용인 현장)
    TARGET_LAT = 37.2635   
    TARGET_LON = 127.1523  
    
    print("기상청 데이터 호출 중...")
    data = get_current_weather(TARGET_LAT, TARGET_LON, MY_API_KEY)
    
    print("스냅샷 이미지 생성 중...")
    create_snapshot(data)

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

# 2. 기상청 날씨 데이터 가져오기 (시차 문제 및 체감온도 수식 해결 완료)
def get_current_weather(lat, lon, api_key):
    nx, ny = lat_lon_to_grid(lat, lon)
    
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
            # 기상청 여름철 체감온도 산출식 기반 적용
            feels = -0.2442 + 0.55399 * T + 0.45535 * T - 0.0022 * (T**2) + 0.00278 * T * RH + 3.0
            weather_data['feels_like'] = round(feels, 1)
    except Exception as e:
        print("API 호출 에러:", e)

    return weather_data

# 3. 디자인 고도화 이미지 스냅샷 생성
def create_snapshot(weather_data):
    kst_now = datetime.now() + timedelta(hours=9)
    now_str_date = kst_now.strftime('%-m월 %-d일')
    now_str_time = kst_now.strftime('%H시')
    
    # 1080x1350 사이즈
    img_w, img_h = 1080, 1350
    img = Image.new('RGB', (img_w, img_h), color=(245, 245, 245))
    draw = ImageDraw.Draw(img)
    
    font_path = "NanumGothic.ttf"
    if not os.path.exists(font_path):
        font_url = "https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf"
        urllib.request.urlretrieve(font_url, font_path)
        
    font_title = ImageFont.truetype(font_path, 55)
    font_main_feels = ImageFont.truetype(font_path, 220)
    font_data = ImageFont.truetype(font_path, 80)
    font_sub_title = ImageFont.truetype(font_path, 40)
    font_body = ImageFont.truetype(font_path, 35)
    font_info = ImageFont.truetype(font_path, 40)
    font_info_body = ImageFont.truetype(font_path, 28)
    font_prevention = ImageFont.truetype(font_path, 40)
    font_footer = ImageFont.truetype(font_path, 32)
    
    # 1. 헤더 (날짜 및 시간)
    draw.rectangle([(0, 0), (img_w, 150)], fill=(255, 255, 255))
    draw.text((img_w // 2, 75), f"성동자이리버뷰 {now_str_date} 오늘의 {now_str_time} 날씨", font=font_title, fill=(30, 30, 30), anchor="mm")
    
    # 2. 메인 데이터 (체감온도)
    draw.rectangle([(0, 150), (img_w, 550)], fill=(0, 71, 153))
    draw.text((img_w // 2, 330), f"{weather_data['feels_like']}°C", font=font_main_feels, fill=(255, 255, 255), anchor="mm")
    draw.text((img_w // 2, 480), "체감온도", font=font_sub_title, fill=(200, 220, 255), anchor="mm")
    
    # 3. 서브 데이터
    draw.rectangle([(50, 580), (1030, 830)], fill=(235, 235, 235))
    draw.text((img_w // 4 - 30, 680), f"{weather_data['temp']}°C", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((img_w // 4 - 30, 770), "기온", font=font_body, fill=(100, 100, 100), anchor="mm")
    
    draw.text((img_w // 2, 680), f"{weather_data['humidity']}%", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((img_w // 2, 770), "습도", font=font_body, fill=(100, 100, 100), anchor="mm")
    
    draw.text((img_w // 4 * 3 + 30, 680), f"{weather_data['wind']}m/s", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((img_w // 4 * 3 + 30, 770), "풍속", font=font_body, fill=(100, 100, 100), anchor="mm")

    # 4. 로고 배치
    logo_path = "gs_logo.png"
    if os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path)
            logo.thumbnail((250, 80))
            img.paste(logo, (img_w - 320, 860), logo if logo.mode == 'RGBA' else None)
        except Exception as e:
            pass

    # 5. 폭염특보 기준 영역
    draw.rectangle([(50, 950), (1030, 1150)], fill=(242, 248, 255), outline=(0, 71, 153), width=4)
    draw.text((img_w // 2, 1000), "폭염특보 기준", font=font_info, fill=(0, 71, 153), anchor="mm")
    
    body_text_info = (
        "- 폭염주의보: 일 최고 체감온도 33°C 이상인 상태가 2일 이상 지속될 것으로 예상될 때\n"
        "- 폭염경보: 일 최고 체감온도 35°C 이상인 상태가 2일 이상 지속될 것으로 예상될 때\n"
        "- 폭염중대경보: 체감온도 38°C 이상 또는 일 최고기온 39°C 이상인 상태가 1일 이상 지속될 것으로 예상될 때"
    )
    draw.text((80, 1040), body_text_info, font=font_info_body, fill=(50, 50, 50))

    # 6. 온열질환 예방 5대 수칙 영역
    draw.rectangle([(50, 1170), (1030, 1270)], fill=(255, 255, 255))
    draw.text((img_w // 2, 1210), "온열질환 예방 5대 수칙", font=font_prevention, fill=(0, 71, 153), anchor="mm")
    draw.text((img_w // 2, 1245), "물, 바람·그늘, 휴식, 보냉장구, 응급조치", font=font_body, fill=(40, 40, 40), anchor="mm")

    # 7. 푸터 (관리자 당부)
    draw.rectangle([(0, 1290), (img_w, img_h)], fill=(255, 215, 0)) # 눈에 띄는 짙은 노란색
    footer_text = "🔴 근로자들이 안전하게 여름을 나실 수 있도록 세심한 관리 부탁드립니다 🔴"
    draw.text((img_w // 2, 1320), footer_text, font=font_footer, fill=(30, 30, 30), anchor="mm")

    # snapshots 폴더 생성 및 저장
    os.makedirs("snapshots", exist_ok=True)
    filename = f"snapshots/weather_{kst_now.strftime('%Y%m%d_%H%M')}.png"
    img.save(filename)
    print(f"스냅샷 저장 완료: {filename}")

if __name__ == "__main__":
    MY_API_KEY = os.environ.get("WEATHER_API_KEY") 
    
    # 성동자이리버뷰 현장 위도/경도 업데이트 완료!
    TARGET_LAT = 37.5672   
    TARGET_LON = 127.0502  
    
    print("기상청 데이터 호출 중...")
    data = get_current_weather(TARGET_LAT, TARGET_LON, MY_API_KEY)
    
    print("스냅샷 이미지 생성 중...")
    create_snapshot(data)

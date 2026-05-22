import requests
import math
import os
import urllib.request
import csv
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

# 2. 기상청 날씨 데이터 가져오기
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
                
        if weather_data['temp'] != "-" and weather_data['humidity'] != "-":
            T = float(weather_data['temp'])
            RH = float(weather_data['humidity'])
            # 기상청 여름철 체감온도 공식 적용
            feels = -0.2442 + 0.55399 * T + 0.45535 * T - 0.0022 * (T**2) + 0.00278 * T * RH + 3.0
            weather_data['feels_like'] = round(feels, 1)
    except Exception as e:
        print("API 호출 에러:", e)

    return weather_data

# 3. 데이터 누적 엑셀(CSV) 저장 기능
def save_to_excel(weather_data):
    kst_now = datetime.now() + timedelta(hours=9)
    date_str = kst_now.strftime('%Y-%m-%d')
    time_str = kst_now.strftime('%H:00')
    
    filename = "weather_log.csv"
    file_exists = os.path.exists(filename)
    
    # utf-8-sig로 저장하여 엑셀 한글 깨짐 방지
    with open(filename, mode='a', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        
        if not file_exists:
            writer.writerow(["날짜", "시간", "현장명", "체감온도(°C)", "기온(°C)", "습도(%)", "풍속(m/s)"])
            
        writer.writerow([
            date_str,
            time_str,
            "성동자이리버뷰",
            weather_data['feels_like'],
            weather_data['temp'],
            weather_data['humidity'],
            weather_data['wind']
        ])
    print(f"엑셀 데이터 누적 기록 완료: {filename}")

# 4. 레이아웃 무결점 스냅샷 이미지 생성
def create_snapshot(weather_data):
    kst_now = datetime.now() + timedelta(hours=9)
    now_str_date = kst_now.strftime('%-m월 %-d일')
    now_str_time = kst_now.strftime('%H시')
    
    img_w, img_h = 1080, 1350
    img = Image.new('RGB', (img_w, img_h), color=(245, 245, 245))
    draw = ImageDraw.Draw(img)
    
    font_path = "NanumGothic.ttf"
    if not os.path.exists(font_path):
        font_url = "https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf"
        urllib.request.urlretrieve(font_url, font_path)
        
    font_title = ImageFont.truetype(font_path, 55)
    font_main_feels = ImageFont.truetype(font_path, 240)
    font_data = ImageFont.truetype(font_path, 80)
    font_sub_title = ImageFont.truetype(font_path, 40)
    font_body = ImageFont.truetype(font_path, 35)
    font_info = ImageFont.truetype(font_path, 40)
    font_info_body = ImageFont.truetype(font_path, 26) 
    font_prevention = ImageFont.truetype(font_path, 40)
    font_footer = ImageFont.truetype(font_path, 26)
    
    # 헤더
    draw.rectangle([(0, 0), (img_w, 150)], fill=(255, 255, 255))
    draw.text((img_w // 2, 75), f"성동자이리버뷰 {now_str_date} 오늘의 {now_str_time} 날씨", font=font_title, fill=(30, 30, 30), anchor="mm")
    
    # 메인 데이터
    draw.rectangle([(0, 150), (img_w, 550)], fill=(0, 71, 153))
    draw.text((img_w // 2, 330), f"{weather_data['feels_like']}°C", font=font_main_feels, fill=(255, 255, 255), anchor="mm")
    draw.text((img_w // 2, 490), "체감온도", font=font_sub_title, fill=(200, 220, 255), anchor="mm")
    
    # 서브 데이터
    draw.rectangle([(50, 580), (1030, 810)], fill=(235, 235, 235))
    draw.text((260, 665), f"{weather_data['temp']}°C", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((260, 755), "기온", font=font_body, fill=(100, 100, 100), anchor="mm")
    draw.text((540, 665), f"{weather_data['humidity']}%", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((540, 755), "습도", font=font_body, fill=(100, 100, 100), anchor="mm")
    draw.text((820, 665), f"{weather_data['wind']}m/s", font=font_data, fill=(40, 40, 40), anchor="mm")
    draw.text((820, 755), "풍속", font=font_body, fill=(100, 100, 100), anchor="mm")

    # 로고 삽입
    logo_path = "gs_logo.png"
    if os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo.thumbnail((200, 70))
            img.paste(logo, (810, 825), logo)
        except Exception as e:
            pass

    # 폭염특보 기준 영역
    draw.rectangle([(50, 860), (1030, 1140)], fill=(242, 248, 255), outline=(0, 71, 153), width=3)
    draw.text((img_w // 2, 905), "폭염특보 기준", font=font_info, fill=(0, 71, 153), anchor="mm")
    body_text_info = (
        "• 폭염주의보: 일 최고 체감온도 33°C 이상인 상태가 2일 이상\n  지속될 것으로 예상될 때\n\n"
        "• 폭염경보: 일 최고 체감온도 35°C 이상인 상태가 2일 이상\n  지속될 것으로 예상될 때\n\n"
        "• 폭염중대경보: 체감온도 38°C 이상 또는 일 최고기온 39°C 이상인\n  상태가 1일 이상 지속될 것으로 예상될 때"
    )
    draw.multiline_text((75, 940), body_text_info, font=font_info_body, fill=(60, 60, 60), spacing=12)

    # 온열질환 예방 5대 수칙 영역
    draw.rectangle([(50, 1160), (1030, 1260)], fill=(255, 255, 255))
    draw.text((img_w // 2, 1195), "온열질환 예방 5대 수칙", font=font_prevention, fill=(0, 71, 153), anchor="mm")
    draw.text((img_w // 2, 1235), "물, 바람·그늘, 휴식, 보냉장구, 응급조치", font=font_body, fill=(40, 40, 40), anchor="mm")

    # 푸터 (관리자 당부 영역)
    draw.rectangle([(0, 1285), (img_w, img_h)], fill=(255, 215, 0)) 
    draw.ellipse([(40, 1302), (70, 1332)], fill=(230, 30, 30))
    draw.ellipse([(1010, 1302), (1040, 1332)], fill=(230, 30, 30))
    footer_text = "근로자들이 안전하게 여름을 나실 수 있도록 세심한 관리 부탁드립니다"
    draw.text((img_w // 2, 1317), footer_text, font=font_footer, fill=(30, 30, 30), anchor="mm")

    # 폴더 생성 및 저장
    os.makedirs("snapshots", exist_ok=True)
    filename = f"snapshots/weather_{kst_now.strftime('%Y%m%d_%H%M')}.png"
    img.save(filename)
    print(f"스냅샷 저장 완료: {filename}")

if __name__ == "__main__":
    MY_API_KEY = os.environ.get("WEATHER_API_KEY") 
    
    # 성동자이리버뷰 현장 위치
    TARGET_LAT = 37.5672   
    TARGET_LON = 127.0502  
    
    print("기상청 데이터 호출 중...")
    data = get_current_weather(TARGET_LAT, TARGET_LON, MY_API_KEY)
    
    print("스냅샷 이미지 생성 중...")
    create_snapshot(data)
    
    print("엑셀 데이터 기록 중...")
    save_to_excel(data)

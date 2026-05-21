import requests
import math
import os  # 추가: 운영체제(또는 깃허브) 환경변수를 읽어오기 위한 라이브러리
from datetime import datetime, timedelta

# 1. 위도/경도를 기상청 격자(X, Y)로 변환하는 공식 함수
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

# 2. 기상청 초단기실황 API 호출 함수
def get_current_weather(lat, lon, api_key):
    nx, ny = lat_lon_to_grid(lat, lon)
    
    # 기상청 초단기실황 API는 매시간 40분쯤 업데이트 되므로, 안전하게 1시간 전 데이터를 요청 기준으로 잡음
    now = datetime.now() - timedelta(minutes=40)
    base_date = now.strftime('%Y%m%d')
    base_time = now.strftime('%H00')

    url = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'
    params = {
        'ServiceKey': api_key,
        'pageNo': '1',
        'numOfRows': '1000',
        'dataType': 'JSON',
        'base_date': base_date,
        'base_time': base_time,
        'nx': nx,
        'ny': ny
    }

    response = requests.get(url, params=params)
    weather_data = {"temp": "-", "humidity": "-", "wind": "-"}
    
    try:
        items = response.json().get('response', {}).get('body', {}).get('items', {}).get('item', [])
        for item in items:
            if item['category'] == 'T1H':  # 기온
                weather_data['temp'] = item['obsrValue']
            elif item['category'] == 'REH':  # 습도
                weather_data['humidity'] = item['obsrValue']
            elif item['category'] == 'WSD':  # 풍속
                weather_data['wind'] = item['obsrValue']
                
        # 체감온도 계산 (여름철 간이 공식 예시 - 필요시 정밀한 공식으로 수정 가능)
        # 단순히 기온과 습도를 이용한 러프한 계산식
        T = float(weather_data['temp'])
        RH = float(weather_data['humidity'])
        weather_data['feels_like'] = round(-0.2442 + 0.55399 * T + 0.45535 * T + -0.0022 * (T**2) + 0.00278 * T * RH + 3.0, 1)

    except Exception as e:
        print("데이터를 불러오는 데 실패했습니다:", e)

    return weather_data

# ==========================================
# 실행 테스트 (대장님의 정보로 채워주세요!)
# ==========================================
if __name__ == "__main__":
    # 수정: 코드에 직접 적지 않고 'WEATHER_API_KEY'라는 이름의 숨겨진 값을 불러옵니다.
    MY_API_KEY = os.environ.get("WEATHER_API_KEY") 
    
    # 예시: 현장 위도 경도 (용인 현장 위경도로 수정)
    TARGET_LAT = 37.2635   
    TARGET_LON = 127.1523  
    
    print("기상청 데이터 호출 중...")
    result = get_current_weather(TARGET_LAT, TARGET_LON, MY_API_KEY)
    
    print("\n[현재 현장 기상 정보]")
    print(f"기온: {result.get('temp')}°C")
    print(f"체감온도(추정): {result.get('feels_like')}°C")
    print(f"습도: {result.get('humidity')}%")
    print(f"풍속: {result.get('wind')}m/s")
